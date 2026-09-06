import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { query, queryOne, run } from '../db/index.js';
import { getDatasetById } from './evaluation.js';

/**
 * DatasetVersion 逐样本快照。
 * 提交 DatasetVersion 后这些行不可修改，用于跨版本按 caseKey 对齐基线、回归和复现。
 */
export interface DatasetVersionItem {
  id: string;
  dataset_version_id: string;
  dataset_item_id: string | null;
  case_key: string;
  input_data: Record<string, unknown>;
  expected_data: Record<string, unknown> | null;
  context_data: Record<string, unknown> | null;
  fields: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  tags: string[] | null;
  content_hash: string;
  ordinal: number;
  created_at: Date;
}

/**
 * 待快照的样本输入，兼容旧 DatasetItem（字符串 input/expected_output）与新版结构化对象。
 */
export interface SnapshotItemInput {
  datasetItemId?: string | null;
  caseKey?: string | null;
  input: unknown;
  expected?: unknown;
  context?: Record<string, unknown> | null;
  fields?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  tags?: string[] | null;
}

/**
 * 将任意输入归一化为 JSON 对象。
 * 字符串输入按 P0 兼容规则包装：input 使用 { query }，expected 使用 { answer }；
 * 对合法 JSON 字符串则直接解析。null/undefined 返回空对象。
 * @param value - 原始输入
 * @param role - 字段角色，决定字符串回退时使用的包装键名
 * @returns 归一化后的 JSON 对象
 */
function normalizeJsonObject(
  value: unknown,
  role: 'input' | 'expected' = 'input'
): Record<string, unknown> {
  if (value === null || value === undefined) return {};
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        // fallthrough：非合法 JSON 时按字符串包装
      }
    }
    return role === 'expected' ? { answer: value } : { query: value };
  }
  if (typeof value === 'object') {
    return value as Record<string, unknown>;
  }
  return { value };
}

/**
 * 计算样本内容哈希，用于版本间变更识别与去重。
 * @param input - 归一化后的输入对象
 * @param expected - 归一化后的期望输出对象
 * @returns 64 位十六进制 SHA-256 摘要
 */
