import { createHash, randomUUID } from 'crypto';
import { fromDbBool, toDbBool, SQL_TRUE, query, queryOne, run } from '../db/index.js';
import { addDatasetItems } from './evaluation.js';

/**
 * SamplingRule 实体：把线上 Trace 按条件筛选并按比例回流到目标 Dataset。
 */
export interface SamplingRule {
  id: string;
  project_id: string;
  name: string;
  target_dataset_id: string;
  trace_type_filter: string | null;
  name_contains: string | null;
  status_filter: string | null;
  error_only: boolean;
  sample_rate: number;
  max_items_total: number | null;
  enabled: boolean;
  matched_count: number;
  sampled_count: number;
  last_scanned_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * 采样命中的 Trace 行（仅回流所需字段）。
 */
interface TraceCandidate {
  id: string;
  trace_type: string;
  name: string;
  input: unknown;
  output: unknown;
  status: string;
  error: string | null;
}

/**
 * 创建采样规则的输入。
 */
export interface CreateSamplingRuleInput {
  projectId: string;
  name: string;
  targetDatasetId: string;
  traceTypeFilter?: string;
  nameContains?: string;
  statusFilter?: string;
  errorOnly?: boolean;
  sampleRate?: number;
  maxItemsTotal?: number;
  enabled?: boolean;
  createdBy?: string;
}

/**
 * 更新采样规则的输入。
 */
export interface UpdateSamplingRuleInput {
  name?: string;
  targetDatasetId?: string;
  traceTypeFilter?: string | null;
  nameContains?: string | null;
  statusFilter?: string | null;
  errorOnly?: boolean;
  sampleRate?: number;
  maxItemsTotal?: number | null;
  enabled?: boolean;
}

/**
 * 单条规则执行一轮采样的结果。
 */
export interface SamplingScanResult {
  ruleId: string;
  matched: number;
  sampled: number;
  skippedRate: number;
  skippedDup: number;
}

/**
 * 校验采样率与目标 Dataset 归属。
 * @param sampleRate - 0~1 之间
 */
function validateRule(input: { sampleRate?: number }): void {
  const rate = input.sampleRate ?? 1;
  if (!Number.isFinite(rate) || rate <= 0 || rate > 1) {
    throw new Error('sampleRate must be in (0, 1]');
  }
}

/**
 * 基于 traceId 的确定性采样：同一 trace 对同一规则的采样决策稳定，
 * 不依赖随机数，重复扫描不会抖动。
 * @param ruleId - 规则 ID
 * @param traceId - Trace ID
 * @param rate - 采样率
 * @returns 是否命中
 */
function hitByRate(ruleId: string, traceId: string, rate: number): boolean {
  if (rate >= 1) return true;
  const digest = createHash('sha256').update(`${ruleId}:${traceId}`).digest();
  const bucket = digest.readUInt32BE(0) / 0xffffffff;
  return bucket < rate;
}

/**
 * 登记采样台账（跨库幂等）：已存在则跳过。
 * @param ruleId - 规则 ID
 * @param traceId - Trace ID
 * @param datasetItemId - 回流产生的 DatasetItem ID，未回流为 null
 */
async function recordSampledTrace(
  ruleId: string,
  traceId: string,
  datasetItemId: string | null
): Promise<void> {
  const existing = await queryOne<{ id: string }>(
    'SELECT id FROM sampled_traces WHERE rule_id = $1 AND trace_id = $2',
    [ruleId, traceId]
  );
  if (existing) return;
  await run(
    `INSERT INTO sampled_traces (id, rule_id, trace_id, dataset_item_id)
     VALUES ($1, $2, $3, $4)`,
    [randomUUID(), ruleId, traceId, datasetItemId]
  );
}

/**
 * 判断一条 Trace 是否满足规则的过滤条件。
 * @param rule - 采样规则
 * @param trace - Trace 候选
 * @returns 是否匹配
 */
function traceMatches(rule: SamplingRule, trace: TraceCandidate): boolean {
  if (rule.trace_type_filter && trace.trace_type !== rule.trace_type_filter) return false;
  if (rule.name_contains && !trace.name.includes(rule.name_contains)) return false;
  if (rule.status_filter && trace.status !== rule.status_filter) return false;
  if (fromDbBool(rule.error_only) && !(trace.error && trace.error.length > 0)) return false;
  return true;
}

/**
 * 从 Trace 的 input/output JSON 中提取文本，回流为 DatasetItem。
 * @param trace - Trace 候选
 * @returns DatasetItem 入参
 */
function traceToItem(trace: TraceCandidate): {
  input: string;
  expected_output?: string;
  metadata: Record<string, unknown>;
} {
  const extract = (raw: unknown): string => {
    if (raw === null || raw === undefined || raw === '') return '';
    const obj = typeof raw === 'string'
      ? (() => { try { return JSON.parse(raw); } catch { return raw; } })()
      : raw;
    if (obj && typeof obj === 'object') {
      const rec = obj as Record<string, unknown>;
      if (typeof rec.content === 'string') return rec.content;
      if (typeof rec.prompt === 'string') return rec.prompt;
      return JSON.stringify(obj);
    }
    return String(obj);
  };
  return {
    input: extract(trace.input),
    expected_output: extract(trace.output) || undefined,
    metadata: {
      source: 'trace_sampling',
      traceId: trace.id,
      traceType: trace.trace_type,
      traceName: trace.name,
      status: trace.status,
    },
  };
}

/**
 * 列出项目下全部采样规则。
 * @param projectId - 项目 ID
 * @returns 规则列表
 */
export async function listSamplingRules(projectId: string): Promise<SamplingRule[]> {
  return query<SamplingRule>(
    `SELECT * FROM sampling_rules WHERE project_id = $1 ORDER BY created_at DESC`,
    [projectId]
  );
}

/**
 * 读取单条采样规则。
 * @param projectId - 项目 ID
 * @param id - 规则 ID
 * @returns 规则或 null
 */
export async function getSamplingRule(projectId: string, id: string): Promise<SamplingRule | null> {
  return queryOne<SamplingRule>(
    `SELECT * FROM sampling_rules WHERE project_id = $1 AND id = $2`,
    [projectId, id]
  );
}

/**
 * 创建采样规则。
 * @param input - 创建参数
 * @returns 新规则
 */
export async function createSamplingRule(input: CreateSamplingRuleInput): Promise<SamplingRule> {
  validateRule(input);
  const dataset = await queryOne<{ id: string; project_id: string }>(
    'SELECT id, project_id FROM datasets WHERE id = $1',
    [input.targetDatasetId]
  );
  if (!dataset || dataset.project_id !== input.projectId) {
    throw new Error('Target dataset not found');
  }

  const id = randomUUID();
  const now = new Date().toISOString();
  await run(
    `INSERT INTO sampling_rules
       (id, project_id, name, target_dataset_id, trace_type_filter, name_contains,
        status_filter, error_only, sample_rate, max_items_total, enabled,
        matched_count, sampled_count, last_scanned_at, created_by, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,0,0,NULL,$12,$13,$13)`,
    [
      id,
      input.projectId,
      input.name.trim(),
      input.targetDatasetId,
      input.traceTypeFilter ?? null,
      input.nameContains ?? null,
      input.statusFilter ?? null,
      toDbBool(input.errorOnly ?? false),
      input.sampleRate ?? 1,
      input.maxItemsTotal ?? null,
      toDbBool(input.enabled !== false),
      input.createdBy ?? null,
      now,
    ]
  );
  const created = await getSamplingRule(input.projectId, id);
  if (!created) throw new Error('Failed to reload sampling rule');
  return created;
}

/**
 * 更新采样规则可变字段。
 * @param projectId - 项目 ID
 * @param id - 规则 ID
 * @param patch - 更新字段
 * @returns 更新后的规则，不存在返回 null
 */
export async function updateSamplingRule(
  projectId: string,
  id: string,
  patch: UpdateSamplingRuleInput
): Promise<SamplingRule | null> {
  const existing = await getSamplingRule(projectId, id);
  if (!existing) return null;
  if (patch.sampleRate !== undefined) validateRule({ sampleRate: patch.sampleRate });
  if (patch.targetDatasetId) {
    const dataset = await queryOne<{ id: string; project_id: string }>(
      'SELECT id, project_id FROM datasets WHERE id = $1',
      [patch.targetDatasetId]
    );
    if (!dataset || dataset.project_id !== projectId) {
      throw new Error('Target dataset not found');
    }
  }

  const merged: SamplingRule = {
    ...existing,
    name: patch.name ?? existing.name,
    target_dataset_id: patch.targetDatasetId ?? existing.target_dataset_id,
    trace_type_filter: patch.traceTypeFilter === undefined ? existing.trace_type_filter : patch.traceTypeFilter,
    name_contains: patch.nameContains === undefined ? existing.name_contains : patch.nameContains,
    status_filter: patch.statusFilter === undefined ? existing.status_filter : patch.statusFilter,
    error_only: patch.errorOnly ?? existing.error_only,
    sample_rate: patch.sampleRate ?? existing.sample_rate,
    max_items_total: patch.maxItemsTotal === undefined ? existing.max_items_total : patch.maxItemsTotal,
    enabled: patch.enabled ?? existing.enabled,
  };

  await run(
    `UPDATE sampling_rules
        SET name = $3, target_dataset_id = $4, trace_type_filter = $5, name_contains = $6,
            status_filter = $7, error_only = $8, sample_rate = $9, max_items_total = $10,
            enabled = $11, updated_at = $12
      WHERE id = $1 AND project_id = $2`,
    [
      merged.id,
      merged.project_id,
      merged.name,
      merged.target_dataset_id,
      merged.trace_type_filter,
      merged.name_contains,
      merged.status_filter,
      toDbBool(fromDbBool(merged.error_only) ?? false),
      merged.sample_rate,
      merged.max_items_total,
      toDbBool(fromDbBool(merged.enabled) ?? false),
      new Date().toISOString(),
    ]
  );
  return getSamplingRule(projectId, id);
}

/**
 * 删除采样规则（级联删除 sampled_traces 台账）。
 * @param projectId - 项目 ID
 * @param id - 规则 ID
 * @returns 是否删除成功
 */
export async function deleteSamplingRule(projectId: string, id: string): Promise<boolean> {
  const result = await run(
    'DELETE FROM sampling_rules WHERE project_id = $1 AND id = $2',
    [projectId, id]
  );
  return result.changes > 0;
}

/**
 * 执行单条规则的一轮采样扫描：
 * 1. 拉取该项目尚未被本规则采样过的 Trace（LEFT JOIN 台账去重）
 * 2. 按条件过滤 + 确定性采样率命中
 * 3. 命中 Trace 批量写入目标 Dataset，并登记 sampled_traces 台账
 * 4. 更新规则计数与 last_scanned_at
 * @param rule - 采样规则
 * @param options - 可选限制（单轮最多处理条数）
 * @returns 本轮扫描统计
 */
export async function runSamplingScan(
  rule: SamplingRule,
  options: { maxCandidates?: number } = {}
): Promise<SamplingScanResult> {
  if (!rule.enabled) {
    return { ruleId: rule.id, matched: 0, sampled: 0, skippedRate: 0, skippedDup: 0 };
  }
  const maxCandidates = options.maxCandidates ?? 500;
  const result: SamplingScanResult = { ruleId: rule.id, matched: 0, sampled: 0, skippedRate: 0, skippedDup: 0 };

  const candidates = await query<TraceCandidate>(
    `SELECT t.id, t.trace_type, t.name, t.input, t.output, t.status, t.error
       FROM traces t
       LEFT JOIN sampled_traces st ON st.trace_id = t.id AND st.rule_id = $1
      WHERE t.project_id = $2 AND st.id IS NULL
        AND t.input IS NOT NULL
      ORDER BY t.started_at ASC
      LIMIT ${Number(maxCandidates)}`,
    [rule.id, rule.project_id]
  );

  const itemsToAdd: Array<{ trace: TraceCandidate; item: ReturnType<typeof traceToItem> }> = [];
  // 达到总量上限后仍继续遍历统计 matched，但不再加入回流列表
  let capacityReached = false;
  for (const trace of candidates) {
    if (!traceMatches(rule, trace)) continue;
    result.matched += 1;
    if (capacityReached) continue;
    if (!hitByRate(rule.id, trace.id, rule.sample_rate)) {
      result.skippedRate += 1;
      // 未命中采样率也要登记台账，避免每轮重复评估
      await recordSampledTrace(rule.id, trace.id, null);
      continue;
    }
    if (rule.max_items_total !== null && rule.sampled_count + itemsToAdd.length >= rule.max_items_total) {
      capacityReached = true;
      continue;
    }
    itemsToAdd.push({ trace, item: traceToItem(trace) });
  }

  for (const { trace, item } of itemsToAdd) {
    try {
      const created = await addDatasetItems(rule.target_dataset_id, [item]);
      const itemId = created[0]?.id ?? null;
      await recordSampledTrace(rule.id, trace.id, itemId);
      result.sampled += 1;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[trace-sampling] reflow failed', {
        ruleId: rule.id,
        traceId: trace.id,
        error: (error as Error).message,
      });
    }
  }

  await run(
    `UPDATE sampling_rules
        SET matched_count = matched_count + $3,
            sampled_count = sampled_count + $4,
            last_scanned_at = $5,
            updated_at = $5
      WHERE id = $1 AND project_id = $2`,
    [rule.id, rule.project_id, result.matched, result.sampled, new Date().toISOString()]
  );

  return result;
}

/**
 * 扫描项目下全部启用规则（Worker 周期调用）。
 * @returns 每条规则的扫描统计
 */
export async function runAllSamplingScans(): Promise<SamplingScanResult[]> {
  const rules = await query<SamplingRule>(
    `SELECT * FROM sampling_rules WHERE enabled = ${SQL_TRUE}`,
    []
  );
  const results: SamplingScanResult[] = [];
  for (const rule of rules) {
    try {
      results.push(await runSamplingScan(rule));
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[trace-sampling] rule scan failed', {
        ruleId: rule.id,
        error: (error as Error).message,
      });
    }
  }
  return results;
}

/**
 * 仅供测试：清空采样规则与台账。
 */
export async function __clearSamplingRulesForTests(): Promise<void> {
  await run('DELETE FROM sampled_traces', []);
  await run('DELETE FROM sampling_rules', []);
}
