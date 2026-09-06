import { randomUUID, createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { toDbBool, toDbJson, query, queryOne, run } from '../db/index.js';
import { config } from '../config.js';
import { getExperimentById } from './evaluation.js';
import { listDatasetVersionItems, type DatasetVersionItem } from './dataset-version-item.js';
import {
  type EvaluatorSuiteVersion,
  type EvaluatorSuiteMember,
  getSuiteVersionById,
  listSuiteMembers,
} from './evaluator-suite.js';
import { getTargetVersionById, type AgentTargetVersion } from './agent-target.js';

const NOW_EXPRESSION = config.dbType === 'sqlite' ? "datetime('now')" : 'NOW()';

export type RunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'cancelling';
export type RunItemStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'cancelled';
export type RunItemPhase = 'queued' | 'target' | 'evaluators' | 'done';
export type ScoreStatus = 'pending' | 'completed' | 'failed' | 'skipped';

export interface EvaluationRun {
  id: string;
  project_id: string;
  experiment_id: string;
  run_number: number;
  trigger_type: 'manual' | 'scheduled' | 'api' | 'retry' | 'webhook';
  trigger_ref: string | null;
  baseline_run_id: string | null;
  retry_of_run_id: string | null;
  status: RunStatus;
  status_reason: string | null;
  requested_by: string | null;
  idempotency_key: string | null;
  source_revision: Record<string, unknown> | null;
  config_snapshot: Record<string, unknown> | null;
  gate_snapshot: Record<string, unknown> | null;
  summary: RunSummary | null;
  gate_result: Record<string, unknown> | null;
  queued_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
  cancel_requested_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface RunSummary {
  totalItems: number;
  completedItems: number;
  passedItems: number;
  failedItems: number;
  skippedItems?: number;
  avgScore: number | null;
  avgLatencyMs: number | null;
  totalTokens?: number;
}

export interface EvaluationRunItem {
  id: string;
  run_id: string;
  dataset_version_item_id: string;
  case_key: string;
  status: RunItemStatus;
  phase: RunItemPhase;
  attempt_count: number;
  lease_owner: string | null;
  lease_token_hash: string | null;
  lease_expires_at: Date | null;
  input_snapshot: Record<string, unknown>;
  expected_snapshot: Record<string, unknown> | null;
  target_output: string | null;
  target_error: string | null;
  trace_id: string | null;
  session_id: string | null;
  latency_ms: number | null;
  token_usage: Record<string, unknown> | null;
  cost: number | null;
  started_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface EvaluationScore {
  id: string;
  run_item_id: string;
  evaluator_version_id: string | null;
  evaluator_alias: string;
  status: ScoreStatus;
  score: number | null;
  passed: boolean | null;
  label: string | null;
  reasoning: string | null;
  details: Record<string, unknown> | null;
  error: string | null;
  raw_output: string | null;
  latency_ms: number | null;
  token_usage: Record<string, unknown> | null;
  created_at: Date;
  completed_at: Date | null;
}

export interface EvaluationRunEvent {
  id: string;
  run_id: string;
  sequence: number;
  event_type: string;
  payload: Record<string, unknown> | null;
  created_at: Date;
}

export interface ValidationIssue {
  code: string;
  message: string;
  field?: string;
}

export interface RunPreparation {
  run: EvaluationRun;
  items: EvaluationRunItem[];
  target: AgentTargetVersion;
  suite: EvaluatorSuiteVersion;
  members: EvaluatorSuiteMember[];
  datasetItems: DatasetVersionItem[];
}

/**
 * 解析数据库 JSON 字段。
 * @param value - 原始字段
 * @returns 解析后的对象或 null
 */
function parseJson<T>(value: unknown): T | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return value as T;
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

/**
 * 归一化 evaluation_runs 行。
 * @param row - 数据库行
 * @returns Run 领域对象
 */
function mapRun(row: Record<string, unknown>): EvaluationRun {
  return {
    id: row.id as string,
    project_id: row.project_id as string,
    experiment_id: row.experiment_id as string,
    run_number: Number(row.run_number),
    trigger_type: row.trigger_type as EvaluationRun['trigger_type'],
    trigger_ref: (row.trigger_ref as string | null) ?? null,
    baseline_run_id: (row.baseline_run_id as string | null) ?? null,
    retry_of_run_id: (row.retry_of_run_id as string | null) ?? null,
    status: row.status as RunStatus,
    status_reason: (row.status_reason as string | null) ?? null,
    requested_by: (row.requested_by as string | null) ?? null,
    idempotency_key: (row.idempotency_key as string | null) ?? null,
    source_revision: parseJson<Record<string, unknown>>(row.source_revision),
    config_snapshot: parseJson<Record<string, unknown>>(row.config_snapshot),
    gate_snapshot: parseJson<Record<string, unknown>>(row.gate_snapshot),
    summary: parseJson<RunSummary>(row.summary),
    gate_result: parseJson<Record<string, unknown>>(row.gate_result),
    queued_at: new Date(row.queued_at as string),
    started_at: row.started_at ? new Date(row.started_at as string) : null,
    completed_at: row.completed_at ? new Date(row.completed_at as string) : null,
    cancel_requested_at: row.cancel_requested_at ? new Date(row.cancel_requested_at as string) : null,
    created_at: new Date(row.created_at as string),
    updated_at: new Date(row.updated_at as string),
  };
}

function mapRunItem(row: Record<string, unknown>): EvaluationRunItem {
  return {
    id: row.id as string,
    run_id: row.run_id as string,
    dataset_version_item_id: row.dataset_version_item_id as string,
    case_key: row.case_key as string,
    status: row.status as RunItemStatus,
    phase: row.phase as RunItemPhase,
    attempt_count: Number(row.attempt_count),
    lease_owner: (row.lease_owner as string | null) ?? null,
    lease_token_hash: (row.lease_token_hash as string | null) ?? null,
    lease_expires_at: row.lease_expires_at ? new Date(row.lease_expires_at as string) : null,
    input_snapshot: parseJson<Record<string, unknown>>(row.input_snapshot) ?? {},
    expected_snapshot: parseJson<Record<string, unknown>>(row.expected_snapshot),
    target_output: (row.target_output as string | null) ?? null,
    target_error: (row.target_error as string | null) ?? null,
    trace_id: (row.trace_id as string | null) ?? null,
    session_id: (row.session_id as string | null) ?? null,
    latency_ms: row.latency_ms === null || row.latency_ms === undefined ? null : Number(row.latency_ms),
    token_usage: parseJson<Record<string, unknown>>(row.token_usage),
    cost: row.cost === null || row.cost === undefined ? null : Number(row.cost),
    started_at: row.started_at ? new Date(row.started_at as string) : null,
    completed_at: row.completed_at ? new Date(row.completed_at as string) : null,
    created_at: new Date(row.created_at as string),
    updated_at: new Date(row.updated_at as string),
  };
}

function mapScore(row: Record<string, unknown>): EvaluationScore {
  return {
    id: row.id as string,
    run_item_id: row.run_item_id as string,
    evaluator_version_id: (row.evaluator_version_id as string | null) ?? null,
    evaluator_alias: row.evaluator_alias as string,
    status: row.status as ScoreStatus,
    score: row.score === null || row.score === undefined ? null : Number(row.score),
    passed:
      row.passed === null || row.passed === undefined
        ? null
        : !!Number(row.passed),
    label: (row.label as string | null) ?? null,
    reasoning: (row.reasoning as string | null) ?? null,
    details: parseJson<Record<string, unknown>>(row.details),
    error: (row.error as string | null) ?? null,
    raw_output: (row.raw_output as string | null) ?? null,
    latency_ms: row.latency_ms === null || row.latency_ms === undefined ? null : Number(row.latency_ms),
    token_usage: parseJson<Record<string, unknown>>(row.token_usage),
    created_at: new Date(row.created_at as string),
    completed_at: row.completed_at ? new Date(row.completed_at as string) : null,
  };
}

function mapEvent(row: Record<string, unknown>): EvaluationRunEvent {
  return {
    id: row.id as string,
    run_id: row.run_id as string,
    sequence: Number(row.sequence),
    event_type: row.event_type as string,
    payload: parseJson<Record<string, unknown>>(row.payload),
    created_at: new Date(row.created_at as string),
  };
}

/**
 * 校验 Experiment 是否可启动：DatasetVersion/TargetVersion/SuiteVersion 完整且归属同项目，
 * Suite 至少一个成员。
 * @param experimentId - Experiment ID
 * @returns 校验结果，包含问题列表；通过时 issues 为空
 */
export async function validateExperiment(experimentId: string): Promise<{
  valid: boolean;
  issues: ValidationIssue[];
  datasetVersionId?: string;
  targetVersionId?: string;
  suiteVersionId?: string;
}> {
  const issues: ValidationIssue[] = [];
  const experiment = await getExperimentById(experimentId);
  if (!experiment) {
    return { valid: false, issues: [{ code: 'EXPERIMENT_NOT_FOUND', message: 'Experiment not found' }] };
  }

  const datasetVersionId =
    (experiment as unknown as { dataset_version_id?: string }).dataset_version_id ?? null;
  const targetVersionId =
    (experiment as unknown as { target_version_id?: string }).target_version_id ?? null;
  const suiteVersionId =
    (experiment as unknown as { evaluator_suite_version_id?: string }).evaluator_suite_version_id ?? null;

  if (!datasetVersionId) {
    issues.push({ code: 'EMPTY_DATASET_VERSION', message: 'Experiment must reference a DatasetVersion', field: 'dataset_version_id' });
  }
  if (!targetVersionId) {
    issues.push({ code: 'TARGET_NOT_VERIFIED', message: 'Experiment must reference a TargetVersion', field: 'target_version_id' });
  }
  if (!suiteVersionId) {
    issues.push({ code: 'SUITE_NOT_BOUND', message: 'Experiment must reference an EvaluatorSuiteVersion', field: 'evaluator_suite_version_id' });
  }

  let datasetItems: DatasetVersionItem[] = [];
  if (datasetVersionId) {
    datasetItems = await listDatasetVersionItems(datasetVersionId);
    if (datasetItems.length === 0) {
      issues.push({ code: 'EMPTY_DATASET_VERSION', message: 'DatasetVersion has no items' });
    }
  }

  if (targetVersionId) {
    const target = await getTargetVersionById(targetVersionId);
    if (!target) {
      issues.push({ code: 'TARGET_NOT_FOUND', message: `TargetVersion not found: ${targetVersionId}` });
    }
  }

  if (suiteVersionId) {
    const suite = await getSuiteVersionById(suiteVersionId);
    if (!suite) {
      issues.push({ code: 'SUITE_NOT_FOUND', message: `SuiteVersion not found: ${suiteVersionId}` });
    } else {
      const members = await listSuiteMembers(suiteVersionId);
      if (members.length === 0) {
        issues.push({ code: 'SUITE_EMPTY', message: 'SuiteVersion has no members' });
      }
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    datasetVersionId: datasetVersionId ?? undefined,
    targetVersionId: targetVersionId ?? undefined,
    suiteVersionId: suiteVersionId ?? undefined,
  };
}

/**
 * 计算下一个 run_number。
 * @param experimentId - Experiment ID
 * @returns 下一个运行编号（从 1 开始）
 */
async function nextRunNumber(experimentId: string): Promise<number> {
  const row = await queryOne<{ max: number | null }>(
    'SELECT MAX(run_number) as max FROM evaluation_runs WHERE experiment_id = $1',
    [experimentId]
  );
  return (row?.max ?? 0) + 1;
}

/**
 * 为 Run 写入状态/进度事件。sequence 单调递增，用于回放与乱序保护。
 * @param runId - Run ID
 * @param eventType - 事件类型
 * @param payload - 事件负载
 * @returns 写入的事件
 */
export async function appendRunEvent(
  runId: string,
  eventType: string,
  payload: Record<string, unknown> = {}
): Promise<EvaluationRunEvent> {
  // sequence 由 MAX+1 计算；多 Worker 并发可能产生相同 sequence 导致 UNIQUE 冲突，
  // 遇到冲突时最多重试 5 次，每次重新计算 sequence。
  const maxAttempts = 5;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const seqRow = await queryOne<{ next: number }>(
      `SELECT COALESCE(MAX(sequence), 0) + 1 as next FROM evaluation_run_events WHERE run_id = $1`,
      [runId]
    );
    const sequence = seqRow?.next ?? 1;
    const id = uuidv4();
    try {
      const inserted = await queryOne<Record<string, unknown>>(
        `INSERT INTO evaluation_run_events (id, run_id, sequence, event_type, payload)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [id, runId, sequence, eventType, JSON.stringify(payload)]
      );
      if (!inserted) throw new Error('Failed to append run event');
      return mapEvent(inserted);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('UNIQUE') && attempt < maxAttempts - 1) {
        // 并发冲突：退避后重试
        await new Promise((resolve) => setTimeout(resolve, 5 * (attempt + 1)));
        continue;
      }
      throw error;
    }
  }
  throw new Error('Failed to append run event after retries');
}

/**
 * 创建并准备一次 Run：校验 Experiment、锁定版本快照、为每个样本插入 RunItem。
 *
 * 注意：本函数只完成"入队 + 预排"，实际执行由 Runner/Worker 完成（PR-09 接 claim/lease）。
 *
 * @param experimentId - Experiment ID
 * @param options - 触发方式、触发人、幂等键、基线 Run 等
 * @returns Run 准备结果（包含 Run、RunItem、锁定的 Suite/Target 快照）
 */
export async function prepareRun(
  experimentId: string,
  options: {
    triggerType?: EvaluationRun['trigger_type'];
    triggerRef?: string;
    requestedBy?: string;
    idempotencyKey?: string;
    baselineRunId?: string;
    retryOfRunId?: string;
    sourceRevision?: Record<string, unknown>;
  } = {}
): Promise<RunPreparation> {
  const validation = await validateExperiment(experimentId);
  if (!validation.valid) {
    const err = new Error(`Experiment validation failed: ${validation.issues.map((i) => i.code).join(', ')}`);
    (err as Error & { issues?: ValidationIssue[] }).issues = validation.issues;
    throw err;
  }

  const experiment = await getExperimentById(experimentId);
  if (!experiment) throw new Error('Experiment not found after validation');

  const datasetItems = await listDatasetVersionItems(validation.datasetVersionId!);
  const target = await getTargetVersionById(validation.targetVersionId!);
  if (!target) throw new Error('TargetVersion vanished after validation');
  const suite = await getSuiteVersionById(validation.suiteVersionId!);
  if (!suite) throw new Error('SuiteVersion vanished after validation');
  const members = await listSuiteMembers(validation.suiteVersionId!);

  const runNumber = await nextRunNumber(experimentId);
  const runId = uuidv4();
  const defaultRunConfig =
    (experiment as unknown as { default_run_config?: Record<string, unknown> }).default_run_config ?? {};
  const defaultGateConfig =
    (experiment as unknown as { default_gate_config?: Record<string, unknown> }).default_gate_config ?? {};

  const configSnapshot = {
    experiment: {
      datasetVersionId: validation.datasetVersionId,
      targetVersionId: validation.targetVersionId,
      suiteVersionId: validation.suiteVersionId,
    },
    run: defaultRunConfig,
    target: target.invocation_config,
    suite: {
      aggregation: suite.aggregation_config,
      members: members.map((m) => ({
        alias: m.alias,
        weight: m.weight,
        required: m.required,
        passThreshold: m.pass_threshold,
        evaluatorVersionId: m.evaluator_version_id,
        ordinal: m.ordinal,
      })),
    },
  };

  const inserted = await queryOne<Record<string, unknown>>(
    `INSERT INTO evaluation_runs
       (id, project_id, experiment_id, run_number, trigger_type, trigger_ref,
        baseline_run_id, retry_of_run_id, status, requested_by, idempotency_key,
        source_revision, config_snapshot, gate_snapshot)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'queued', $9, $10, $11, $12, $13)
     RETURNING *`,
    [
      runId,
      experiment.project_id,
      experimentId,
      runNumber,
      options.triggerType ?? 'manual',
      options.triggerRef ?? null,
      options.baselineRunId ?? null,
      options.retryOfRunId ?? null,
      options.requestedBy ?? null,
      options.idempotencyKey ?? null,
      options.sourceRevision ? JSON.stringify(options.sourceRevision) : null,
      JSON.stringify(configSnapshot),
      JSON.stringify(defaultGateConfig),
    ]
  );
  if (!inserted) throw new Error('Failed to create run');
  const run = mapRun(inserted);

  const items: EvaluationRunItem[] = [];
  for (const dvi of datasetItems) {
    const itemId = uuidv4();
    const row = await queryOne<Record<string, unknown>>(
      `INSERT INTO evaluation_run_items
         (id, run_id, dataset_version_item_id, case_key, status, phase,
          input_snapshot, expected_snapshot)
       VALUES ($1, $2, $3, $4, 'pending', 'queued', $5, $6)
       RETURNING *`,
      [
        itemId,
        runId,
        dvi.id,
        dvi.case_key,
        JSON.stringify(dvi.input_data),
        dvi.expected_data ? JSON.stringify(dvi.expected_data) : null,
      ]
    );
    if (row) items.push(mapRunItem(row));
  }

  await appendRunEvent(runId, 'run_queued', {
    runNumber,
    totalItems: items.length,
    triggerType: run.trigger_type,
  });

  return { run, items, target, suite, members, datasetItems };
}

/**
 * 将 Run 从 queued 置为 running。
 * @param runId - Run ID
 * @returns 更新后的 Run；若状态非法返回 null
 */
export async function markRunRunning(runId: string): Promise<EvaluationRun | null> {
  const row = await queryOne<Record<string, unknown>>(
    `UPDATE evaluation_runs
       SET status = 'running', started_at = ${NOW_EXPRESSION}, updated_at = ${NOW_EXPRESSION}
     WHERE id = $1 AND status IN ('queued', 'running')
     RETURNING *`,
    [runId]
  );
  return row ? mapRun(row) : null;
}

/**
 * 将 Run 标记为完成并写入 summary/gate_result。
 * @param runId - Run ID
 * @param summary - 运行汇总
 * @param gateResult - 门禁判定结果
 * @returns 更新后的 Run
 */
export async function completeRun(
  runId: string,
  summary: RunSummary,
  gateResult: Record<string, unknown> = {}
): Promise<EvaluationRun | null> {
  const row = await queryOne<Record<string, unknown>>(
    `UPDATE evaluation_runs
       SET status = 'completed', completed_at = ${NOW_EXPRESSION}, updated_at = ${NOW_EXPRESSION},
           summary = $2, gate_result = $3
     WHERE id = $1
     RETURNING *`,
    [runId, JSON.stringify(summary), JSON.stringify(gateResult)]
  );
  return row ? mapRun(row) : null;
}

/**
 * 将 Run 标记为失败。
 * @param runId - Run ID
 * @param reason - 失败原因
 * @returns 更新后的 Run
 */
export async function failRun(runId: string, reason: string): Promise<EvaluationRun | null> {
  const row = await queryOne<Record<string, unknown>>(
    `UPDATE evaluation_runs
       SET status = 'failed', status_reason = $2, completed_at = ${NOW_EXPRESSION}, updated_at = ${NOW_EXPRESSION}
     WHERE id = $1
     RETURNING *`,
    [runId, reason]
  );
  return row ? mapRun(row) : null;
}

/**
 * 请求取消 Run（Worker 下一轮检测后将项标记为 cancelled）。
 * @param runId - Run ID
 * @returns 若状态允许返回 true
 */
export async function requestCancelRun(runId: string): Promise<boolean> {
  const result = await run(
    `UPDATE evaluation_runs
       SET status = 'cancelling', cancel_requested_at = ${NOW_EXPRESSION}, updated_at = ${NOW_EXPRESSION}
     WHERE id = $1 AND status IN ('queued', 'running', 'cancelling')`,
    [runId]
  );
  return result.changes > 0;
}

export async function getRunById(runId: string): Promise<EvaluationRun | null> {
  const row = await queryOne<Record<string, unknown>>('SELECT * FROM evaluation_runs WHERE id = $1', [runId]);
  return row ? mapRun(row) : null;
}

export async function listRunsByExperiment(experimentId: string): Promise<EvaluationRun[]> {
  const rows = await query<Record<string, unknown>>(
    'SELECT * FROM evaluation_runs WHERE experiment_id = $1 ORDER BY run_number DESC',
    [experimentId]
  );
  return rows.map(mapRun);
}

export async function listRunItems(runId: string): Promise<EvaluationRunItem[]> {
  const rows = await query<Record<string, unknown>>(
    'SELECT * FROM evaluation_run_items WHERE run_id = $1 ORDER BY rowid ASC',
    [runId]
  );
  return rows.map(mapRunItem);
}

export async function getRunItemById(runItemId: string): Promise<EvaluationRunItem | null> {
  const row = await queryOne<Record<string, unknown>>(
    'SELECT * FROM evaluation_run_items WHERE id = $1',
    [runItemId]
  );
  return row ? mapRunItem(row) : null;
}

export async function listRunEvents(runId: string): Promise<EvaluationRunEvent[]> {
  const rows = await query<Record<string, unknown>>(
    'SELECT * FROM evaluation_run_events WHERE run_id = $1 ORDER BY sequence ASC',
    [runId]
  );
  return rows.map(mapEvent);
}

export async function listScoresByRunItem(runItemId: string): Promise<EvaluationScore[]> {
  const rows = await query<Record<string, unknown>>(
    'SELECT * FROM evaluation_scores WHERE run_item_id = $1 ORDER BY created_at ASC',
    [runItemId]
  );
  return rows.map(mapScore);
}

/**
 * 写入或更新一个评估器的最终得分。同一 (run_item, alias) 唯一，重试只能 UPDATE 同一行。
 * @param runItemId - RunItem ID
 * @param data - 得分字段
 * @returns 持久化后的得分
 */
export async function upsertScore(
  runItemId: string,
  data: {
    evaluatorVersionId?: string | null;
    evaluatorAlias: string;
    status?: ScoreStatus;
    score?: number | null;
    passed?: boolean | null;
    label?: string | null;
    reasoning?: string | null;
    details?: Record<string, unknown> | null;
    error?: string | null;
    rawOutput?: string | null;
    latencyMs?: number | null;
    tokenUsage?: Record<string, unknown> | null;
  }
): Promise<EvaluationScore> {
  const status = data.status ?? 'completed';
  const existing = await queryOne<Record<string, unknown>>(
    'SELECT * FROM evaluation_scores WHERE run_item_id = $1 AND evaluator_alias = $2',
    [runItemId, data.evaluatorAlias]
  );
  if (existing) {
    const updated = await queryOne<Record<string, unknown>>(
      `UPDATE evaluation_scores
         SET status = $3, score = $4, passed = $5, label = $6, reasoning = $7, details = $8,
             error = $9, raw_output = $10, latency_ms = $11, token_usage = $12,
             completed_at = CASE WHEN $3 IN ('completed','failed','skipped') THEN ${NOW_EXPRESSION} ELSE completed_at END
       WHERE id = $1 AND run_item_id = $2
       RETURNING *`,
      [
        existing.id as string,
        runItemId,
        status,
        data.score ?? null,
        toDbBool(data.passed === undefined || data.passed === null ? null : data.passed),
        data.label ?? null,
        data.reasoning ?? null,
        data.details ? toDbJson(data.details) : null,
        data.error ?? null,
        data.rawOutput ?? null,
        data.latencyMs ?? null,
        data.tokenUsage ? toDbJson(data.tokenUsage) : null,
      ]
    );
    if (!updated) throw new Error('Failed to update score');
    return mapScore(updated);
  }

  const id = uuidv4();
  const inserted = await queryOne<Record<string, unknown>>(
    `INSERT INTO evaluation_scores
       (id, run_item_id, evaluator_version_id, evaluator_alias, status, score, passed, label,
        reasoning, details, error, raw_output, latency_ms, token_usage, completed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
             CASE WHEN $5 IN ('completed','failed','skipped') THEN ${NOW_EXPRESSION} ELSE NULL END)
     RETURNING *`,
    [
      id,
      runItemId,
      data.evaluatorVersionId ?? null,
      data.evaluatorAlias,
      status,
      data.score ?? null,
      toDbBool(data.passed === undefined || data.passed === null ? null : data.passed),
      data.label ?? null,
      data.reasoning ?? null,
      data.details ? toDbJson(data.details) : null,
      data.error ?? null,
      data.rawOutput ?? null,
      data.latencyMs ?? null,
      data.tokenUsage ? toDbJson(data.tokenUsage) : null,
    ]
  );
  if (!inserted) throw new Error('Failed to insert score');
  return mapScore(inserted);
}

/**
 * 更新 RunItem 的 Target 调用结果。
 * @param runItemId - RunItem ID
 * @param result - Target 输出、错误、traceId、耗时等
 * @returns 更新后的 RunItem
 */
export async function recordTargetResult(
  runItemId: string,
  result: {
    output?: string | null;
    error?: string | null;
    traceId?: string | null;
    sessionId?: string | null;
    latencyMs?: number;
    tokenUsage?: Record<string, unknown> | null;
    cost?: number | null;
  }
): Promise<EvaluationRunItem | null> {
  const row = await queryOne<Record<string, unknown>>(
    `UPDATE evaluation_run_items
       SET target_output = $2, target_error = $3, trace_id = $4, session_id = $5,
           latency_ms = $6, token_usage = $7, cost = $8, phase = 'evaluators',
           updated_at = ${NOW_EXPRESSION}
     WHERE id = $1 RETURNING *`,
    [
      runItemId,
      result.output ?? null,
      result.error ?? null,
      result.traceId ?? null,
      result.sessionId ?? null,
      result.latencyMs ?? null,
      result.tokenUsage ? toDbJson(result.tokenUsage) : null,
      result.cost ?? null,
    ]
  );
  return row ? mapRunItem(row) : null;
}

/**
 * 将 RunItem 标记为终态。
 * @param runItemId - RunItem ID
 * @param status - 终态状态
 * @returns 更新后的 RunItem
 */
export async function markRunItemFinal(
  runItemId: string,
  status: Extract<RunItemStatus, 'succeeded' | 'failed' | 'skipped' | 'cancelled'>
): Promise<EvaluationRunItem | null> {
  const row = await queryOne<Record<string, unknown>>(
    `UPDATE evaluation_run_items
       SET status = $2, phase = 'done', completed_at = ${NOW_EXPRESSION}, updated_at = ${NOW_EXPRESSION}
     WHERE id = $1 RETURNING *`,
    [runItemId, status]
  );
  return row ? mapRunItem(row) : null;
}

/**
 * 生成租约 token 的哈希，避免明文落库。
 * @param token - 明文 token
 * @returns SHA-256 十六进制摘要
 */
export function hashLeaseToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * 生成一个随机租约 token（明文只返回给调用方一次）。
 * @returns 明文 token
 */
export function generateLeaseToken(): string {
  return randomUUID();
}

// ==================== PR-09：数据库 Worker 队列原语 ====================

/**
 * 租约过期错误：旧 Worker 迟到的提交在租约失效后必须被拒绝。
 */
export class LeaseExpiredError extends Error {
  public readonly runItemId: string;
  constructor(runItemId: string) {
    super(`Lease expired for run item ${runItemId}`);
    this.name = 'LeaseExpiredError';
    this.runItemId = runItemId;
  }
}

/**
 * Claim 成功后返回的 RunItem + 明文租约 token（token 只在此时出现一次）。
 */
export interface ClaimedRunItem {
  item: EvaluationRunItem;
  run: EvaluationRun;
  leaseToken: string;
}

/**
 * 从指定 Run 或全局待执行队列中原子领取一条 RunItem。
 *
 * - 仅领取 status='pending' 的项
 * - 其所属 Run 必须处于 queued/running
 * - 若 Run 处于 cancelling/cancelled/failed/completed 则跳过
 * - 写入 lease_owner / lease_token_hash / lease_expires_at，置 status='running'、phase='target'、attempt_count+1、started_at
 *
 * SQLite 使用"先 SELECT 候选 id、再带条件 UPDATE"的短事务，模拟 FOR UPDATE SKIP LOCKED；
 * PostgreSQL 同样使用条件 UPDATE（已通过 status + lease 条件保证并发安全）。
 *
 * @param workerId - Worker 标识（hostname+pid+random）
 * @param leaseSeconds - 租约秒数
 * @param options.runId - 可选：只领取指定 Run 的项（未传则全局领取最早 queued Run）
 * @returns ClaimedRunItem 或 null（无可用项）
 */
export async function claimRunItem(
  workerId: string,
  leaseSeconds: number,
  options: { runId?: string } = {}
): Promise<ClaimedRunItem | null> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + leaseSeconds * 1000);

  // 先查找一条候选 RunItem（其所属 Run 必须可执行）。
  // 若 Run 有 active runner_session，则平台 Worker 不领取（交给 External Runner）。
  // External Runner 显式传 runId 时不受此限制（session 已通过 runner_id 标识）。
  const candidateSql = options.runId
    ? `SELECT i.id, i.run_id
          FROM evaluation_run_items i
          JOIN evaluation_runs r ON r.id = i.run_id
         WHERE i.status = 'pending'
           AND r.status IN ('queued', 'running')
           AND i.run_id = $1
         ORDER BY i.created_at ASC, i.id ASC
         LIMIT 1`
    : `SELECT i.id, i.run_id
         FROM evaluation_run_items i
         JOIN evaluation_runs r ON r.id = i.run_id
        WHERE i.status = 'pending'
          AND r.status IN ('queued', 'running')
          AND NOT EXISTS (
            SELECT 1 FROM runner_sessions rs
             WHERE rs.run_id = i.run_id AND rs.status = 'active'
          )
        ORDER BY i.created_at ASC, i.id ASC
        LIMIT 1`;
  const candidate = await queryOne<{ id: string; run_id: string }>(candidateSql, options.runId ? [options.runId] : []);
  if (!candidate) return null;

  const leaseToken = generateLeaseToken();
  const tokenHash = hashLeaseToken(leaseToken);

  // 原子 UPDATE：再次校验 Run 状态，避免在 SELECT/UPDATE 之间 Run 被取消
  const updated = await queryOne<Record<string, unknown>>(
    `UPDATE evaluation_run_items
        SET status = 'running',
            phase = 'target',
            attempt_count = attempt_count + 1,
            lease_owner = $2,
            lease_token_hash = $3,
            lease_expires_at = $4,
            started_at = $5,
            updated_at = $5
      WHERE id = $1
        AND status = 'pending'
        AND EXISTS (
          SELECT 1 FROM evaluation_runs r
           WHERE r.id = evaluation_run_items.run_id
             AND r.status IN ('queued', 'running')
        )
      RETURNING *`,
    [candidate.id, workerId, tokenHash, expiresAt.toISOString(), now.toISOString()]
  );
  if (!updated) return null;

  const run = await getRunById(candidate.run_id);
  if (!run) return null;

  // 若 Run 此前为 queued，置为 running 并写 run_started 事件（幂等：已 running 不影响）
  if (run.status === 'queued') {
    await markRunRunning(run.id);
    await appendRunEvent(run.id, 'run_started', { workerId, runNumber: run.run_number });
  }

  return { item: mapRunItem(updated), run, leaseToken };
}

/**
 * 续租：只有持有正确明文 token 才能延长租约。
 * @param runItemId - RunItem ID
 * @param leaseToken - 领取时返回的明文 token
 * @param leaseSeconds - 新的租约秒数
 * @throws LeaseExpiredError 当项不存在或 token 不匹配
 */
export async function heartbeatRunItem(
  runItemId: string,
  leaseToken: string,
  leaseSeconds: number
): Promise<EvaluationRunItem> {
  const tokenHash = hashLeaseToken(leaseToken);
  const expiresAt = new Date(Date.now() + leaseSeconds * 1000).toISOString();
  const updated = await queryOne<Record<string, unknown>>(
    `UPDATE evaluation_run_items
        SET lease_expires_at = $2, updated_at = $2
      WHERE id = $1 AND lease_token_hash = $3
      RETURNING *`,
    [runItemId, expiresAt, tokenHash]
  );
  if (!updated) throw new LeaseExpiredError(runItemId);
  return mapRunItem(updated);
}

/**
 * 推进 RunItem 阶段（target → evaluators）。仅租约持有者可调用。
 * @param runItemId - RunItem ID
 * @param phase - 目标阶段
 * @param leaseToken - 租约 token
 * @returns 更新后的 RunItem
 * @throws LeaseExpiredError token 不匹配或项已被回收
 */
export async function setRunItemPhase(
  runItemId: string,
  phase: RunItemPhase,
  leaseToken: string
): Promise<EvaluationRunItem> {
  const tokenHash = hashLeaseToken(leaseToken);
  const updated = await queryOne<Record<string, unknown>>(
    `UPDATE evaluation_run_items
        SET phase = $2, updated_at = ${NOW_EXPRESSION}
      WHERE id = $1 AND lease_token_hash = $3 AND status = 'running'
      RETURNING *`,
    [runItemId, phase, tokenHash]
  );
  if (!updated) throw new LeaseExpiredError(runItemId);
  return mapRunItem(updated);
}

/**
 * 扫描已过期但仍处于非终态的 RunItem，清理租约并将状态重置为 pending 供其它 Worker 重新领取。
 *
 * - 不把 target 阶段已产出 output 的项重置（避免重复调用 Agent），
 *   而是把它们置为 phase='evaluators'、status='pending'，让新 Worker 直接补做评分。
 * - 同时把其对应仍为 running 的 Run 保留（Run 内可能还有其它项在跑）。
 *
 * @param now - 当前时间（便于测试注入）
 * @returns 被回收的 RunItem 数量
 */
export async function requeueExpiredLeases(now: Date = new Date()): Promise<number> {
  // SQLite 的 datetime 比较：lease_expires_at 写入时为 ISO 字符串，
  // 直接用 ISO 字符串比较即可（YYYY-MM-DDTHH:MM:SS.sssZ 字典序与时间序一致）。
  // PostgreSQL 使用 timestamptz，绑定 Date 或 ISO 字符串均能正确比较。
  const isoNow = now.toISOString();
  const expired = await query<{ id: string; phase: string; target_output: string | null }>(
    `SELECT id, phase, target_output
       FROM evaluation_run_items
      WHERE status = 'running'
        AND lease_expires_at IS NOT NULL
        AND CAST(lease_expires_at AS TEXT) < CAST($1 AS TEXT)`,
    [isoNow]
  );

  let count = 0;
  for (const row of expired) {
    if (row.phase === 'target' || !row.target_output) {
      // Target 未完成：清理输出、回到 pending/target 阶段重新调用
      await run(
        `UPDATE evaluation_run_items
            SET status = 'pending',
                phase = 'queued',
                lease_owner = NULL,
                lease_token_hash = NULL,
                lease_expires_at = NULL,
                target_output = NULL,
                target_error = NULL,
                trace_id = NULL,
                latency_ms = NULL,
                token_usage = NULL,
                updated_at = $2
          WHERE id = $1 AND status = 'running'`,
        [row.id, isoNow]
      );
    } else {
      // Target 已完成但评分中断：保留输出，回到 pending/evaluators 让新 Worker 补做评分
      await run(
        `UPDATE evaluation_run_items
            SET status = 'pending',
                phase = 'evaluators',
                lease_owner = NULL,
                lease_token_hash = NULL,
                lease_expires_at = NULL,
                updated_at = $2
          WHERE id = $1 AND status = 'running'`,
        [row.id, isoNow]
      );
    }
    count += 1;
  }
  return count;
}

/**
 * 应用启动时恢复崩溃前的状态：
 * - 把 status='running' 的 RunItem 全部回收（交给 requeueExpiredLeases 处理阶段感知）
 * - 把仍为 'running' 但已无未完成项的 Run 置为 failed（进程崩溃保护）
 * @returns 受影响的 RunItem 数量
 */
export async function recoverStaleRunsOnStartup(): Promise<number> {
  // 所有 running 项视为过期（lease_expires_at 可能为未来时间，但旧 Worker 已死）
  const staleItems = await query<{ id: string; phase: string; target_output: string | null }>(
    `SELECT id, phase, target_output FROM evaluation_run_items WHERE status = 'running'`
  );
  const isoNow = new Date().toISOString();
  for (const row of staleItems) {
    if (row.phase === 'target' || !row.target_output) {
      await run(
        `UPDATE evaluation_run_items
            SET status = 'pending', phase = 'queued',
                lease_owner = NULL, lease_token_hash = NULL, lease_expires_at = NULL,
                target_output = NULL, target_error = NULL, trace_id = NULL,
                latency_ms = NULL, token_usage = NULL,
                updated_at = $2
          WHERE id = $1`,
        [row.id, isoNow]
      );
    } else {
      await run(
        `UPDATE evaluation_run_items
            SET status = 'pending', phase = 'evaluators',
                lease_owner = NULL, lease_token_hash = NULL, lease_expires_at = NULL,
                updated_at = $2
          WHERE id = $1`,
        [row.id, isoNow]
      );
    }
  }

  // running 但无 pending/running 项的 Run → failed（崩溃）
  const orphanRuns = await query<{ id: string }>(
    `SELECT r.id FROM evaluation_runs r
      WHERE r.status = 'running'
        AND NOT EXISTS (
          SELECT 1 FROM evaluation_run_items i
           WHERE i.run_id = r.id AND i.status IN ('pending', 'running')
        )`
  );
  for (const orphan of orphanRuns) {
    await failRun(orphan.id, 'Worker crashed before run completion');
  }

  return staleItems.length;
}

/**
 * 把指定 RunItem 标记为 cancelled（仅当仍处于非终态、且持有正确租约或无租约时）。
 * @param runItemId - RunItem ID
 * @param leaseToken - 可选租约 token；为 null 时不校验（reaper/cancel-finalizer 使用）
 */
export async function cancelRunItem(
  runItemId: string,
  leaseToken?: string
): Promise<EvaluationRunItem | null> {
  const tokenHash = leaseToken ? hashLeaseToken(leaseToken) : null;
  const updated = await queryOne<Record<string, unknown>>(
    `UPDATE evaluation_run_items
        SET status = 'cancelled',
            phase = 'done',
            completed_at = ${NOW_EXPRESSION},
            updated_at = ${NOW_EXPRESSION}
      WHERE id = $1
        AND status IN ('pending', 'running')
        ${tokenHash ? 'AND (lease_token_hash = $2 OR lease_token_hash IS NULL)' : ''}
      RETURNING *`,
    tokenHash ? [runItemId, tokenHash] : [runItemId]
  );
  return updated ? mapRunItem(updated) : null;
}

/**
 * 若 Run 处于 cancelling 且已无 pending/running 项，则把所有非终态项置 cancelled 并把 Run 置为 cancelled。
 * @param runId - Run ID
 * @returns 是否完成了取消终态化
 */
export async function finalizeCancellationIfReady(runId: string): Promise<boolean> {
  const currentRun = await getRunById(runId);
  if (!currentRun || currentRun.status !== 'cancelling') return false;

  const pendingCount = await queryOne<{ c: number }>(
    `SELECT COUNT(*) as c FROM evaluation_run_items
      WHERE run_id = $1 AND status IN ('pending', 'running')`,
    [runId]
  );
  if ((pendingCount?.c ?? 0) > 0) return false;

  // 把所有尚未终态的项兜底置 cancelled（claim 循环通常已处理）
  await run(
    `UPDATE evaluation_run_items
        SET status = 'cancelled', phase = 'done',
            completed_at = ${NOW_EXPRESSION}, updated_at = ${NOW_EXPRESSION}
      WHERE run_id = $1 AND status NOT IN ('succeeded','failed','skipped','cancelled')`,
    [runId]
  );

  await queryOne<Record<string, unknown>>(
    `UPDATE evaluation_runs
        SET status = 'cancelled',
            completed_at = ${NOW_EXPRESSION},
            updated_at = ${NOW_EXPRESSION}
      WHERE id = $1 AND status = 'cancelling'
      RETURNING *`,
    [runId]
  );
  await appendRunEvent(runId, 'run_cancelled', {});
  return true;
}

/**
 * 检查 Run 是否被请求取消。
 * @param runId - Run ID
 * @returns 是否处于 cancelling
 */
export async function isRunCancelling(runId: string): Promise<boolean> {
  const run = await getRunById(runId);
  return run?.status === 'cancelling';
}

/**
 * 把指定 RunItem 置为失败终态，并记录错误信息。
 * @param runItemId - RunItem ID
 * @param error - 错误消息
 * @param leaseToken - 租约 token
 * @returns 更新后的 RunItem
 * @throws LeaseExpiredError 租约不匹配
 */
export async function failRunItem(
  runItemId: string,
  error: string,
  leaseToken: string
): Promise<EvaluationRunItem | null> {
  const tokenHash = hashLeaseToken(leaseToken);
  const updated = await queryOne<Record<string, unknown>>(
    `UPDATE evaluation_run_items
        SET status = 'failed',
            phase = 'done',
            target_error = $2,
            completed_at = ${NOW_EXPRESSION},
            updated_at = ${NOW_EXPRESSION}
      WHERE id = $1 AND lease_token_hash = $3
      RETURNING *`,
    [runItemId, error, tokenHash]
  );
  if (!updated) throw new LeaseExpiredError(runItemId);
  return mapRunItem(updated);
}

/**
 * 释放租约（RunItem 正常完成后由 completeRunItem 调用，这里仅暴露给异常路径）。
 * @param runItemId - RunItem ID
 * @param leaseToken - 租约 token
 */
export async function clearLease(runItemId: string, leaseToken: string): Promise<void> {
  const tokenHash = hashLeaseToken(leaseToken);
  await run(
    `UPDATE evaluation_run_items
        SET lease_owner = NULL, lease_token_hash = NULL, lease_expires_at = NULL,
            updated_at = ${NOW_EXPRESSION}
      WHERE id = $1 AND lease_token_hash = $2`,
    [runItemId, tokenHash]
  );
}

/**
 * 查询某 Run 下剩余未完成项数量。
 * @param runId - Run ID
 * @returns pending + running 的数量
 */
export async function countIncompleteRunItems(runId: string): Promise<number> {
  const row = await queryOne<{ c: number }>(
    `SELECT COUNT(*) as c FROM evaluation_run_items
      WHERE run_id = $1 AND status IN ('pending', 'running')`,
    [runId]
  );
  return Number(row?.c ?? 0);
}

/**
 * 基于当前所有 RunItem 的 Score 汇总 Run，并把 Run 置为 completed。
 * 幂等：只在 Run 处于 queued/running 时生效。
 * @param runId - Run ID
 * @returns 更新后的 Run；若已终态或仍有未完成项返回 null
 */
export async function aggregateAndCompleteRun(runId: string): Promise<EvaluationRun | null> {
  const incomplete = await countIncompleteRunItems(runId);
  if (incomplete > 0) return null;

  const run = await getRunById(runId);
  if (!run) return null;
  if (run.status === 'cancelled' || run.status === 'completed' || run.status === 'failed') {
    return run;
  }

  const items = await listRunItems(runId);
  let passedItems = 0;
  let failedItems = 0;
  let skippedItems = 0;
  let totalLatency = 0;
  let latencyCount = 0;
  let totalScore = 0;
  let scoreCount = 0;
  let totalTokens = 0;

  for (const item of items) {
    if (item.status === 'succeeded') passedItems += 1;
    else if (item.status === 'failed') failedItems += 1;
    else if (item.status === 'skipped') skippedItems += 1;
    if (typeof item.latency_ms === 'number') {
      totalLatency += item.latency_ms;
      latencyCount += 1;
    }
    const tokenTotal = (item.token_usage as { totalTokens?: number } | null)?.totalTokens;
    if (typeof tokenTotal === 'number') totalTokens += tokenTotal;

    // 取该 item 所有 score 的平均值作为综合分（aggregateScores 已在写时确定 passed）
    const scores = await listScoresByRunItem(item.id);
    const numericScores = scores.filter((s) => typeof s.score === 'number');
    if (numericScores.length > 0) {
      totalScore += numericScores.reduce((acc, s) => acc + (s.score as number), 0) / numericScores.length;
      scoreCount += 1;
    }
  }

  const totalItems = items.length;
  const summary: RunSummary = {
    totalItems,
    completedItems: passedItems + failedItems + skippedItems,
    passedItems,
    failedItems,
    skippedItems,
    avgScore: scoreCount > 0 ? Number((totalScore / scoreCount).toFixed(4)) : null,
    avgLatencyMs: latencyCount > 0 ? Math.round(totalLatency / latencyCount) : null,
    totalTokens,
  };
  const gateResult = {
    passed: failedItems === 0,
    passRate: totalItems > 0 ? passedItems / totalItems : 0,
  };

  await appendRunEvent(runId, 'run_completed', summary as unknown as Record<string, unknown>);
  return completeRun(runId, summary, gateResult);
}

/**
 * 创建一次"重试失败项"Run：复制源 Run 中 status='failed' 的样本到新 Run。
 *
 * - 新 Run 的 retry_of_run_id 指向源 Run
 * - 新 RunItem 直接复用源 DatasetVersionItem 快照（按 dataset_version_item_id 关联）
 * - 跳过源 Run 中已 succeeded/skipped/cancelled 的项
 *
 * @param sourceRunId - 源 Run ID
 * @returns 新 Run 的 RunPreparation
 */
export async function createRetryRun(sourceRunId: string): Promise<RunPreparation> {
  const sourceRun = await getRunById(sourceRunId);
  if (!sourceRun) throw new Error('Source run not found');

  const failedItems = await query<{ dataset_version_item_id: string }>(
    `SELECT DISTINCT dataset_version_item_id
       FROM evaluation_run_items
      WHERE run_id = $1 AND status = 'failed'`,
    [sourceRunId]
  );
  if (failedItems.length === 0) {
    throw new Error('No failed items to retry');
  }

  const failedDviIds = new Set(failedItems.map((f) => f.dataset_version_item_id));
  const prep = await prepareRun(sourceRun.experiment_id, {
    triggerType: 'retry',
    triggerRef: sourceRunId,
    retryOfRunId: sourceRunId,
  });
  // prepareRun 会为 Experiment 的所有 DatasetVersionItem 创建 RunItem，
  // 此处裁剪掉源 Run 中并未失败的项，仅保留失败项作为重试目标。
  await pruneRunItemsToDatasetVersionItems(prep.run.id, failedDviIds);
  // 重新读取裁剪后的 RunItem 列表，确保返回的 prep.items 与实际队列一致
  const remainingItems = await listRunItems(prep.run.id);
  return { ...prep, items: remainingItems };
}

/**
 * 创建一次"单条样本重跑"Run：仅复制源 Run 中指定 RunItem 对应的样本到新 Run。
 *
 * - 新 Run 的 retry_of_run_id 指向源 Run
 * - 新 Run 只保留一个 dataset_version_item_id，对应所选 Bad Case
 * - 适用于报告页的"单条重跑"操作，而不影响其它样本
 *
 * @param sourceRunId - 源 Run ID
 * @param sourceRunItemId - 需要单独重跑的源 RunItem ID
 * @returns 新 Run 的 RunPreparation
 */
export async function createSingleItemRetryRun(
  sourceRunId: string,
  sourceRunItemId: string
): Promise<RunPreparation> {
  const sourceRun = await getRunById(sourceRunId);
  if (!sourceRun) throw new Error('Source run not found');

  const sourceRunItem = await getRunItemById(sourceRunItemId);
  if (!sourceRunItem || sourceRunItem.run_id !== sourceRunId) {
    throw new Error('Source run item not found');
  }

  const keepDatasetVersionItemIds = new Set([sourceRunItem.dataset_version_item_id]);
  const prep = await prepareRun(sourceRun.experiment_id, {
    triggerType: 'retry',
    triggerRef: sourceRunId,
    retryOfRunId: sourceRunId,
    sourceRevision: {
      sourceRunItemId,
      datasetVersionItemId: sourceRunItem.dataset_version_item_id,
    },
  });
  await pruneRunItemsToDatasetVersionItems(prep.run.id, keepDatasetVersionItemIds);
  const remainingItems = await listRunItems(prep.run.id);
  return { ...prep, items: remainingItems };
}

/**
 * 在 prepareRun 之外提供"只保留指定 DatasetVersionItem 集合"的裁剪能力，
 * 供 createRetryRun 使用（避免对 Experiment 全量样本建 RunItem）。
 *
 * 实际策略：prepareRun 总是建全集，再由本函数删除不需要的项。
 * 已通过 createRetryRun 内部的 prepareRun 选项预留位置；当前实现直接在创建后清理。
 *
 * @param runId - 新 Run ID
 * @param keepDatasetVersionItemIds - 要保留的 dataset_version_item_id 集合
 */
export async function pruneRunItemsToDatasetVersionItems(
  runId: string,
  keepDatasetVersionItemIds: Set<string>
): Promise<void> {
  const items = await listRunItems(runId);
  for (const item of items) {
    if (!keepDatasetVersionItemIds.has(item.dataset_version_item_id)) {
      await run(`DELETE FROM evaluation_run_items WHERE id = $1`, [item.id]);
    }
  }
}

// ==================== V2 报告读取 ====================

export interface RunReport {
  runId: string;
  experimentId: string;
  runNumber: number;
  status: RunStatus;
  totalItems: number;
  passedItems: number;
  failedItems: number;
  skippedItems: number;
  passRate: number;
  avgScore: number | null;
  avgLatencyMs: number | null;
  totalTokens: number;
  scoreDistribution: Array<{ bucket: string; count: number }>;
  items: Array<{
    runItemId: string;
    caseKey: string;
    status: RunItemStatus;
    output: string | null;
    error: string | null;
    traceId: string | null;
    latencyMs: number | null;
    compositeScore: number | null;
    passed: boolean | null;
    scores: Array<{ alias: string; score: number | null; passed: boolean | null; status: ScoreStatus }>;
  }>;
}

/**
 * 读取一次 Run 的完整报告（用于 V2 Experiment 报告兼容层）。
 * @param runId - Run ID
 * @returns 结构化报告
 */
export async function getRunReport(runId: string): Promise<RunReport | null> {
  const run = await getRunById(runId);
  if (!run) return null;
  const items = await listRunItems(runId);

  let passedItems = 0;
  let failedItems = 0;
  let skippedItems = 0;
  let totalLatency = 0;
  let latencyCount = 0;
  let totalScore = 0;
  let scoreCount = 0;
  let totalTokens = 0;
  const scoreBuckets = new Map<string, number>();

  const reportItems: RunReport['items'] = [];
  for (const item of items) {
    if (item.status === 'succeeded') passedItems += 1;
    else if (item.status === 'failed') failedItems += 1;
    else if (item.status === 'skipped' || item.status === 'cancelled') skippedItems += 1;

    if (item.latency_ms !== null && item.latency_ms > 0) {
      totalLatency += item.latency_ms;
      latencyCount += 1;
    }
    if (item.token_usage && typeof item.token_usage.totalTokens === 'number') {
      totalTokens += item.token_usage.totalTokens;
    }

    const scores = await listScoresByRunItem(item.id);
    const completedScores = scores.filter((s) => s.status === 'completed' && s.score !== null);
    const composite = completedScores.length > 0
      ? completedScores.reduce((sum, s) => sum + (s.score as number), 0) / completedScores.length
      : null;
    if (composite !== null) {
      totalScore += composite;
      scoreCount += 1;
      const bucket = composite >= 0.8 ? '0.8-1.0' : composite >= 0.5 ? '0.5-0.8' : '0.0-0.5';
      scoreBuckets.set(bucket, (scoreBuckets.get(bucket) ?? 0) + 1);
    }

    reportItems.push({
      runItemId: item.id,
      caseKey: item.case_key,
      status: item.status,
      output: item.target_output,
      error: item.target_error,
      traceId: item.trace_id,
      latencyMs: item.latency_ms,
      compositeScore: composite,
      passed: item.status === 'succeeded' ? true : item.status === 'failed' ? false : null,
      scores: scores.map((s) => ({
        alias: s.evaluator_alias,
        score: s.score,
        passed: s.passed,
        status: s.status,
      })),
    });
  }

  return {
    runId,
    experimentId: run.experiment_id,
    runNumber: run.run_number,
    status: run.status,
    totalItems: items.length,
    passedItems,
    failedItems,
    skippedItems,
    passRate: items.length > 0 ? Math.round((passedItems / items.length) * 10000) / 100 : 0,
    avgScore: scoreCount > 0 ? Number((totalScore / scoreCount).toFixed(4)) : null,
    avgLatencyMs: latencyCount > 0 ? Math.round(totalLatency / latencyCount) : null,
    totalTokens,
    scoreDistribution: ['0.0-0.5', '0.5-0.8', '0.8-1.0'].map((bucket) => ({
      bucket,
      count: scoreBuckets.get(bucket) ?? 0,
    })),
    items: reportItems,
  };
}

/**
 * 取 Experiment 最近一次 Run（run_number 最大）。
 * @param experimentId - Experiment ID
 * @returns 最近 Run 或 null
 */
export async function getLatestRunByExperiment(experimentId: string): Promise<EvaluationRun | null> {
  const rows = await query<Record<string, unknown>>(
    `SELECT * FROM evaluation_runs WHERE experiment_id = $1 ORDER BY run_number DESC LIMIT 1`,
    [experimentId]
  );
  return rows.length > 0 ? mapRun(rows[0]) : null;
}