export function computeContentHash(
  input: Record<string, unknown>,
  expected: Record<string, unknown> | null
): string {
  const canonical = JSON.stringify({ input, expected: expected ?? null });
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * 为一个 DatasetVersion 写入逐样本快照。
 * 同一 (dataset_version_id, case_key) 唯一，重复 caseKey 直接抛错以在提交阶段尽早暴露数据问题。
 *
 * @param datasetVersionId - DatasetVersion ID
 * @param items - 待快照的样本数组
 * @returns 写入的快照行数
 */
export async function createDatasetVersionItems(
  datasetVersionId: string,
  items: SnapshotItemInput[]
): Promise<number> {
  const seenCaseKeys = new Set<string>();
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const inputData = normalizeJsonObject(item.input, 'input');
    const expectedData = item.expected === undefined || item.expected === null
      ? null
      : normalizeJsonObject(item.expected, 'expected');
    const contextData = item.context ?? null;
    const fields = item.fields ?? null;
    const metadata = item.metadata ?? null;
    const tags = item.tags ?? null;

    const fallbackKey = item.datasetItemId ?? `case_${index + 1}`;
    const rawCaseKey = (item.caseKey ?? fallbackKey ?? '').toString().trim();
    if (!rawCaseKey) {
      throw new Error(`Dataset item at ordinal ${index} is missing caseKey`);
    }
    if (seenCaseKeys.has(rawCaseKey)) {
      throw new Error(`Duplicate caseKey in dataset version: ${rawCaseKey}`);
    }
    seenCaseKeys.add(rawCaseKey);

    const id = uuidv4();
    const contentHash = computeContentHash(inputData, expectedData);
    await run(
      `INSERT INTO dataset_version_items
        (id, dataset_version_id, dataset_item_id, case_key, input_data, expected_data, context_data,
         fields, metadata, tags, content_hash, ordinal)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        id,
        datasetVersionId,
        item.datasetItemId ?? null,
        rawCaseKey,
        JSON.stringify(inputData),
        expectedData ? JSON.stringify(expectedData) : null,
        contextData ? JSON.stringify(contextData) : null,
        fields ? JSON.stringify(fields) : null,
        metadata ? JSON.stringify(metadata) : null,
        tags ? JSON.stringify(tags) : null,
        contentHash,
        index,
      ]
    );
  }
  return items.length;
}

/**
 * 解析数据库返回的 JSON 字段。
 * @param value - 原始字段值
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
 * 将数据库行映射为 DatasetVersionItem。
 * @param row - 数据库行
 * @returns 归一化的快照对象
 */
function mapItem(row: Record<string, unknown>): DatasetVersionItem {
  return {
    id: row.id as string,
    dataset_version_id: row.dataset_version_id as string,
    dataset_item_id: (row.dataset_item_id as string | null) ?? null,
    case_key: row.case_key as string,
    input_data: parseJsonField<Record<string, unknown>>(row.input_data) ?? {},
    expected_data: parseJsonField<Record<string, unknown>>(row.expected_data),
    context_data: parseJsonField<Record<string, unknown>>(row.context_data),
    fields: parseJsonField<Record<string, unknown>>(row.fields),
    metadata: parseJsonField<Record<string, unknown>>(row.metadata),
    tags: parseJsonField<string[]>(row.tags),
    content_hash: row.content_hash as string,
    ordinal: Number(row.ordinal),
    created_at: new Date(row.created_at as string),
  };
}

/**
 * 列出 DatasetVersion 下的全部快照，按 ordinal 稳定排序。
 * @param datasetVersionId - DatasetVersion ID
 * @returns 快照数组
 */
export async function listDatasetVersionItems(
  datasetVersionId: string
): Promise<DatasetVersionItem[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT * FROM dataset_version_items WHERE dataset_version_id = $1 ORDER BY ordinal ASC`,
    [datasetVersionId]
  );
  return rows.map(mapItem);
}

/**
 * 按 caseKey 取单条快照。
 * @param datasetVersionId - DatasetVersion ID
 * @param caseKey - 版本间稳定的业务键
 * @returns 快照或 null
 */
export async function getDatasetVersionItem(
  datasetVersionId: string,
  caseKey: string
): Promise<DatasetVersionItem | null> {
  const row = await queryOne<Record<string, unknown>>(
    `SELECT * FROM dataset_version_items WHERE dataset_version_id = $1 AND case_key = $2`,
    [datasetVersionId, caseKey]
  );
  return row ? mapItem(row) : null;
}

/**
 * 统计 DatasetVersion 的快照数量。
 * @param datasetVersionId - DatasetVersion ID
 * @returns 行数
 */
export async function countDatasetVersionItems(datasetVersionId: string): Promise<number> {
  const row = await queryOne<{ count: number | string }>(
    `SELECT COUNT(*) as count FROM dataset_version_items WHERE dataset_version_id = $1`,
    [datasetVersionId]
  );
  if (!row) return 0;
  return typeof row.count === 'number' ? row.count : Number(row.count);
}

/**
 * 对比两个 DatasetVersion 的快照，按 caseKey 分类为 added/removed/regressed/unchanged。
 * 用于版本对比和基线回归报告。
 *
 * @param baselineVersionId - 基线 DatasetVersion ID
 * @param candidateVersionId - 候选 DatasetVersion ID
 * @returns 分类结果与按 caseKey 对齐的差异明细
 */
export async function diffDatasetVersions(
  baselineVersionId: string,
  candidateVersionId: string
): Promise<{
  added: string[];
  removed: string[];
  changed: string[];
  unchanged: string[];
}> {
  const [baselineRows, candidateRows] = await Promise.all([
    listDatasetVersionItems(baselineVersionId),
    listDatasetVersionItems(candidateVersionId),
  ]);
  const baselineMap = new Map(baselineRows.map((item) => [item.case_key, item]));
  const candidateMap = new Map(candidateRows.map((item) => [item.case_key, item]));

  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  const unchanged: string[] = [];

  for (const key of candidateMap.keys()) {
    if (!baselineMap.has(key)) {
      added.push(key);
      continue;
    }
    const baseline = baselineMap.get(key)!;
    const candidate = candidateMap.get(key)!;
    if (baseline.content_hash === candidate.content_hash) {
      unchanged.push(key);
    } else {
      changed.push(key);
    }
  }
  for (const key of baselineMap.keys()) {
    if (!candidateMap.has(key)) {
      removed.push(key);
    }
  }

  return { added, removed, changed, unchanged };
}

/**
 * 从 Dataset 工作副本（dataset_items）提交一个新版本时，构造快照输入数组。
 * @param datasetId - Dataset ID
 * @returns 可直接传给 createDatasetVersionItems 的数组
 */
export async function buildSnapshotFromWorkingCopy(
  datasetId: string
): Promise<{ items: SnapshotItemInput[]; datasetItemCount: number }> {
  const dataset = await getDatasetById(datasetId);
  if (!dataset) {
    throw new Error(`Dataset not found: ${datasetId}`);
  }

  const rows = await query<Record<string, unknown>>(
    `SELECT id, input, expected_output, fields, metadata FROM dataset_items WHERE dataset_id = $1 ORDER BY rowid ASC`,
    [datasetId]
  );

  const items: SnapshotItemInput[] = rows.map((row, index) => ({
    datasetItemId: row.id as string,
    caseKey: (row.id as string) || `case_${index + 1}`,
    input: row.input as string,
    expected: (row.expected_output as string | null) ?? undefined,
    fields: parseJsonField<Record<string, unknown>>(row.fields),
    metadata: parseJsonField<Record<string, unknown>>(row.metadata),
  }));

  return { items, datasetItemCount: rows.length };
}
