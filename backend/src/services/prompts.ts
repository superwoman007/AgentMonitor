import { query, queryOne, run } from '../db/index.js';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config.js';

// ==================== Types ====================

export interface Prompt {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  content: string;
  config: Record<string, unknown> | null;
  current_version_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface PromptVersion {
  id: string;
  prompt_id: string;
  content: string;
  config: Record<string, unknown> | null;
  version_number: number;
  description: string | null;
  created_at: Date;
}

export interface PlaygroundRun {
  id: string;
  project_id: string;
  prompt_id: string | null;
  prompt_version_id: string | null;
  model: string;
  input: string;
  output: string | null;
  latency_ms: number | null;
  status: string;
  metadata: Record<string, unknown> | null;
  created_at: Date;
}

export interface ModelConfig {
  id: string;
  project_id: string;
  name: string;
  provider: string;
  model: string;
  api_key: string | null;
  base_url: string | null;
  config: Record<string, unknown> | null;
  created_at: Date;
}

// ==================== Prompts ====================

export async function createPrompt(
  projectId: string,
  name: string,
  content: string,
  description?: string,
  cfg?: Record<string, unknown>
): Promise<Prompt> {
  const promptId = uuidv4();
  const versionId = uuidv4();

  // Insert prompt
  const prompt = await queryOne<Prompt>(
    `INSERT INTO prompts (id, project_id, name, description, content, config, current_version_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [promptId, projectId, name, description || null, content, cfg ? JSON.stringify(cfg) : null, versionId]
  );

  if (!prompt) throw new Error('Failed to create prompt');

  // Insert initial version
  await run(
    `INSERT INTO prompt_versions (id, prompt_id, content, config, version_number, description)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [versionId, promptId, content, cfg ? JSON.stringify(cfg) : null, 1, description || null]
  );

  return prompt;
}

export async function getPromptById(promptId: string): Promise<Prompt | null> {
  const row = await queryOne<Prompt>('SELECT * FROM prompts WHERE id = $1', [promptId]);
  if (row && typeof row.config === 'string') {
    row.config = JSON.parse(row.config);
  }
  return row;
}

export async function getPromptsByProject(projectId: string): Promise<Prompt[]> {
  const rows = await query<Prompt>(
    `SELECT * FROM prompts WHERE project_id = $1 ORDER BY updated_at DESC`,
    [projectId]
  );
  return rows.map(row => {
    if (typeof row.config === 'string') row.config = JSON.parse(row.config);
    return row;
  });
}

export async function updatePrompt(
  promptId: string,
  data: { content?: string; config?: Record<string, unknown>; description?: string }
): Promise<Prompt | null> {
  const prompt = await getPromptById(promptId);
  if (!prompt) return null;

  // Get next version number
  const versionCount = await queryOne<{ count: number }>(
    'SELECT COUNT(*) as count FROM prompt_versions WHERE prompt_id = $1',
    [promptId]
  );
  const nextVersion = (versionCount?.count || 0) + 1;
  const newVersionId = uuidv4();

  const nowExpr = config.dbType === 'sqlite' ? "datetime('now')" : 'NOW()';

  const newContent = data.content !== undefined ? data.content : prompt.content;
  const newConfig = data.config !== undefined ? JSON.stringify(data.config) : (prompt.config ? JSON.stringify(prompt.config) : null);
  const newDesc = data.description !== undefined ? data.description : prompt.description;

  const updated = await queryOne<Prompt>(
    `UPDATE prompts SET content = $1, config = $2, description = $3, current_version_id = $4, updated_at = ${nowExpr}
     WHERE id = $5 RETURNING *`,
    [newContent, newConfig, newDesc, newVersionId, promptId]
  );

  // Create new version
  await run(
    `INSERT INTO prompt_versions (id, prompt_id, content, config, version_number, description)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [newVersionId, promptId, newContent, newConfig, nextVersion, newDesc]
  );

  if (updated && typeof updated.config === 'string') {
    updated.config = JSON.parse(updated.config);
  }
  return updated;
}

export async function deletePrompt(promptId: string): Promise<boolean> {
  const result = await queryOne<{ id: string }>(
    'DELETE FROM prompts WHERE id = $1 RETURNING id',
    [promptId]
  );
  return result !== null;
}

// ==================== Prompt Versions ====================

export async function createPromptVersion(
  promptId: string,
  data: { content?: string; config?: Record<string, unknown>; description?: string }
): Promise<{ version: PromptVersion; prompt: Prompt | null }> {
  const prompt = await getPromptById(promptId);
  if (!prompt) throw new Error('Prompt not found');

  const versionCount = await queryOne<{ count: number }>(
    'SELECT COUNT(*) as count FROM prompt_versions WHERE prompt_id = $1',
    [promptId]
  );
  const nextVersion = (versionCount?.count || 0) + 1;
  const newVersionId = uuidv4();

  const nowExpr = config.dbType === 'sqlite' ? "datetime('now')" : 'NOW()';

  const newContent = data.content !== undefined ? data.content : prompt.content;
  const newConfig = data.config !== undefined ? JSON.stringify(data.config) : (prompt.config ? JSON.stringify(prompt.config) : null);
  const newDesc = data.description !== undefined ? data.description : null;

  // Update prompt
  const updated = await queryOne<Prompt>(
    `UPDATE prompts SET content = $1, config = $2, current_version_id = $3, updated_at = ${nowExpr}
     WHERE id = $4 RETURNING *`,
    [newContent, newConfig, newVersionId, promptId]
  );

  // Create version
  await run(
    `INSERT INTO prompt_versions (id, prompt_id, content, config, version_number, description)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [newVersionId, promptId, newContent, newConfig, nextVersion, newDesc]
  );

  const version = await getVersionById(newVersionId);
  if (!version) throw new Error('Failed to create version');

  if (updated && typeof updated.config === 'string') {
    updated.config = JSON.parse(updated.config);
  }

  return { version, prompt: updated };
}

// ==================== Prompt Versions ====================

export async function getVersionsByPrompt(promptId: string): Promise<PromptVersion[]> {
  const rows = await query<PromptVersion>(
    `SELECT * FROM prompt_versions WHERE prompt_id = $1 ORDER BY version_number DESC`,
    [promptId]
  );
  return rows.map(row => {
    if (typeof row.config === 'string') row.config = JSON.parse(row.config);
    return row;
  });
}

export async function getVersionById(versionId: string): Promise<PromptVersion | null> {
  const row = await queryOne<PromptVersion>('SELECT * FROM prompt_versions WHERE id = $1', [versionId]);
  if (row && typeof row.config === 'string') {
    row.config = JSON.parse(row.config);
  }
  return row;
}

export async function rollbackPrompt(promptId: string, versionId: string): Promise<Prompt | null> {
  const version = await getVersionById(versionId);
  if (!version) return null;

  const prompt = await getPromptById(promptId);
  if (!prompt) return null;

  const nowExpr = config.dbType === 'sqlite' ? "datetime('now')" : 'NOW()';

  const updated = await queryOne<Prompt>(
    `UPDATE prompts SET content = $1, config = $2, current_version_id = $3, updated_at = ${nowExpr}
     WHERE id = $4 RETURNING *`,
    [version.content, version.config ? JSON.stringify(version.config) : null, versionId, promptId]
  );

  if (updated && typeof updated.config === 'string') {
    updated.config = JSON.parse(updated.config);
  }
  return updated;
}

// ==================== Playground Runs ====================

export async function createRun(
  projectId: string,
  data: {
    prompt_id?: string;
    prompt_version_id?: string;
    model: string;
    input: string;
    output?: string;
    latency_ms?: number;
    status?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<PlaygroundRun> {
  const runId = uuidv4();

  const result = await queryOne<PlaygroundRun>(
    `INSERT INTO playground_runs (id, project_id, prompt_id, prompt_version_id, model, input, output, latency_ms, status, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      runId, projectId, data.prompt_id || null, data.prompt_version_id || null,
      data.model, data.input, data.output || null,
      data.latency_ms !== undefined ? data.latency_ms : null,
      data.status || 'success',
      data.metadata ? JSON.stringify(data.metadata) : null
    ]
  );

  if (!result) throw new Error('Failed to create run');
  return result;
}

export async function getRunById(runId: string): Promise<PlaygroundRun | null> {
  return queryOne<PlaygroundRun>('SELECT * FROM playground_runs WHERE id = $1', [runId]);
}

export async function getRunsByProject(projectId: string, promptId?: string): Promise<PlaygroundRun[]> {
  let sql = `SELECT * FROM playground_runs WHERE project_id = $1`;
  const params: unknown[] = [projectId];
  if (promptId) {
    sql += ` AND prompt_id = $2`;
    params.push(promptId);
  }
  sql += ` ORDER BY created_at DESC`;
  return query<PlaygroundRun>(sql, params);
}

// ==================== Model Configs ====================

export async function createModelConfig(
  projectId: string,
  name: string,
  provider: string,
  model: string,
  cfg?: Record<string, unknown>,
  apiKey?: string,
  baseUrl?: string
): Promise<ModelConfig> {
  const configId = uuidv4();

  const result = await queryOne<ModelConfig>(
    `INSERT INTO model_configs (id, project_id, name, provider, model, config, api_key, base_url)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [configId, projectId, name, provider, model, cfg ? JSON.stringify(cfg) : null, apiKey || null, baseUrl || null]
  );

  if (!result) throw new Error('Failed to create model config');
  if (typeof result.config === 'string') {
    result.config = JSON.parse(result.config);
  }
  return result;
}

export async function getModelConfigById(configId: string): Promise<ModelConfig | null> {
  const row = await queryOne<ModelConfig>('SELECT * FROM model_configs WHERE id = $1', [configId]);
  if (row && typeof row.config === 'string') {
    row.config = JSON.parse(row.config);
  }
  return row;
}

export async function getModelConfigsByProject(projectId: string): Promise<ModelConfig[]> {
  const rows = await query<ModelConfig>(
    `SELECT * FROM model_configs WHERE project_id = $1 ORDER BY created_at DESC`,
    [projectId]
  );
  return rows.map(row => {
    if (typeof row.config === 'string') row.config = JSON.parse(row.config);
    return row;
  });
}

export async function deleteModelConfig(configId: string): Promise<boolean> {
  const result = await queryOne<{ id: string }>(
    'DELETE FROM model_configs WHERE id = $1 RETURNING id',
    [configId]
  );
  return result !== null;
}
