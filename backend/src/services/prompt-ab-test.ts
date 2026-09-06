import { createHash, randomUUID } from 'crypto';
import { fromDbBool, toDbBool, query, queryOne, run } from '../db/index.js';
import { getPromptById, getVersionById } from './prompts.js';

/**
 * Prompt A/B 实验变体。同一 (project, prompt, environment) 下可有多个 variant_key。
 */
export interface PromptAbVariant {
  id: string;
  project_id: string;
  prompt_id: string;
  environment: string;
  variant_key: string;
  prompt_version_id: string;
  weight: number;
  note: string | null;
  enabled: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * 行结构（enabled 为布尔）。
 */
type VariantRow = Omit<PromptAbVariant, 'enabled'> & { enabled: unknown };

/**
 * 分桶结果。
 */
export interface VariantSelection {
  variantKey: string;
  promptVersionId: string;
  weight: number;
  /**
   * 基线（Deployment 主指针）命中时为 true。
   */
  isBaseline: boolean;
}

/**
 * 反序列化变体行。
 * @param row - 数据库行
 * @returns 结构化变体
 */
function deserialize(row: VariantRow): PromptAbVariant {
  return { ...row, enabled: Boolean(row.enabled) };
}

/**
 * 校验环境名与权重。
 * @param environment - 环境
 * @param weight - 权重（0-100）
 */
function validateVariant(environment: string, weight: number): void {
  if (!['production', 'staging', 'development'].includes(environment)) {
    throw new Error('environment must be one of production/staging/development');
  }
  if (!Number.isInteger(weight) || weight < 0 || weight > 100) {
    throw new Error('weight must be an integer between 0 and 100');
  }
}

/**
 * 列出某 Prompt 在某环境下的全部 A/B 变体。
 * @param projectId - 项目 ID
 * @param promptId - Prompt ID
 * @param environment - 环境
 * @returns 变体列表
 */
export async function listAbVariants(
  projectId: string,
  promptId: string,
  environment: string
): Promise<PromptAbVariant[]> {
  const rows = await query<VariantRow>(
    `SELECT * FROM prompt_ab_variants
      WHERE project_id = $1 AND prompt_id = $2 AND environment = $3
      ORDER BY variant_key ASC`,
    [projectId, promptId, environment]
  );
  return rows.map(deserialize);
}

/**
 * upsert 一个 A/B 变体。
 * @param input - 变体参数
 * @returns 写入后的变体
 */
export async function upsertAbVariant(input: {
  projectId: string;
  promptId: string;
  environment: string;
  variantKey: string;
  promptVersionId: string;
  weight: number;
  note?: string;
  enabled?: boolean;
  createdBy?: string;
}): Promise<PromptAbVariant> {
  validateVariant(input.environment, input.weight);
  const prompt = await getPromptById(input.promptId);
  if (!prompt || prompt.project_id !== input.projectId) {
    throw new Error('Prompt not found');
  }
  const version = await getVersionById(input.promptVersionId);
  if (!version || version.prompt_id !== input.promptId) {
    throw new Error('Prompt version not found');
  }

  const existing = await queryOne<VariantRow>(
    `SELECT * FROM prompt_ab_variants
      WHERE project_id = $1 AND prompt_id = $2 AND environment = $3 AND variant_key = $4`,
    [input.projectId, input.promptId, input.environment, input.variantKey]
  );

  if (existing) {
    await run(
      `UPDATE prompt_ab_variants
          SET prompt_version_id = $5, weight = $6, note = $7, enabled = $8, updated_at = $9
        WHERE id = $1`,
      [
        existing.id,
        existing.project_id,
        existing.prompt_id,
        existing.environment,
        input.promptVersionId,
        input.weight,
        input.note ?? existing.note,
        toDbBool(input.enabled !== false),
        new Date().toISOString(),
      ]
    );
    const updated = await queryOne<VariantRow>('SELECT * FROM prompt_ab_variants WHERE id = $1', [existing.id]);
    if (!updated) throw new Error('Failed to reload variant');
    return deserialize(updated);
  }

  const id = randomUUID();
  const now = new Date().toISOString();
  await run(
    `INSERT INTO prompt_ab_variants
       (id, project_id, prompt_id, environment, variant_key, prompt_version_id, weight, note, enabled, created_by, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)`,
    [
      id,
      input.projectId,
      input.promptId,
      input.environment,
      input.variantKey,
      input.promptVersionId,
      input.weight,
      input.note ?? null,
      toDbBool(input.enabled !== false),
      input.createdBy ?? null,
      now,
    ]
  );
  const created = await queryOne<VariantRow>('SELECT * FROM prompt_ab_variants WHERE id = $1', [id]);
  if (!created) throw new Error('Failed to reload variant');
  return deserialize(created);
}

/**
 * 删除一个 A/B 变体。
 * @param projectId - 项目 ID
 * @param promptId - Prompt ID
 * @param environment - 环境
 * @param variantKey - 变体 key
 * @returns 是否删除成功
 */
export async function deleteAbVariant(
  projectId: string,
  promptId: string,
  environment: string,
  variantKey: string
): Promise<boolean> {
  const result = await run(
    `DELETE FROM prompt_ab_variants
      WHERE project_id = $1 AND prompt_id = $2 AND environment = $3 AND variant_key = $4`,
    [projectId, promptId, environment, variantKey]
  );
  return result.changes > 0;
}

/**
 * 基于分桶键的确定性 hash，输出 0-99 的桶号。
 * 同一 (promptId, environment, bucketKey) 永远落入同一桶，保证同一用户体验稳定。
 * @param promptId - Prompt ID
 * @param environment - 环境
 * @param bucketKey - 分桶键（如 userId/sessionId）
 * @returns 0-99 桶号
 */
export function computeBucket(promptId: string, environment: string, bucketKey: string): number {
  const digest = createHash('sha256').update(`${promptId}:${environment}:${bucketKey}`).digest();
  return digest.readUInt32BE(0) % 100;
}

/**
 * 按权重在基线与变体之间分桶。
 * 变体权重之和若超过 100 则按声明顺序截断；未命中任何变体则回落到基线（Deployment 主指针）。
 * @param variants - 启用的变体
 * @param bucket - 0-99 桶号
 * @returns 命中的变体 key，未命中返回 null（走基线）
 */
export function pickVariantByBucket(
  variants: Array<{ variant_key: string; weight: number }>,
  bucket: number
): string | null {
  let cursor = 0;
  for (const v of variants) {
    if (v.weight <= 0) continue;
    if (bucket < cursor + v.weight) return v.variant_key;
    cursor += v.weight;
    if (cursor >= 100) break;
  }
  return null;
}

/**
 * Runtime 分流：解析启用的 A/B 变体，按 bucketKey 分桶选择版本。
 * 未配置变体或未命中时返回 isBaseline=true，由调用方使用 Deployment 主指针。
 * @param projectId - 项目 ID
 * @param promptId - Prompt ID
 * @param environment - 环境
 * @param bucketKey - 分桶键（调用方传入 userId/sessionId；为空则随机回落基线）
 * @returns 分桶结果，未命中返回 null
 */
export async function selectAbVariant(
  projectId: string,
  promptId: string,
  environment: string,
  bucketKey?: string | null
): Promise<(VariantSelection & { bucket: number }) | null> {
  const all = await listAbVariants(projectId, promptId, environment);
  const enabled = all.filter((v) => v.enabled && v.weight > 0);
  if (enabled.length === 0 || !bucketKey) return null;

  const bucket = computeBucket(promptId, environment, bucketKey);
  const pickedKey = pickVariantByBucket(enabled, bucket);
  if (!pickedKey) return null;

  const picked = enabled.find((v) => v.variant_key === pickedKey);
  if (!picked) return null;
  return {
    variantKey: picked.variant_key,
    promptVersionId: picked.prompt_version_id,
    weight: picked.weight,
    isBaseline: false,
    bucket,
  };
}

/**
 * 仅供测试：清空 A/B 变体表。
 */
export async function __clearAbVariantsForTests(): Promise<void> {
  await run('DELETE FROM prompt_ab_variants', []);
}
