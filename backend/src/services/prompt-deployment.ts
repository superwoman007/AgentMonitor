import { createHash, randomUUID } from 'crypto';
import { query, queryOne, run } from '../db/index.js';
import { getPromptById, getVersionById, type Prompt, type PromptVersion } from './prompts.js';

/**
 * 合法的运行时环境名称。
 * production 为线上稳定指针，staging/development 供预发与联调使用。
 */
export const PROMPT_ENVIRONMENTS = ['production', 'staging', 'development'] as const;
export type PromptEnvironment = (typeof PROMPT_ENVIRONMENTS)[number];

/**
 * PromptDeployment 实体：project + prompt + environment 三元组唯一。
 * 发布只移动 prompt_version_id 指针，不覆盖 PromptVersion 内容。
 */
export interface PromptDeployment {
  id: string;
  project_id: string;
  prompt_id: string;
  environment: string;
  prompt_version_id: string;
  deployed_by: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Runtime API 返回的已发布 Prompt 内容。
 */
export interface ResolvedPromptDeployment {
  promptId: string;
  promptName: string;
  promptVersionId: string;
  versionNumber: number;
  environment: string;
  content: string;
  variablesSchema: Record<string, unknown> | null;
  modelDefaults: Record<string, unknown> | null;
  etag: string;
  deployedAt: string;
  /**
   * A/B 实验：命中非基线变体时返回 variantKey（如 "B"），基线为 null。
   */
  variantKey?: string | null;
  /**
   * 分桶桶号（0-99），便于排查分流。
   */
  bucket?: number | null;
}

/**
 * 规范化环境名称，拒绝未知值，避免误发布到拼错的环境。
 * @param environment - 调用方传入的环境字符串
 * @returns 规范化后的环境名
 */
function normalizeEnvironment(environment: string): PromptEnvironment {
  const value = environment.trim().toLowerCase();
  if (!PROMPT_ENVIRONMENTS.includes(value as PromptEnvironment)) {
    throw new Error(`Invalid environment: ${environment}. Valid: ${PROMPT_ENVIRONMENTS.join(', ')}`);
  }
  return value as PromptEnvironment;
}

/**
 * 根据 PromptVersion 内容生成稳定 ETag，供 SDK 做 If-None-Match 缓存。
 * @param deployment - 部署记录
 * @param version - 不可变 PromptVersion
 * @returns 形如 "pv-<sha256-prefix>" 的 ETag
 */
function buildEtag(deployment: PromptDeployment, version: PromptVersion): string {
  const material = `${deployment.id}:${version.id}:${version.version_number}:${version.content}`;
  const hash = createHash('sha256').update(material).digest('hex').slice(0, 24);
  return `"pv-${hash}"`;
}

/**
 * 发布或移动一个 Prompt 到指定环境。
 * - 校验 Prompt 与 PromptVersion 同属一个项目
 * - 同 (project,prompt,environment) 使用 UPSERT 原子切换指针
 * - 不修改 PromptVersion 本身，满足"发布只移动指针"
 * @param projectId - 项目 ID
 * @param promptId - Prompt ID
 * @param promptVersionId - 要发布的 PromptVersion ID
 * @param environment - 目标环境
 * @param options - 可选的 deployed_by 与发布备注
 * @returns 写入后的 PromptDeployment
 */
export async function deployPromptVersion(
  projectId: string,
  promptId: string,
  promptVersionId: string,
  environment: string,
  options: { deployedBy?: string; note?: string } = {}
): Promise<PromptDeployment> {
  const env = normalizeEnvironment(environment);
  const prompt = await getPromptById(promptId);
  if (!prompt || prompt.project_id !== projectId) {
    throw new Error('Prompt not found');
  }
  const version = await getVersionById(promptVersionId);
  if (!version || version.prompt_id !== promptId) {
    throw new Error('Prompt version not found');
  }

  const existing = await queryOne<PromptDeployment>(
    `SELECT * FROM prompt_deployments
      WHERE project_id = $1 AND prompt_id = $2 AND environment = $3`,
    [projectId, promptId, env]
  );

  if (existing) {
    const updated = await queryOne<PromptDeployment>(
      `UPDATE prompt_deployments
          SET prompt_version_id = $4, deployed_by = $5, note = $6, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING *`,
      [existing.id, projectId, promptId, promptVersionId, options.deployedBy ?? existing.deployed_by, options.note ?? existing.note]
    );
    if (!updated) throw new Error('Failed to update deployment');
    return updated;
  }

  const id = randomUUID();
  const created = await queryOne<PromptDeployment>(
    `INSERT INTO prompt_deployments
       (id, project_id, prompt_id, environment, prompt_version_id, deployed_by, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [id, projectId, promptId, env, promptVersionId, options.deployedBy ?? null, options.note ?? null]
  );
  if (!created) throw new Error('Failed to create deployment');
  return created;
}

/**
 * 列出某个项目（可选过滤 Prompt）的全部 Deployment。
 * @param projectId - 项目 ID
 * @param promptId - 可选，仅返回该 Prompt 的部署
 * @returns Deployment 数组
 */
export async function listDeployments(projectId: string, promptId?: string): Promise<PromptDeployment[]> {
  if (promptId) {
    return query<PromptDeployment>(
      `SELECT * FROM prompt_deployments
        WHERE project_id = $1 AND prompt_id = $2
        ORDER BY environment ASC, updated_at DESC`,
      [projectId, promptId]
    );
  }
  return query<PromptDeployment>(
    `SELECT * FROM prompt_deployments
      WHERE project_id = $1
      ORDER BY prompt_id ASC, environment ASC`,
    [projectId]
  );
}

/**
 * 读取单个 Deployment 记录。
 * @param projectId - 项目 ID
 * @param promptId - Prompt ID
 * @param environment - 环境名
 * @returns Deployment 或 null
 */
export async function getDeployment(
  projectId: string,
  promptId: string,
  environment: string
): Promise<PromptDeployment | null> {
  const env = normalizeEnvironment(environment);
  return queryOne<PromptDeployment>(
    `SELECT * FROM prompt_deployments
      WHERE project_id = $1 AND prompt_id = $2 AND environment = $3`,
    [projectId, promptId, env]
  );
}

/**
 * 删除一个环境的 Deployment（下线）。
 * @param projectId - 项目 ID
 * @param promptId - Prompt ID
 * @param environment - 环境名
 * @returns 是否删除成功
 */
export async function deleteDeployment(
  projectId: string,
  promptId: string,
  environment: string
): Promise<boolean> {
  const env = normalizeEnvironment(environment);
  const result = await queryOne<{ id: string }>(
    `DELETE FROM prompt_deployments
      WHERE project_id = $1 AND prompt_id = $2 AND environment = $3
      RETURNING id`,
    [projectId, promptId, env]
  );
  return result !== null;
}

/**
 * Runtime API：按 promptName + environment 解析当前发布的不可变 PromptVersion 内容。
 * 使用项目内 Prompt 名称唯一约束（若不存在则按 name 精确匹配）。
 * @param projectId - 项目 ID
 * @param promptName - Prompt 名称
 * @param environment - 环境名
 * @returns 解析结果，未发布返回 null
 */
export async function resolveDeployedPrompt(
  projectId: string,
  promptName: string,
  environment: string,
  bucketKey?: string | null
): Promise<{
  deployment: PromptDeployment;
  prompt: Prompt;
  version: PromptVersion;
  etag: string;
  variantKey: string | null;
  bucket: number | null;
} | null> {
  const env = normalizeEnvironment(environment);
  const prompt = await queryOne<Prompt>(
    `SELECT * FROM prompts WHERE project_id = $1 AND name = $2 LIMIT 1`,
    [projectId, promptName]
  );
  if (!prompt) return null;

  const deployment = await queryOne<PromptDeployment>(
    `SELECT * FROM prompt_deployments
      WHERE project_id = $1 AND prompt_id = $2 AND environment = $3`,
    [projectId, prompt.id, env]
  );
  if (!deployment) return null;

  // A/B 分流：命中非基线变体时切换到变体版本，否则使用 Deployment 主指针
  let version = await getVersionById(deployment.prompt_version_id);
  let variantKey: string | null = null;
  let bucket: number | null = null;
  if (bucketKey) {
    const { selectAbVariant } = await import('./prompt-ab-test.js');
    const selection = await selectAbVariant(projectId, prompt.id, env, bucketKey);
    if (selection) {
      const variantVersion = await getVersionById(selection.promptVersionId);
      if (variantVersion) {
        version = variantVersion;
        variantKey = selection.variantKey;
        bucket = selection.bucket;
      }
    }
  }
  if (!version) return null;

  return { deployment, prompt, version, etag: buildEtag(deployment, version), variantKey, bucket };
}

/**
 * 将 PromptVersion 的 config 拆分为 variablesSchema 与 modelDefaults。
 * @param version - PromptVersion
 * @returns 结构化配置
 */
function extractVersionConfig(version: PromptVersion): {
  variablesSchema: Record<string, unknown> | null;
  modelDefaults: Record<string, unknown> | null;
} {
  const cfg = version.config ?? {};
  const variablesSchema =
    cfg && typeof cfg === 'object' && 'variablesSchema' in cfg
      ? (cfg.variablesSchema as Record<string, unknown>)
      : null;
  const modelDefaults =
    cfg && typeof cfg === 'object' && 'modelDefaults' in cfg
      ? (cfg.modelDefaults as Record<string, unknown>)
      : null;
  return { variablesSchema, modelDefaults };
}

/**
 * 将 Deployment 与 PromptVersion 装配为 Runtime API 响应体。
 * @param deployment - Deployment 记录
 * @param prompt - Prompt 主体
 * @param version - 当前发布版本
 * @param etag - ETag
 * @returns Runtime 响应
 */
export function buildRuntimeResponse(
  deployment: PromptDeployment,
  prompt: Prompt,
  version: PromptVersion,
  etag: string,
  variant?: { variantKey: string | null; bucket: number | null }
): ResolvedPromptDeployment {
  const { variablesSchema, modelDefaults } = extractVersionConfig(version);
  return {
    promptId: prompt.id,
    promptName: prompt.name,
    promptVersionId: version.id,
    versionNumber: version.version_number,
    environment: deployment.environment,
    content: version.content,
    variablesSchema,
    modelDefaults,
    etag,
    deployedAt: deployment.updated_at,
    variantKey: variant?.variantKey ?? null,
    bucket: variant?.bucket ?? null,
  };
}

/**
 * 仅供测试使用：清空 prompt_deployments 表。
 */
export async function __clearDeploymentsForTests(): Promise<void> {
  await run('DELETE FROM prompt_deployments', []);
}
