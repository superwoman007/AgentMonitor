import { randomUUID } from 'crypto';
import { toDbBool, query, queryOne, run } from '../db/index.js';
import { config } from '../config.js';
import { getPromptById, getVersionById, getModelConfigById } from './prompts.js';
import { callTargetModel } from './evaluation-target.js';

export type AgentTargetType = 'prompt_model' | 'http_agent' | 'external_runner' | 'trace_replay';

export interface AgentTarget {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  target_type: AgentTargetType;
  current_version_id: string | null;
  enabled: boolean;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface AgentTargetVersion {
  id: string;
  target_id: string;
  version_number: number;
  target_type: AgentTargetType;
  invocation_config: Record<string, unknown>;
  input_mapping: Record<string, string> | null;
  output_mapping: Record<string, string> | null;
  source_revision: Record<string, unknown> | null;
  created_by: string | null;
  created_at: Date;
}

export interface CreateTargetInput {
  projectId: string;
  name: string;
  description?: string;
  type: AgentTargetType;
  invocationConfig: Record<string, unknown>;
  inputMapping?: Record<string, string>;
  outputMapping?: Record<string, string>;
  sourceRevision?: Record<string, unknown>;
  enabled?: boolean;
  createdBy?: string;
}

export interface CreateTargetVersionInput {
  invocationConfig: Record<string, unknown>;
  inputMapping?: Record<string, string>;
  outputMapping?: Record<string, string>;
  sourceRevision?: Record<string, unknown>;
  createdBy?: string;
}

export interface PromptModelInvocationConfig {
  promptId?: string;
  promptVersionId?: string;
  modelConfigId: string;
  runConfig?: Record<string, unknown>;
}

export interface TargetInvokeResult {
  output: string;
  latencyMs: number;
  traceId?: string;
  tokenUsage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  error?: string;
}

const NOW_EXPRESSION = config.dbType === 'sqlite' ? "datetime('now')" : 'NOW()';
const SUPPORTED_TARGET_TYPES = new Set<AgentTargetType>([
  'prompt_model',
  'http_agent',
  'external_runner',
  'trace_replay',
]);

/**
 * 将数据库 JSON 字段解析为对象。
 * @param value - 数据库字段值
 * @returns 解析后的对象；空值或解析失败返回 null
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
 * 归一化数据库返回的 Target 行。
 * @param row - 数据库原始行
 * @returns AgentTarget 对象
 */
function mapTarget(row: Record<string, unknown>): AgentTarget {
  return {
    id: row.id as string,
    project_id: row.project_id as string,
    name: row.name as string,
    description: (row.description as string | null) ?? null,
    target_type: row.target_type as AgentTargetType,
    current_version_id: (row.current_version_id as string | null) ?? null,
    enabled: !!row.enabled,
    created_by: (row.created_by as string | null) ?? null,
    created_at: new Date(row.created_at as string),
    updated_at: new Date(row.updated_at as string),
  };
}

/**
 * 归一化数据库返回的 TargetVersion 行。
 * @param row - 数据库原始行
 * @returns AgentTargetVersion 对象
 */
function mapVersion(row: Record<string, unknown>): AgentTargetVersion {
  return {
    id: row.id as string,
    target_id: row.target_id as string,
    version_number: Number(row.version_number),
    target_type: row.target_type as AgentTargetType,
    invocation_config: parseJsonField<Record<string, unknown>>(row.invocation_config) ?? {},
    input_mapping: parseJsonField<Record<string, string>>(row.input_mapping),
    output_mapping: parseJsonField<Record<string, string>>(row.output_mapping),
    source_revision: parseJsonField<Record<string, unknown>>(row.source_revision),
    created_by: (row.created_by as string | null) ?? null,
    created_at: new Date(row.created_at as string),
  };
}

/**
 * 校验 Target 类型与 prompt_model 配置完整性。
 * @param type - Target 类型
 * @param invocationConfig - 调用配置
 */
function validateTargetDefinition(type: AgentTargetType, invocationConfig: Record<string, unknown>): void {
  if (!SUPPORTED_TARGET_TYPES.has(type)) {
    throw new Error(`Unsupported target type: ${type}`);
  }

  if (type === 'prompt_model') {
    const config = invocationConfig as Partial<PromptModelInvocationConfig>;
    if (!config.modelConfigId) {
      throw new Error('prompt_model target requires modelConfigId');
    }
  }
}

/**
 * 创建 Target 及其首个不可变版本。
 * @param input - Target 创建参数
 * @returns 创建后的 Target 与首个版本
 */
export async function createTarget(
  input: CreateTargetInput
): Promise<{ target: AgentTarget; version: AgentTargetVersion }> {
  validateTargetDefinition(input.type, input.invocationConfig);

  const targetId = randomUUID();
  const versionId = randomUUID();
  const enabled = input.enabled ?? true;

  const target = await queryOne<Record<string, unknown>>(
    `INSERT INTO agent_targets (
       id, project_id, name, description, target_type, current_version_id, enabled, created_by
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      targetId,
      input.projectId,
      input.name,
      input.description ?? null,
      input.type,
      versionId,
      toDbBool(enabled),
      input.createdBy ?? null,
    ]
  );

  if (!target) {
    throw new Error('Failed to create agent target');
  }

  const version = await queryOne<Record<string, unknown>>(
    `INSERT INTO agent_target_versions (
       id, target_id, version_number, target_type, invocation_config,
       input_mapping, output_mapping, source_revision, created_by
     ) VALUES ($1, $2, 1, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      versionId,
      targetId,
      input.type,
      JSON.stringify(input.invocationConfig),
      input.inputMapping ? JSON.stringify(input.inputMapping) : null,
      input.outputMapping ? JSON.stringify(input.outputMapping) : null,
      input.sourceRevision ? JSON.stringify(input.sourceRevision) : null,
      input.createdBy ?? null,
    ]
  );

  if (!version) {
    throw new Error('Failed to create agent target version');
  }

  return { target: mapTarget(target), version: mapVersion(version) };
}

/**
 * 查询项目下的 Target 列表。
 * @param projectId - 项目 ID
 * @returns Target 列表
 */
export async function listTargets(projectId: string): Promise<AgentTarget[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT * FROM agent_targets WHERE project_id = $1 ORDER BY created_at DESC`,
    [projectId]
  );
  return rows.map(mapTarget);
}

/**
 * 按 ID 查询 Target。
 * @param targetId - Target ID
 * @returns Target 或 null
 */
export async function getTargetById(targetId: string): Promise<AgentTarget | null> {
  const row = await queryOne<Record<string, unknown>>(
    'SELECT * FROM agent_targets WHERE id = $1',
    [targetId]
  );
  return row ? mapTarget(row) : null;
}

/**
 * 查询 Target 的版本列表。
 * @param targetId - Target ID
 * @returns 版本列表
 */
export async function listTargetVersions(targetId: string): Promise<AgentTargetVersion[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT * FROM agent_target_versions WHERE target_id = $1 ORDER BY version_number DESC`,
    [targetId]
  );
  return rows.map(mapVersion);
}

