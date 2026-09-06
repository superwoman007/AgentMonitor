import { v4 as uuidv4 } from 'uuid';
import { toDbBool, query, queryOne, run } from '../db/index.js';
import { config } from '../config.js';

/**
 * Suite 聚合策略。
 * - weighted_avg：按成员 weight 对得分求加权平均（默认）
 * - all_required：所有 required 成员通过才算通过
 * - any_pass：任一成员通过即通过
 */
export type SuiteAggregationStrategy = 'weighted_avg' | 'all_required' | 'any_pass';

export interface SuiteAggregationConfig {
  strategy: SuiteAggregationStrategy;
  passThreshold?: number;
}

export interface EvaluatorSuite {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  current_version_id: string | null;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface EvaluatorSuiteVersion {
  id: string;
  suite_id: string;
  version_number: number;
  description: string | null;
  aggregation_config: SuiteAggregationConfig;
  created_by: string | null;
  created_at: Date;
}

export interface SuiteMemberInput {
  evaluatorVersionId: string;
  alias: string;
  weight?: number;
  required?: boolean;
  passThreshold?: number;
  ordinal?: number;
}

export interface EvaluatorSuiteMember {
  id: string;
  suite_version_id: string;
  evaluator_version_id: string;
  alias: string;
  weight: number;
  required: boolean;
  pass_threshold: number | null;
  ordinal: number;
}

export interface SuiteScoreInput {
  alias: string;
  score: number | null;
  passed?: boolean | null;
}

export interface SuiteAggregationResult {
  passed: boolean;
  compositeScore: number | null;
  perAlias: Record<string, { score: number | null; passed: boolean; weight: number; required: boolean }>;
  reason?: string;
}

const NOW_EXPRESSION = config.dbType === 'sqlite' ? "datetime('now')" : 'NOW()';

/**
 * 将数据库 JSON 字段解析为对象。
 * @param value - 数据库字段值
 * @returns 解析后的对象或 null
 */
function parseJsonField<T>(value: unknown): T | null {
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
 * 归一化 Suite 主表行。
 * @param row - 数据库行
 * @returns Suite 对象
 */
function mapSuite(row: Record<string, unknown>): EvaluatorSuite {
  return {
    id: row.id as string,
    project_id: row.project_id as string,
    name: row.name as string,
    description: (row.description as string | null) ?? null,
    current_version_id: (row.current_version_id as string | null) ?? null,
    created_by: (row.created_by as string | null) ?? null,
    created_at: new Date(row.created_at as string),
    updated_at: new Date(row.updated_at as string),
  };
}

/**
 * 归一化 SuiteVersion 行。
 * @param row - 数据库行
 * @returns SuiteVersion 对象
 */
function mapVersion(row: Record<string, unknown>): EvaluatorSuiteVersion {
  const config = parseJsonField<SuiteAggregationConfig>(row.aggregation_config) ?? {
    strategy: 'weighted_avg',
  };
  return {
    id: row.id as string,
    suite_id: row.suite_id as string,
    version_number: Number(row.version_number),
    description: (row.description as string | null) ?? null,
    aggregation_config: config,
    created_by: (row.created_by as string | null) ?? null,
    created_at: new Date(row.created_at as string),
  };
}

/**
 * 归一化 SuiteMember 行。
 * @param row - 数据库行
 * @returns SuiteMember 对象
 */
function mapMember(row: Record<string, unknown>): EvaluatorSuiteMember {
  return {
    id: row.id as string,
    suite_version_id: row.suite_version_id as string,
    evaluator_version_id: row.evaluator_version_id as string,
    alias: row.alias as string,
    weight: Number(row.weight),
    required: !!Number(row.required),
    pass_threshold: row.pass_threshold === null || row.pass_threshold === undefined
      ? null
      : Number(row.pass_threshold),
    ordinal: Number(row.ordinal),
  };
}

/**
 * 校验成员输入：alias 非空、evaluatorVersionId 非空、weight 非负。
 * @param members - 待校验成员
 */
function validateMembers(members: SuiteMemberInput[]): void {
  if (!Array.isArray(members) || members.length === 0) {
    throw new Error('Suite must contain at least one member');
  }
  const aliases = new Set<string>();
  for (const member of members) {
    if (!member.alias || !member.alias.trim()) {
      throw new Error('Each suite member requires a non-empty alias');
    }
    if (!member.evaluatorVersionId) {
      throw new Error(`Suite member ${member.alias} requires evaluatorVersionId`);
    }
    if (member.weight !== undefined && member.weight < 0) {
      throw new Error(`Suite member ${member.alias} weight must be non-negative`);
    }
    if (aliases.has(member.alias)) {
      throw new Error(`Duplicate suite member alias: ${member.alias}`);
    }
    aliases.add(member.alias);
  }
}

/**
 * 创建 EvaluatorSuite 及其首个不可变版本与成员。
 * @param projectId - 项目 ID
 * @param name - Suite 名称（项目内唯一）
 * @param members - 成员定义
 * @param options - 描述、聚合策略、创建人等
 * @returns 创建后的 Suite 与 Version
 */
export async function createEvaluatorSuite(
  projectId: string,
  name: string,
  members: SuiteMemberInput[],
  options: {
    description?: string;
    aggregationConfig?: Partial<SuiteAggregationConfig>;
    createdBy?: string;
  } = {}
): Promise<{ suite: EvaluatorSuite; version: EvaluatorSuiteVersion; members: EvaluatorSuiteMember[] }> {
  validateMembers(members);

  for (const member of members) {
    const evaluator = await getEvaluatorByVersionId(member.evaluatorVersionId);
    if (!evaluator) {
      throw new Error(`Evaluator version not found: ${member.evaluatorVersionId}`);
    }
  }

  const suiteId = uuidv4();
  const versionId = uuidv4();
  const aggregationConfig: SuiteAggregationConfig = {
    strategy: options.aggregationConfig?.strategy ?? 'weighted_avg',
    ...(options.aggregationConfig?.passThreshold !== undefined
      ? { passThreshold: options.aggregationConfig.passThreshold }
      : {}),
  };

  const insertedSuite = await queryOne<Record<string, unknown>>(
    `INSERT INTO evaluator_suites
       (id, project_id, name, description, current_version_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [suiteId, projectId, name, options.description ?? null, versionId, options.createdBy ?? null]
  );
  if (!insertedSuite) throw new Error('Failed to create evaluator suite');

  const insertedVersion = await queryOne<Record<string, unknown>>(
    `INSERT INTO evaluator_suite_versions
       (id, suite_id, version_number, description, aggregation_config, created_by)
     VALUES ($1, $2, 1, $3, $4, $5)
     RETURNING *`,
    [versionId, suiteId, options.description ?? null, JSON.stringify(aggregationConfig), options.createdBy ?? null]
  );
  if (!insertedVersion) throw new Error('Failed to create evaluator suite version');

  const savedMembers = await insertSuiteMembers(versionId, members);

  return {
    suite: mapSuite(insertedSuite),
    version: mapVersion(insertedVersion),
    members: savedMembers,
  };
}

/**
 * 为 Suite 创建新的不可变版本（成员集合变更必须走新版本，不能原地改）。
 * @param suiteId - Suite ID
 * @param members - 新版本成员
 * @param options - 描述、聚合策略、创建人
 * @returns 更新后的 Suite 与新版本
 */
export async function createEvaluatorSuiteVersion(
  suiteId: string,
  members: SuiteMemberInput[],
  options: {
    description?: string;
    aggregationConfig?: Partial<SuiteAggregationConfig>;
    createdBy?: string;
  } = {}
): Promise<{ suite: EvaluatorSuite; version: EvaluatorSuiteVersion; members: EvaluatorSuiteMember[] }> {
  validateMembers(members);
  const suite = await getEvaluatorSuiteById(suiteId);
  if (!suite) throw new Error('Evaluator suite not found');

  const maxRow = await queryOne<{ max: number | null }>(
    'SELECT MAX(version_number) as max FROM evaluator_suite_versions WHERE suite_id = $1',
    [suiteId]
  );
  const nextVersionNumber = (maxRow?.max ?? 0) + 1;
  const versionId = uuidv4();
  const aggregationConfig: SuiteAggregationConfig = {
    strategy: options.aggregationConfig?.strategy ?? 'weighted_avg',
    ...(options.aggregationConfig?.passThreshold !== undefined
      ? { passThreshold: options.aggregationConfig.passThreshold }
      : {}),
  };

  for (const member of members) {
    const evaluator = await getEvaluatorByVersionId(member.evaluatorVersionId);
    if (!evaluator) {
      throw new Error(`Evaluator version not found: ${member.evaluatorVersionId}`);
    }
  }

  const inserted = await queryOne<Record<string, unknown>>(
    `INSERT INTO evaluator_suite_versions
       (id, suite_id, version_number, description, aggregation_config, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      versionId,
      suiteId,
      nextVersionNumber,
      options.description ?? null,
      JSON.stringify(aggregationConfig),
      options.createdBy ?? null,
    ]
  );
  if (!inserted) throw new Error('Failed to create suite version');

  const savedMembers = await insertSuiteMembers(versionId, members);

  await run(
    `UPDATE evaluator_suites SET current_version_id = $1, updated_at = ${NOW_EXPRESSION} WHERE id = $2`,
    [versionId, suiteId]
  );

  const refreshed = await getEvaluatorSuiteById(suiteId);
  if (!refreshed) throw new Error('Failed to reload suite');

  return { suite: refreshed, version: mapVersion(inserted), members: savedMembers };
}

/**
 * 批量插入 SuiteVersion 成员，按 ordinal 排序。
 * @param suiteVersionId - SuiteVersion ID
 * @param members - 成员定义
 * @returns 插入后的完整成员数组
 */
async function insertSuiteMembers(
  suiteVersionId: string,
  members: SuiteMemberInput[]
): Promise<EvaluatorSuiteMember[]> {
  const sorted = [...members].sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0));
  const saved: EvaluatorSuiteMember[] = [];
  for (let index = 0; index < sorted.length; index += 1) {
    const member = sorted[index];
    const id = uuidv4();
    const weight = member.weight ?? 1.0;
    const required = member.required ?? true;
    const ordinal = member.ordinal ?? index;
    const passThreshold = member.passThreshold ?? null;
    const inserted = await queryOne<Record<string, unknown>>(
      `INSERT INTO evaluator_suite_members
         (id, suite_version_id, evaluator_version_id, alias, weight, required, pass_threshold, ordinal)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [id, suiteVersionId, member.evaluatorVersionId, member.alias, weight, toDbBool(required), passThreshold, ordinal]
    );
    if (inserted) saved.push(mapMember(inserted));
  }
  return saved;
}

/**
 * 按 evaluator_version_id 反查所属 Evaluator，用于成员合法性校验。
 * @param evaluatorVersionId - EvaluatorVersion ID
 * @returns Evaluator 或 null
 */
async function getEvaluatorByVersionId(evaluatorVersionId: string): Promise<{ id: string } | null> {
  const row = await queryOne<{ evaluator_id: string }>(
    'SELECT evaluator_id FROM evaluator_versions WHERE id = $1',
    [evaluatorVersionId]
  );
  return row ? { id: row.evaluator_id } : null;
}

/**
 * 按 ID 查询 Suite。
 * @param suiteId - Suite ID
 * @returns Suite 或 null
 */
export async function getEvaluatorSuiteById(suiteId: string): Promise<EvaluatorSuite | null> {
  const row = await queryOne<Record<string, unknown>>(
    'SELECT * FROM evaluator_suites WHERE id = $1',
    [suiteId]
  );
  return row ? mapSuite(row) : null;
}

/**
 * 列出项目下的全部 Suite。
 * @param projectId - 项目 ID
 * @returns Suite 数组
 */
export async function listEvaluatorSuites(projectId: string): Promise<EvaluatorSuite[]> {
  const rows = await query<Record<string, unknown>>(
    'SELECT * FROM evaluator_suites WHERE project_id = $1 ORDER BY created_at DESC',
    [projectId]
  );
  return rows.map(mapSuite);
}

/**
 * 列出 Suite 的全部版本。
 * @param suiteId - Suite ID
 * @returns 版本数组（按版本号倒序）
 */
export async function listSuiteVersions(suiteId: string): Promise<EvaluatorSuiteVersion[]> {
  const rows = await query<Record<string, unknown>>(
    'SELECT * FROM evaluator_suite_versions WHERE suite_id = $1 ORDER BY version_number DESC',
    [suiteId]
  );
  return rows.map(mapVersion);
}

/**
 * 按 ID 查询 SuiteVersion。
 * @param versionId - SuiteVersion ID
 * @returns SuiteVersion 或 null
 */
export async function getSuiteVersionById(versionId: string): Promise<EvaluatorSuiteVersion | null> {
  const row = await queryOne<Record<string, unknown>>(
    'SELECT * FROM evaluator_suite_versions WHERE id = $1',
    [versionId]
  );
  return row ? mapVersion(row) : null;
}

/**
 * 列出 SuiteVersion 下的全部成员，按 ordinal 排序。
 * @param suiteVersionId - SuiteVersion ID
 * @returns 成员数组
 */
export async function listSuiteMembers(suiteVersionId: string): Promise<EvaluatorSuiteMember[]> {
  const rows = await query<Record<string, unknown>>(
    'SELECT * FROM evaluator_suite_members WHERE suite_version_id = $1 ORDER BY ordinal ASC',
    [suiteVersionId]
  );
  return rows.map(mapMember);
}

/**
 * 根据 SuiteVersion 的聚合策略汇总各 Evaluator 的得分。
 *
 * - weighted_avg：Σ(score*weight)/Σweight，与 passThreshold 比较
 * - all_required：所有 required 成员必须 passed=true
 * - any_pass：任一成员 passed=true 即通过
 *
 * @param suiteVersion - SuiteVersion（提供聚合策略）
 * @param members - SuiteVersion 的成员
 * @param scores - 按成员 alias 提供的分数
 * @returns 汇总结果
 */
export function aggregateScores(
  suiteVersion: EvaluatorSuiteVersion,
  members: EvaluatorSuiteMember[],
  scores: SuiteScoreInput[]
): SuiteAggregationResult {
  const byAlias = new Map(members.map((m) => [m.alias, m]));
  const perAlias: SuiteAggregationResult['perAlias'] = {};
  const scoreByAlias = new Map(scores.map((s) => [s.alias, s]));

  let weightedSum = 0;
  let totalWeight = 0;
  let requiredFails = 0;
  let requiredTotal = 0;
  let anyPassed = false;

  for (const alias of byAlias.keys()) {
    const member = byAlias.get(alias)!;
    const input = scoreByAlias.get(alias);
    const score = input?.score ?? null;
    const threshold = member.pass_threshold
      ?? suiteVersion.aggregation_config.passThreshold
      ?? 0.5;
    const passed = input?.passed !== undefined && input?.passed !== null
      ? !!input.passed
      : score !== null && score >= threshold;

    perAlias[alias] = {
      score,
      passed,
      weight: member.weight,
      required: member.required,
    };

    if (score !== null) {
      weightedSum += score * member.weight;
      totalWeight += member.weight;
    }
    if (member.required) {
      requiredTotal += 1;
      if (!passed) requiredFails += 1;
    }
    if (passed) anyPassed = true;
  }

  const compositeScore = totalWeight > 0 ? weightedSum / totalWeight : null;
  const strategy = suiteVersion.aggregation_config.strategy;

  if (strategy === 'all_required') {
    return {
      passed: requiredTotal > 0 && requiredFails === 0,
      compositeScore,
      perAlias,
      ...(requiredFails > 0 ? { reason: `${requiredFails} required evaluator(s) failed` } : {}),
    };
  }
  if (strategy === 'any_pass') {
    return {
      passed: anyPassed,
      compositeScore,
      perAlias,
      ...(!anyPassed ? { reason: 'no evaluator passed' } : {}),
    };
  }

  const threshold = suiteVersion.aggregation_config.passThreshold ?? 0.5;
  // 浮点容差，避免 0.8 被计算为 0.7999999999999999 时误判失败
  const passed = compositeScore !== null && compositeScore + 1e-9 >= threshold;
  return {
    passed,
    compositeScore,
    perAlias,
    ...(!passed ? { reason: `composite score below threshold ${threshold}` } : {}),
  };
}
