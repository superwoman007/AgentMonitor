import { randomUUID } from 'crypto';
import { fromDbJson, toDbJson, query, queryOne, run } from '../db/index.js';

/**
 * 合法的根因分类（对齐技术方案 §根因标注）。
 */
export const ROOT_CAUSES = [
  'prompt',
  'model',
  'tool',
  'retrieval',
  'data',
  'evaluator',
  'unknown',
] as const;
export type RootCause = (typeof ROOT_CAUSES)[number];

/**
 * 标注结论：good=符合预期，bad=存在问题，uncertain=无法判断。
 */
export const VERDICTS = ['good', 'bad', 'uncertain'] as const;
export type Verdict = (typeof VERDICTS)[number];

/**
 * Trace 人工标注。同一项目下同一 Trace 唯一（UPSERT 覆盖）。
 */
export interface TraceAnnotation {
  id: string;
  project_id: string;
  trace_id: string;
  run_item_id: string | null;
  root_cause: RootCause | null;
  verdict: Verdict | null;
  note: string | null;
  tags: string[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * upsert 输入。
 */
export interface UpsertAnnotationInput {
  projectId: string;
  traceId: string;
  rootCause?: RootCause | null;
  verdict?: Verdict | null;
  note?: string | null;
  tags?: string[];
  runItemId?: string | null;
  createdBy?: string;
}

/**
 * 数据库行结构（tags 为 JSON 文档）。
 */
interface AnnotationRow extends Omit<TraceAnnotation, 'tags'> {
  tags: unknown;
}

/**
 * 反序列化标注行。
 * @param row - 数据库行
 * @returns 结构化标注
 */
function deserialize(row: AnnotationRow): TraceAnnotation {
  let tags: string[] = [];
  const parsed = fromDbJson(row.tags);
  if (Array.isArray(parsed)) tags = parsed.map(String);
  return { ...row, tags };
}

/**
 * 校验根因与结论枚举。
 * @param input - 输入
 */
function validate(input: { rootCause?: RootCause | null; verdict?: Verdict | null }): void {
  if (input.rootCause !== undefined && input.rootCause !== null && !ROOT_CAUSES.includes(input.rootCause)) {
    throw new Error(`Invalid rootCause. Valid: ${ROOT_CAUSES.join(', ')}`);
  }
  if (input.verdict !== undefined && input.verdict !== null && !VERDICTS.includes(input.verdict)) {
    throw new Error(`Invalid verdict. Valid: ${VERDICTS.join(', ')}`);
  }
}

/**
 * 创建或更新一条 Trace 标注（按 project_id + trace_id 唯一）。
 * @param input - 标注内容
 * @returns 写入后的标注
 */
export async function upsertTraceAnnotation(input: UpsertAnnotationInput): Promise<TraceAnnotation> {
  validate(input);
  const existing = await queryOne<AnnotationRow>(
    'SELECT * FROM trace_annotations WHERE project_id = $1 AND trace_id = $2',
    [input.projectId, input.traceId]
  );
  const now = new Date().toISOString();

  if (existing) {
    const merged: TraceAnnotation = {
      ...deserialize(existing),
      root_cause: input.rootCause === undefined ? existing.root_cause as RootCause | null : input.rootCause,
      verdict: input.verdict === undefined ? existing.verdict as Verdict | null : input.verdict,
      note: input.note === undefined ? existing.note : input.note,
      tags: input.tags === undefined ? deserialize(existing).tags : input.tags,
      run_item_id: input.runItemId === undefined ? existing.run_item_id : input.runItemId,
    };
    await run(
      `UPDATE trace_annotations
          SET root_cause = $3, verdict = $4, note = $5, tags = $6, run_item_id = $7, updated_at = $8
        WHERE id = $1 AND project_id = $2`,
      [
        existing.id,
        input.projectId,
        merged.root_cause,
        merged.verdict,
        merged.note,
        toDbJson(merged.tags),
        merged.run_item_id,
        now,
      ]
    );
    return (await getAnnotation(input.projectId, input.traceId))!;
  }

  const id = randomUUID();
  await run(
    `INSERT INTO trace_annotations
       (id, project_id, trace_id, run_item_id, root_cause, verdict, note, tags, created_by, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)`,
    [
      id,
      input.projectId,
      input.traceId,
      input.runItemId ?? null,
      input.rootCause ?? null,
      input.verdict ?? null,
      input.note ?? null,
      toDbJson(input.tags ?? []),
      input.createdBy ?? null,
      now,
    ]
  );
  const created = await queryOne<AnnotationRow>('SELECT * FROM trace_annotations WHERE id = $1', [id]);
  if (!created) throw new Error('Failed to reload annotation');
  return deserialize(created);
}

/**
 * 按 Trace 读取标注。
 * @param projectId - 项目 ID
 * @param traceId - Trace 行 ID
 * @returns 标注或 null
 */
export async function getAnnotation(projectId: string, traceId: string): Promise<TraceAnnotation | null> {
  const row = await queryOne<AnnotationRow>(
    'SELECT * FROM trace_annotations WHERE project_id = $1 AND trace_id = $2',
    [projectId, traceId]
  );
  return row ? deserialize(row) : null;
}

/**
 * 列出项目下的标注（可按根因/结论过滤）。
 * @param projectId - 项目 ID
 * @param filter - 可选过滤
 * @returns 标注列表
 */
export async function listAnnotations(
  projectId: string,
  filter: { rootCause?: string; verdict?: string; limit?: number } = {}
): Promise<TraceAnnotation[]> {
  const conditions = ['project_id = $1'];
  const params: unknown[] = [projectId];
  if (filter.rootCause) {
    params.push(filter.rootCause);
    conditions.push(`root_cause = $${params.length}`);
  }
  if (filter.verdict) {
    params.push(filter.verdict);
    conditions.push(`verdict = $${params.length}`);
  }
  const limit = Math.min(filter.limit ?? 100, 500);
  params.push(limit);
  const rows = await query<AnnotationRow>(
    `SELECT * FROM trace_annotations
      WHERE ${conditions.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT $${params.length}`,
    params
  );
  return rows.map(deserialize);
}

/**
 * 根因分布统计（供 Bad Case 分析看板使用）。
 * @param projectId - 项目 ID
 * @returns 各根因计数
 */
export async function getRootCauseStats(projectId: string): Promise<Record<string, number>> {
  const rows = await query<{ root_cause: string | null; count: number }>(
    `SELECT root_cause, COUNT(*) as count
       FROM trace_annotations
      WHERE project_id = $1 AND root_cause IS NOT NULL
      GROUP BY root_cause`,
    [projectId]
  );
  const stats: Record<string, number> = {};
  for (const row of rows) {
    stats[row.root_cause ?? 'unknown'] = Number(row.count);
  }
  return stats;
}

/**
 * 删除标注。
 * @param projectId - 项目 ID
 * @param traceId - Trace ID
 * @returns 是否删除成功
 */
export async function deleteAnnotation(projectId: string, traceId: string): Promise<boolean> {
  const result = await run(
    'DELETE FROM trace_annotations WHERE project_id = $1 AND trace_id = $2',
    [projectId, traceId]
  );
  return result.changes > 0;
}

/**
 * 仅供测试：清空标注表。
 */
export async function __clearAnnotationsForTests(): Promise<void> {
  await run('DELETE FROM trace_annotations', []);
}