/**
 * 按 ID 查询 TargetVersion。
 * @param versionId - 版本 ID
 * @returns TargetVersion 或 null
 */
export async function getTargetVersionById(versionId: string): Promise<AgentTargetVersion | null> {
  const row = await queryOne<Record<string, unknown>>(
    'SELECT * FROM agent_target_versions WHERE id = $1',
    [versionId]
  );
  return row ? mapVersion(row) : null;
}

/**
 * 为 Target 创建新的不可变版本，并更新 current_version_id。
 * @param targetId - Target ID
 * @param input - 新版本参数
 * @returns 更新后的 Target 与新版本
 */
export async function createTargetVersion(
  targetId: string,
  input: CreateTargetVersionInput
): Promise<{ target: AgentTarget; version: AgentTargetVersion }> {
  const existing = await getTargetById(targetId);
  if (!existing) {
    throw new Error('Target not found');
  }

  validateTargetDefinition(existing.target_type, input.invocationConfig);
  const versions = await listTargetVersions(targetId);
  const nextVersionNumber = versions.length > 0 ? versions[0].version_number + 1 : 1;
  const versionId = randomUUID();

  const inserted = await queryOne<Record<string, unknown>>(
    `INSERT INTO agent_target_versions (
       id, target_id, version_number, target_type, invocation_config,
       input_mapping, output_mapping, source_revision, created_by
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      versionId,
      targetId,
      nextVersionNumber,
      existing.target_type,
      JSON.stringify(input.invocationConfig),
      input.inputMapping ? JSON.stringify(input.inputMapping) : null,
      input.outputMapping ? JSON.stringify(input.outputMapping) : null,
      input.sourceRevision ? JSON.stringify(input.sourceRevision) : null,
      input.createdBy ?? null,
    ]
  );

  if (!inserted) {
    throw new Error('Failed to create target version');
  }

  await run(
    `UPDATE agent_targets
     SET current_version_id = $1, updated_at = ${NOW_EXPRESSION}
     WHERE id = $2`,
    [versionId, targetId]
  );

  const updated = await getTargetById(targetId);
  if (!updated) {
    throw new Error('Failed to reload target after version creation');
  }

  return { target: updated, version: mapVersion(inserted) };
}

/**
 * 将旧 ModelConfig 包装为 prompt_model Target。
 * @param projectId - 项目 ID
 * @param modelConfigId - 模型配置 ID
 * @param createdBy - 创建人 ID
 * @returns 创建后的 Target 与版本
 */
export async function ensureModelConfigTarget(
  projectId: string,
  modelConfigId: string,
  createdBy?: string
): Promise<{ target: AgentTarget; version: AgentTargetVersion; created: boolean }> {
  const modelConfig = await getModelConfigById(modelConfigId);
  if (!modelConfig) {
    throw new Error(`Model config not found: ${modelConfigId}`);
  }

  const compatibilityName = `Model: ${modelConfig.name}`;
  const existing = await queryOne<Record<string, unknown>>(
    'SELECT * FROM agent_targets WHERE project_id = $1 AND name = $2',
    [projectId, compatibilityName]
  );

  if (existing) {
    const target = mapTarget(existing);
    const version = target.current_version_id
      ? await getTargetVersionById(target.current_version_id)
      : (await listTargetVersions(target.id))[0] ?? null;
    if (!version) {
      throw new Error('Compatibility target has no version');
    }
    return { target, version, created: false };
  }

  const result = await createTarget({
    projectId,
    name: compatibilityName,
    description: '旧 ModelConfig 自动包装为兼容 Target',
    type: 'prompt_model',
    invocationConfig: { modelConfigId },
    createdBy,
  });
  return { ...result, created: true };
}

/**
 * 执行 prompt_model TargetVersion。
 * @param version - Target 版本
 * @param input - 用户输入
 * @returns 标准化调用结果
 */
export async function invokePromptModelTarget(
  version: AgentTargetVersion,
  input: string
): Promise<TargetInvokeResult> {
  if (version.target_type !== 'prompt_model') {
    throw new Error(`Target type ${version.target_type} is not invocable by prompt_model adapter`);
  }

  const config = version.invocation_config as unknown as PromptModelInvocationConfig;
  if (config.promptVersionId) {
    const promptVersion = await getVersionById(config.promptVersionId);
    if (!promptVersion) {
      throw new Error(`Prompt version not found: ${config.promptVersionId}`);
    }
    if (config.promptId && promptVersion.prompt_id !== config.promptId) {
      throw new Error('Prompt version does not belong to the configured prompt');
    }
  } else if (config.promptId) {
    const prompt = await getPromptById(config.promptId);
    if (!prompt) {
      throw new Error(`Prompt not found: ${config.promptId}`);
    }
  }
  const modelConfig = await getModelConfigById(config.modelConfigId);
  if (!modelConfig) {
    throw new Error(`Model config not found: ${config.modelConfigId}`);
  }

  return callTargetModel({
    input,
    promptId: config.promptId ?? null,
    promptVersionId: config.promptVersionId ?? null,
    modelConfigId: config.modelConfigId,
    runConfig: config.runConfig,
  });
}
