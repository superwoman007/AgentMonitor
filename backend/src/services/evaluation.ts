import { query, queryOne, run } from '../db/index.js';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config.js';

// ==================== Types ====================

export interface Dataset {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  type: string;
  column_schema: unknown | null;
  item_count: number;
  current_version_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface DatasetItem {
  id: string;
  dataset_id: string;
  input: string;
  expected_output: string | null;
  fields: unknown | null;
  metadata: string | null;
  created_at: Date;
}

export interface Evaluator {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  type: string;
  config: Record<string, unknown>;
  model_config_id: string | null;
  current_version_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface EvaluationExperiment {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  dataset_id: string;
  model_config: Record<string, unknown> | null;
  prompt_id: string | null;
  prompt_version_id: string | null;
  target_model_config_id: string | null;
  run_config: Record<string, unknown> | null;
  status: 'pending' | 'running' | 'completed' | 'failed';
  results_summary: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
}

export interface EvaluationResult {
  id: string;
  experiment_id: string;
  dataset_item_id: string;
  evaluator_id: string | null;
  output: string | null;
  score: number | null;
  passed: number;
  details: Record<string, unknown> | null;
  latency_ms: number | null;
  calibrated_score: number | null;
  calibrated_passed: number | null;
  calibration_note: string | null;
  calibrated_at: string | null;
  calibrated_by: string | null;
  created_at: Date;
}

const VALID_EVALUATOR_TYPES = ['exact_match', 'contains', 'llm_judge', 'regex', 'similarity'];
const VALID_EXPERIMENT_STATUSES = ['pending', 'running', 'completed', 'failed'];

// ==================== Datasets ====================

export async function createDataset(
  projectId: string,
  name: string,
  description?: string,
  type: string = 'custom'
): Promise<Dataset> {
  const datasetId = uuidv4();
  const dataset = await queryOne<Dataset>(
    `INSERT INTO datasets (id, project_id, name, description, type)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [datasetId, projectId, name, description || null, type]
  );

  if (!dataset) {
    throw new Error('Failed to create dataset');
  }

  return dataset;
}

export async function getDatasetById(datasetId: string): Promise<Dataset | null> {
  const row = await queryOne<Dataset>('SELECT * FROM datasets WHERE id = $1', [datasetId]);
  if (!row) return null;
  if (row.column_schema && typeof row.column_schema === 'string') {
    try { row.column_schema = JSON.parse(row.column_schema); } catch { row.column_schema = null; }
  }
  return row;
}

export async function getDatasetsByProject(projectId: string): Promise<Dataset[]> {
  const rows = await query<Dataset>(
    `SELECT * FROM datasets WHERE project_id = $1 ORDER BY created_at DESC`,
    [projectId]
  );
  return rows.map(row => {
    if (row.column_schema && typeof row.column_schema === 'string') {
      try { row.column_schema = JSON.parse(row.column_schema); } catch { row.column_schema = null; }
    }
    return row;
  });
}

export async function updateDataset(
  datasetId: string,
  data: { name?: string; description?: string; type?: string; column_schema?: string }
): Promise<Dataset | null> {
  const updates: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (data.name !== undefined) {
    updates.push(`name = $${paramIndex}`);
    params.push(data.name);
    paramIndex++;
  }

  if (data.description !== undefined) {
    updates.push(`description = $${paramIndex}`);
    params.push(data.description);
    paramIndex++;
  }

  if (data.type !== undefined) {
    updates.push(`type = $${paramIndex}`);
    params.push(data.type);
    paramIndex++;
  }

  if (data.column_schema !== undefined) {
    updates.push(`column_schema = $${paramIndex}`);
    params.push(data.column_schema);
    paramIndex++;
  }

  if (updates.length === 0) {
    return getDatasetById(datasetId);
  }

  const nowExpr = config.dbType === 'sqlite' ? "datetime('now')" : 'NOW()';
  updates.push(`updated_at = ${nowExpr}`);
  params.push(datasetId);

  const row = await queryOne<Dataset>(
    `UPDATE datasets SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    params
  );
  if (row && row.column_schema && typeof row.column_schema === 'string') {
    try { row.column_schema = JSON.parse(row.column_schema); } catch { row.column_schema = null; }
  }
  return row;
}

export async function deleteDataset(datasetId: string): Promise<boolean> {
  const result = await queryOne<{ id: string }>(
    'DELETE FROM datasets WHERE id = $1 RETURNING id',
    [datasetId]
  );
  return result !== null;
}

// ==================== Dataset Items ====================

export async function addDatasetItems(
  datasetId: string,
  items: Array<{ input: string; expected_output?: string; fields?: Record<string, unknown>; metadata?: Record<string, unknown> }>
): Promise<DatasetItem[]> {
  const createdItems: DatasetItem[] = [];

  for (const item of items) {
    const itemId = uuidv4();
    const created = await queryOne<DatasetItem>(
      `INSERT INTO dataset_items (id, dataset_id, input, expected_output, fields, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [itemId, datasetId, item.input, item.expected_output || null, item.fields ? JSON.stringify(item.fields) : null, item.metadata ? JSON.stringify(item.metadata) : null]
    );
    if (created) {
      if (created.fields && typeof created.fields === 'string') {
        try { created.fields = JSON.parse(created.fields); } catch { created.fields = null; }
      }
      createdItems.push(created);
    }
  }

  // Update item_count
  await run(
    `UPDATE datasets SET item_count = (SELECT COUNT(*) FROM dataset_items WHERE dataset_id = $1) WHERE id = $2`,
    [datasetId, datasetId]
  );

  return createdItems;
}

export async function getDatasetItems(datasetId: string): Promise<DatasetItem[]> {
  const rows = await query<DatasetItem>(
    `SELECT * FROM dataset_items WHERE dataset_id = $1 ORDER BY created_at ASC`,
    [datasetId]
  );
  return rows.map(row => {
    if (row.fields && typeof row.fields === 'string') {
      try { row.fields = JSON.parse(row.fields); } catch { row.fields = null; }
    }
    return row;
  });
}

export async function updateDatasetItem(
  itemId: string,
  data: { input?: string; expected_output?: string; fields?: Record<string, unknown>; metadata?: Record<string, unknown> }
): Promise<DatasetItem | null> {
  const updates: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (data.input !== undefined) {
    updates.push(`input = $${paramIndex}`);
    params.push(data.input);
    paramIndex++;
  }

  if (data.expected_output !== undefined) {
    updates.push(`expected_output = $${paramIndex}`);
    params.push(data.expected_output);
    paramIndex++;
  }

  if (data.fields !== undefined) {
    updates.push(`fields = $${paramIndex}`);
    params.push(JSON.stringify(data.fields));
    paramIndex++;
  }

  if (data.metadata !== undefined) {
    updates.push(`metadata = $${paramIndex}`);
    params.push(JSON.stringify(data.metadata));
    paramIndex++;
  }

  if (updates.length === 0) {
    return queryOne<DatasetItem>('SELECT * FROM dataset_items WHERE id = $1', [itemId]);
  }

  params.push(itemId);

  const row = await queryOne<DatasetItem>(
    `UPDATE dataset_items SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    params
  );
  if (row && row.fields && typeof row.fields === 'string') {
    try { row.fields = JSON.parse(row.fields); } catch { row.fields = null; }
  }
  return row;
}

export async function deleteDatasetItem(itemId: string): Promise<boolean> {
  const item = await queryOne<{ dataset_id: string }>(
    'DELETE FROM dataset_items WHERE id = $1 RETURNING dataset_id',
    [itemId]
  );

  if (item) {
    await run(
      `UPDATE datasets SET item_count = (SELECT COUNT(*) FROM dataset_items WHERE dataset_id = $1) WHERE id = $2`,
      [item.dataset_id, item.dataset_id]
    );
  }

  return item !== null;
}

// ==================== Evaluators ====================

export function isValidEvaluatorType(type: string): boolean {
  return VALID_EVALUATOR_TYPES.includes(type);
}

export async function createEvaluator(
  projectId: string,
  name: string,
  type: string,
  description?: string,
  config: Record<string, unknown> = {},
  modelConfigId?: string
): Promise<Evaluator> {
  const evaluatorId = uuidv4();

  let evaluator = await queryOne<Evaluator>(
    `INSERT INTO evaluators (id, project_id, name, description, type, config, model_config_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [evaluatorId, projectId, name, description || null, type, JSON.stringify(config), modelConfigId || null]
  );

  if (!evaluator) {
    throw new Error('Failed to create evaluator');
  }

  if (typeof evaluator.config === 'string') {
    evaluator.config = JSON.parse(evaluator.config);
  }

  return evaluator;
}

export async function getEvaluatorById(evaluatorId: string): Promise<Evaluator | null> {
  const row = await queryOne<Evaluator>('SELECT * FROM evaluators WHERE id = $1', [evaluatorId]);
  if (row && typeof row.config === 'string') {
    row.config = JSON.parse(row.config);
  }
  return row;
}

export async function getEvaluatorsByProject(projectId: string): Promise<Evaluator[]> {
  const rows = await query<Evaluator>(
    `SELECT * FROM evaluators WHERE project_id = $1 ORDER BY created_at DESC`,
    [projectId]
  );
  return rows.map(row => {
    if (typeof row.config === 'string') {
      row.config = JSON.parse(row.config);
    }
    return row;
  });
}

export async function updateEvaluator(
  evaluatorId: string,
  data: { name?: string; description?: string; type?: string; config?: Record<string, unknown>; model_config_id?: string }
): Promise<Evaluator | null> {
  const updates: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (data.name !== undefined) {
    updates.push(`name = $${paramIndex}`);
    params.push(data.name);
    paramIndex++;
  }

  if (data.description !== undefined) {
    updates.push(`description = $${paramIndex}`);
    params.push(data.description);
    paramIndex++;
  }

  if (data.type !== undefined) {
    updates.push(`type = $${paramIndex}`);
    params.push(data.type);
    paramIndex++;
  }

  if (data.config !== undefined) {
    updates.push(`config = $${paramIndex}`);
    params.push(JSON.stringify(data.config));
    paramIndex++;
  }

  if (data.model_config_id !== undefined) {
    updates.push(`model_config_id = $${paramIndex}`);
    params.push(data.model_config_id);
    paramIndex++;
  }

  if (updates.length === 0) {
    return getEvaluatorById(evaluatorId);
  }

  const nowExpr = config.dbType === 'sqlite' ? "datetime('now')" : 'NOW()';
  updates.push(`updated_at = ${nowExpr}`);
  params.push(evaluatorId);

  const row = await queryOne<Evaluator>(
    `UPDATE evaluators SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    params
  );

  if (row && typeof row.config === 'string') {
    row.config = JSON.parse(row.config);
  }
  return row;
}

export async function deleteEvaluator(evaluatorId: string): Promise<boolean> {
  const result = await queryOne<{ id: string }>(
    'DELETE FROM evaluators WHERE id = $1 RETURNING id',
    [evaluatorId]
  );
  return result !== null;
}

// ==================== Evaluation Experiments ====================

export async function createExperiment(
  projectId: string,
  name: string,
  datasetId: string,
  description?: string,
  modelConfig?: Record<string, unknown>,
  promptId?: string,
  promptVersionId?: string,
  targetModelConfigId?: string,
  runConfig?: Record<string, unknown>
): Promise<EvaluationExperiment> {
  const experimentId = uuidv4();

  const experiment = await queryOne<EvaluationExperiment>(
    `INSERT INTO evaluation_experiments (
       id, project_id, name, description, dataset_id, model_config,
       prompt_id, prompt_version_id, target_model_config_id, run_config
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      experimentId, projectId, name, description || null, datasetId,
      modelConfig ? JSON.stringify(modelConfig) : null,
      promptId || null,
      promptVersionId || null,
      targetModelConfigId || null,
      runConfig ? JSON.stringify(runConfig) : null,
    ]
  );

  if (!experiment) {
    throw new Error('Failed to create experiment');
  }

  return experiment;
}

export async function getExperimentById(experimentId: string): Promise<EvaluationExperiment | null> {
  const row = await queryOne<EvaluationExperiment>('SELECT * FROM evaluation_experiments WHERE id = $1', [experimentId]);
  if (row) {
    if (typeof row.model_config === 'string') row.model_config = JSON.parse(row.model_config);
    if (typeof row.results_summary === 'string') row.results_summary = JSON.parse(row.results_summary);
    if (typeof row.run_config === 'string') row.run_config = JSON.parse(row.run_config);
  }
  return row;
}

export async function getExperimentsByProject(projectId: string): Promise<EvaluationExperiment[]> {
  const rows = await query<EvaluationExperiment>(
    `SELECT * FROM evaluation_experiments WHERE project_id = $1 ORDER BY created_at DESC`,
    [projectId]
  );
  return rows.map(row => {
    if (typeof row.model_config === 'string') row.model_config = JSON.parse(row.model_config);
    if (typeof row.results_summary === 'string') row.results_summary = JSON.parse(row.results_summary);
    if (typeof row.run_config === 'string') row.run_config = JSON.parse(row.run_config);
    return row;
  });
}

export async function startExperiment(experimentId: string): Promise<EvaluationExperiment | null> {
  const nowExpr = config.dbType === 'sqlite' ? "datetime('now')" : 'NOW()';
  const row = await queryOne<EvaluationExperiment>(
    `UPDATE evaluation_experiments SET status = 'running', started_at = ${nowExpr} WHERE id = $1 RETURNING *`,
    [experimentId]
  );
  if (row) {
    if (typeof row.model_config === 'string') row.model_config = JSON.parse(row.model_config);
    if (typeof row.results_summary === 'string') row.results_summary = JSON.parse(row.results_summary);
    if (typeof row.run_config === 'string') row.run_config = JSON.parse(row.run_config);
  }
  return row;
}

export async function completeExperiment(
  experimentId: string,
  resultsSummary?: Record<string, unknown>
): Promise<EvaluationExperiment | null> {
  const nowExpr = config.dbType === 'sqlite' ? "datetime('now')" : 'NOW()';
  const row = await queryOne<EvaluationExperiment>(
    `UPDATE evaluation_experiments SET status = 'completed', completed_at = ${nowExpr}, results_summary = $1 WHERE id = $2 RETURNING *`,
    [resultsSummary ? JSON.stringify(resultsSummary) : null, experimentId]
  );
  if (row) {
    if (typeof row.model_config === 'string') row.model_config = JSON.parse(row.model_config);
    if (typeof row.results_summary === 'string') row.results_summary = JSON.parse(row.results_summary);
    if (typeof row.run_config === 'string') row.run_config = JSON.parse(row.run_config);
  }
  return row;
}

export async function deleteExperiment(experimentId: string): Promise<boolean> {
  const result = await queryOne<{ id: string }>(
    'DELETE FROM evaluation_experiments WHERE id = $1 RETURNING id',
    [experimentId]
  );
  return result !== null;
}

// ==================== Evaluation Results ====================

export async function createResult(
  experimentId: string,
  datasetItemId: string,
  data: {
    evaluator_id?: string;
    output?: string;
    score?: number;
    passed?: boolean;
    details?: Record<string, unknown>;
    latency_ms?: number;
  }
): Promise<EvaluationResult> {
  const resultId = uuidv4();

  const result = await queryOne<EvaluationResult>(
    `INSERT INTO evaluation_results (id, experiment_id, dataset_item_id, evaluator_id, output, score, passed, details, latency_ms)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      resultId,
      experimentId,
      datasetItemId,
      data.evaluator_id || null,
      data.output || null,
      data.score !== undefined ? data.score : null,
      data.passed ? 1 : 0,
      data.details ? JSON.stringify(data.details) : null,
      data.latency_ms !== undefined ? data.latency_ms : null,
    ]
  );

  if (!result) {
    throw new Error('Failed to create evaluation result');
  }

  return result;
}

export async function getResultById(resultId: string): Promise<EvaluationResult | null> {
  const row = await queryOne<EvaluationResult>('SELECT * FROM evaluation_results WHERE id = $1', [resultId]);
  if (row && typeof row.details === 'string') {
    row.details = JSON.parse(row.details);
  }
  return row;
}

export async function getResultsByExperiment(experimentId: string): Promise<EvaluationResult[]> {
  const rows = await query<EvaluationResult>(
    `SELECT * FROM evaluation_results WHERE experiment_id = $1 ORDER BY created_at ASC`,
    [experimentId]
  );
  return rows.map(row => {
    if (typeof row.details === 'string') {
      row.details = JSON.parse(row.details);
    }
    return row;
  });
}


// ==================== Dataset Version Management ====================

export interface DatasetVersion {
  id: string;
  dataset_id: string;
  version_number: number;
  name: string | null;
  description: string | null;
  column_schema: unknown | null;
  item_data: unknown;
  item_count: number;
  created_by: string | null;
  created_at: Date;
}

export async function commitDatasetVersion(
  datasetId: string,
  data: { description?: string; createdBy?: string }
): Promise<DatasetVersion> {
  const dataset = await getDatasetById(datasetId);
  if (!dataset) throw new Error('Dataset not found');

  const items = await getDatasetItems(datasetId);
  const maxVersion = await queryOne<{ max: number | null }>(
    'SELECT MAX(version_number) as max FROM dataset_versions WHERE dataset_id = $1',
    [datasetId]
  );
  const versionNumber = (maxVersion?.max ?? 0) + 1;

  const versionId = uuidv4();
  const version = await queryOne<DatasetVersion>(
    `INSERT INTO dataset_versions (id, dataset_id, version_number, description, column_schema, item_data, item_count, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      versionId,
      datasetId,
      versionNumber,
      data.description || null,
      dataset.column_schema ? JSON.stringify(dataset.column_schema) : null,
      JSON.stringify(items),
      items.length,
      data.createdBy || null,
    ]
  );

  if (!version) throw new Error('Failed to create dataset version');

  // Update dataset current_version_id
  await run(
    `UPDATE datasets SET current_version_id = $1 WHERE id = $2`,
    [versionId, datasetId]
  );

  return {
    ...version,
    column_schema: version.column_schema ? JSON.parse(version.column_schema as string) : null,
    item_data: JSON.parse(version.item_data as string),
  };
}

export async function getDatasetVersions(datasetId: string): Promise<DatasetVersion[]> {
  const rows = await query<DatasetVersion>(
    `SELECT * FROM dataset_versions WHERE dataset_id = $1 ORDER BY version_number DESC`,
    [datasetId]
  );
  return rows.map(row => ({
    ...row,
    column_schema: row.column_schema ? JSON.parse(row.column_schema as string) : null,
    item_data: JSON.parse(row.item_data as string),
  }));
}

export async function rollbackDatasetVersion(datasetId: string, versionId: string): Promise<{ success: boolean; message: string }> {
  const version = await queryOne<DatasetVersion>(
    'SELECT * FROM dataset_versions WHERE id = $1 AND dataset_id = $2',
    [versionId, datasetId]
  );
  if (!version) return { success: false, message: 'Version not found' };

  const items = JSON.parse(version.item_data as string) as DatasetItem[];

  // Clear current items
  await run('DELETE FROM dataset_items WHERE dataset_id = $1', [datasetId]);

  // Restore items from version
  for (const item of items) {
    await run(
      `INSERT INTO dataset_items (id, dataset_id, input, expected_output, fields, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        item.id,
        datasetId,
        item.input,
        item.expected_output || null,
        item.fields ? JSON.stringify(item.fields) : null,
        item.metadata ? JSON.stringify(item.metadata) : null,
        item.created_at,
      ]
    );
  }

  // Update dataset item_count and current_version_id
  await run(
    `UPDATE datasets SET item_count = $1, current_version_id = $2, column_schema = $3 WHERE id = $4`,
    [items.length, versionId, version.column_schema, datasetId]
  );

  return { success: true, message: `rolled back to version ${version.version_number}` };
}

// ==================== Data Reflow ====================

export async function reflowFromSession(
  targetDatasetId: string,
  sessionId: string,
  mapping?: { input_field?: string; output_field?: string }
): Promise<{ added_count: number; dataset_id: string }> {
  const { getMessagesBySession } = await import('./session.js');
  const messages = await getMessagesBySession(sessionId);

  const userMessages = messages.filter(m => m.role === 'user');
  const assistantMessages = messages.filter(m => m.role === 'assistant');

  const pairs: Array<{ input: string; expected_output: string }> = [];
  for (let i = 0; i < userMessages.length; i++) {
    const userMsg = userMessages[i];
    const assistantMsg = assistantMessages[i];
    if (userMsg && assistantMsg) {
      pairs.push({ input: userMsg.content, expected_output: assistantMsg.content });
    }
  }

  if (pairs.length > 0) {
    await addDatasetItems(targetDatasetId, pairs);
  }

  return { added_count: pairs.length, dataset_id: targetDatasetId };
}

export async function reflowFromTraces(
  targetDatasetId: string,
  sessionId: string,
  traceTypeFilter?: string
): Promise<{ added_count: number; dataset_id: string }> {
  const { query: dbQuery } = await import('../db/index.js');
  const conditions = ['session_id = $1'];
  const params: unknown[] = [sessionId];
  if (traceTypeFilter) {
    conditions.push('trace_type = $2');
    params.push(traceTypeFilter);
  }

  const traces = await dbQuery<{ input: string; output: string }>(
    `SELECT input, output FROM traces WHERE ${conditions.join(' AND ')} ORDER BY started_at ASC`,
    params
  );

  const items = traces
    .filter(t => t.input && t.output)
    .map(t => {
      let inputStr = '';
      let outputStr = '';
      try {
        const inputObj = typeof t.input === 'string' ? JSON.parse(t.input) : t.input;
        const outputObj = typeof t.output === 'string' ? JSON.parse(t.output) : t.output;
        inputStr = inputObj?.content || JSON.stringify(inputObj);
        outputStr = outputObj?.content || JSON.stringify(outputObj);
      } catch {
        inputStr = String(t.input);
        outputStr = String(t.output);
      }
      return { input: inputStr, expected_output: outputStr };
    });

  if (items.length > 0) {
    await addDatasetItems(targetDatasetId, items);
  }

  return { added_count: items.length, dataset_id: targetDatasetId };
}

// ==================== Evaluator Version Management ====================

export interface EvaluatorVersion {
  id: string;
  evaluator_id: string;
  version_number: number;
  name: string | null;
  description: string | null;
  type: string;
  config: Record<string, unknown>;
  created_at: Date;
}

export async function commitEvaluatorVersion(evaluatorId: string): Promise<EvaluatorVersion> {
  const evaluator = await getEvaluatorById(evaluatorId);
  if (!evaluator) throw new Error('Evaluator not found');

  const maxVersion = await queryOne<{ max: number | null }>(
    'SELECT MAX(version_number) as max FROM evaluator_versions WHERE evaluator_id = $1',
    [evaluatorId]
  );
  const versionNumber = (maxVersion?.max ?? 0) + 1;

  const versionId = uuidv4();
  const version = await queryOne<EvaluatorVersion>(
    `INSERT INTO evaluator_versions (id, evaluator_id, version_number, name, description, type, config)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      versionId,
      evaluatorId,
      versionNumber,
      evaluator.name,
      evaluator.description,
      evaluator.type,
      JSON.stringify(evaluator.config),
    ]
  );

  if (!version) throw new Error('Failed to create evaluator version');

  await run(
    `UPDATE evaluators SET current_version_id = $1 WHERE id = $2`,
    [versionId, evaluatorId]
  );

  return {
    ...version,
    config: typeof version.config === 'string' ? JSON.parse(version.config) : version.config,
  };
}

export async function getEvaluatorVersions(evaluatorId: string): Promise<EvaluatorVersion[]> {
  const rows = await query<EvaluatorVersion>(
    `SELECT * FROM evaluator_versions WHERE evaluator_id = $1 ORDER BY version_number DESC`,
    [evaluatorId]
  );
  return rows.map(row => ({
    ...row,
    config: typeof row.config === 'string' ? JSON.parse(row.config) : row.config,
  }));
}

export async function rollbackEvaluatorVersion(evaluatorId: string, versionId: string): Promise<Evaluator | null> {
  const version = await queryOne<EvaluatorVersion>(
    'SELECT * FROM evaluator_versions WHERE id = $1 AND evaluator_id = $2',
    [versionId, evaluatorId]
  );
  if (!version) return null;

  const config = typeof version.config === 'string' ? JSON.parse(version.config) : version.config;

  const updated = await updateEvaluator(evaluatorId, {
    name: version.name || undefined,
    type: version.type,
    config,
  });

  if (updated) {
    await run(
      `UPDATE evaluators SET current_version_id = $1 WHERE id = $2`,
      [versionId, evaluatorId]
    );
  }

  return updated;
}

// ==================== Experiment Report ====================

export interface ExperimentReport {
  totalItems: number;
  passedCount: number;
  failedCount: number;
  passRate: number;
  avgScore: number;
  avgLatency: number;
  scoreDistribution: Array<{ score: number; count: number }>;
  latencyDistribution: Array<{ range: string; count: number }>;
  calibratedCount: number;
  calibrationRate: number;
}

export async function getExperimentReport(experimentId: string): Promise<ExperimentReport> {
  const results = await getResultsByExperiment(experimentId);
  const totalItems = results.length;

  // Use calibrated values if available, otherwise use original values
  const effectivePassed = results.map(r =>
    r.calibrated_passed !== null && r.calibrated_passed !== undefined
      ? r.calibrated_passed
      : r.passed
  );
  const passedCount = effectivePassed.filter(p => p).length;
  const failedCount = totalItems - passedCount;
  const passRate = totalItems > 0 ? Math.round((passedCount / totalItems) * 10000) / 100 : 0;

  const effectiveScores = results.map(r =>
    r.calibrated_score !== null && r.calibrated_score !== undefined
      ? r.calibrated_score
      : (r.score ?? 0)
  ).filter(s => s !== null);
  const avgScore = effectiveScores.length > 0 ? effectiveScores.reduce((a, b) => a + b, 0) / effectiveScores.length : 0;

  const latencies = results.map(r => r.latency_ms ?? 0).filter(l => l > 0);
  const avgLatency = latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0;

  const scoreDistribution: Array<{ score: number; count: number }> = [];
  const scoreMap = new Map<number, number>();
  for (const s of effectiveScores) {
    const key = Math.round(s);
    scoreMap.set(key, (scoreMap.get(key) || 0) + 1);
  }
  for (const [score, count] of scoreMap) {
    scoreDistribution.push({ score, count });
  }
  scoreDistribution.sort((a, b) => a.score - b.score);

  const latencyDistribution = [
    { range: '0-500ms', count: latencies.filter(l => l <= 500).length },
    { range: '500-1000ms', count: latencies.filter(l => l > 500 && l <= 1000).length },
    { range: '1000-2000ms', count: latencies.filter(l => l > 1000 && l <= 2000).length },
    { range: '2000ms+', count: latencies.filter(l => l > 2000).length },
  ];

  const calibratedCount = results.filter(r => r.calibrated_score !== null && r.calibrated_score !== undefined).length;
  const calibrationRate = totalItems > 0 ? Math.round((calibratedCount / totalItems) * 10000) / 100 : 0;

  return {
    totalItems,
    passedCount,
    failedCount,
    passRate,
    avgScore,
    avgLatency,
    scoreDistribution,
    latencyDistribution,
    calibratedCount,
    calibrationRate,
  };
}

export async function getExperimentBadCases(experimentId: string): Promise<EvaluationResult[]> {
  const results = await getResultsByExperiment(experimentId);
  return results.filter(r => !r.passed);
}

// ==================== Experiment Comparison ====================

export interface ExperimentComparison {
  experiment_id: string;
  experiment_name: string;
  totalItems: number;
  passedCount: number;
  failedCount: number;
  passRate: number;
  avgScore: number;
  avgLatency: number;
  status: string;
}

export async function compareExperiments(experimentIds: string[]): Promise<{ comparisons: ExperimentComparison[] }> {
  const comparisons: ExperimentComparison[] = [];

  for (const expId of experimentIds) {
    const experiment = await getExperimentById(expId);
    if (!experiment) continue;

    const report = await getExperimentReport(expId);
    comparisons.push({
      experiment_id: expId,
      experiment_name: experiment.name,
      totalItems: report.totalItems,
      passedCount: report.passedCount,
      failedCount: report.failedCount,
      passRate: report.passRate,
      avgScore: report.avgScore,
      avgLatency: report.avgLatency,
      status: experiment.status,
    });
  }

  return { comparisons };
}

// ==================== Phase 2: Result Calibration ====================

export async function calibrateResult(
  resultId: string,
  data: { calibrated_score: number; calibrated_passed: boolean; calibration_note?: string; calibrated_by?: string }
): Promise<EvaluationResult | null> {
  const row = await queryOne<EvaluationResult>(
    `UPDATE evaluation_results
     SET calibrated_score = $1, calibrated_passed = $2, calibration_note = $3, calibrated_at = $4, calibrated_by = $5
     WHERE id = $6
     RETURNING *`,
    [
      data.calibrated_score,
      data.calibrated_passed ? 1 : 0,
      data.calibration_note || null,
      new Date().toISOString(),
      data.calibrated_by || null,
      resultId,
    ]
  );
  if (row) {
    row.calibrated_passed = (row.calibrated_passed as unknown as number) === 1;
    row.passed = (row.passed as unknown as number) === 1;
  }
  return row || null;
}

// ==================== Phase 2: Auto Evaluation Tasks ====================

export interface AutoEvalTask {
  id: string;
  project_id: string;
  name: string;
  dataset_id: string;
  evaluator_id: string | null;
  interval_hours: number;
  sample_count: number;
  trace_type_filter: string | null;
  enabled: number;
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: Date;
  updated_at: Date;
}

export async function createAutoEvalTask(
  projectId: string,
  name: string,
  datasetId: string,
  evaluatorId?: string,
  intervalHours: number = 24,
  sampleCount: number = 10,
  traceTypeFilter?: string,
  enabled: boolean = true
): Promise<AutoEvalTask> {
  const taskId = uuidv4();
  const task = await queryOne<AutoEvalTask>(
    `INSERT INTO auto_eval_tasks (id, project_id, name, dataset_id, evaluator_id, interval_hours, sample_count, trace_type_filter, enabled, next_run_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [taskId, projectId, name, datasetId, evaluatorId || null, intervalHours, sampleCount, traceTypeFilter || null, enabled ? 1 : 0, new Date().toISOString()]
  );
  if (!task) throw new Error('Failed to create auto eval task');
  (task as unknown as Record<string, unknown>).enabled = (task.enabled as unknown as number) === 1;
  return task;
}

export async function getAutoEvalTasksByProject(projectId: string): Promise<AutoEvalTask[]> {
  return query<AutoEvalTask>(
    `SELECT * FROM auto_eval_tasks WHERE project_id = $1 ORDER BY created_at DESC`,
    [projectId]
  );
}

export async function getAutoEvalTaskById(taskId: string): Promise<AutoEvalTask | null> {
  return queryOne<AutoEvalTask>('SELECT * FROM auto_eval_tasks WHERE id = $1', [taskId]);
}

export async function updateAutoEvalTask(
  taskId: string,
  data: { name?: string; interval_hours?: number; sample_count?: number; trace_type_filter?: string; enabled?: boolean }
): Promise<AutoEvalTask | null> {
  const updates: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (data.name !== undefined) { updates.push(`name = $${paramIndex}`); params.push(data.name); paramIndex++; }
  if (data.interval_hours !== undefined) { updates.push(`interval_hours = $${paramIndex}`); params.push(data.interval_hours); paramIndex++; }
  if (data.sample_count !== undefined) { updates.push(`sample_count = $${paramIndex}`); params.push(data.sample_count); paramIndex++; }
  if (data.trace_type_filter !== undefined) { updates.push(`trace_type_filter = $${paramIndex}`); params.push(data.trace_type_filter); paramIndex++; }
  if (data.enabled !== undefined) { updates.push(`enabled = $${paramIndex}`); params.push(data.enabled ? 1 : 0); paramIndex++; }

  if (updates.length === 0) return getAutoEvalTaskById(taskId);

  const nowExpr = config.dbType === 'sqlite' ? "datetime('now')" : 'NOW()';
  updates.push(`updated_at = ${nowExpr}`);
  params.push(taskId);

  return queryOne<AutoEvalTask>(
    `UPDATE auto_eval_tasks SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    params
  );
}

export async function deleteAutoEvalTask(taskId: string): Promise<boolean> {
  const result = await run('DELETE FROM auto_eval_tasks WHERE id = $1', [taskId]);
  return result.changes > 0;
}

export async function triggerAutoEvalTask(taskId: string): Promise<{ success: boolean; message: string }> {
  const task = await getAutoEvalTaskById(taskId);
  if (!task) throw new Error('Task not found');

  // Update last_run_at
  await run(
    `UPDATE auto_eval_tasks SET last_run_at = $1, next_run_at = $2 WHERE id = $3`,
    [new Date().toISOString(), new Date(Date.now() + task.interval_hours * 3600 * 1000).toISOString(), taskId]
  );

  return { success: true, message: 'Task triggered successfully' };
}

// ==================== Phase 1: Preset Evaluator Templates ====================

export interface EvaluatorTemplate {
  id: string;
  name: string;
  type: string;
  description: string;
  default_config: Record<string, unknown>;
  applicable_dataset_types: string[];
  criteria_options?: string[];
}

export const EVALUATOR_TEMPLATES: EvaluatorTemplate[] = [
  {
    id: 'exact_match_qa',
    name: '精确匹配评估器',
    type: 'exact_match',
    description: '检查输出与预期是否完全一致',
    default_config: { case_sensitive: false },
    applicable_dataset_types: ['qa', 'custom'],
  },
  {
    id: 'contains_qa',
    name: '包含匹配评估器',
    type: 'contains',
    description: '检查输出是否包含预期的关键信息',
    default_config: {},
    applicable_dataset_types: ['qa', 'chat', 'custom'],
  },
  {
    id: 'similarity_chat',
    name: '语义相似度评估器',
    type: 'similarity',
    description: '计算输出与预期的语义相似度',
    default_config: { threshold: 0.8 },
    applicable_dataset_types: ['chat', 'custom'],
  },
  {
    id: 'llm_judge_accuracy',
    name: 'LLM 准确性评估器',
    type: 'llm_judge',
    description: '使用大模型评估输出的事实准确性',
    default_config: { criteria: 'accuracy', threshold: 0.7 },
    applicable_dataset_types: ['qa', 'chat', 'custom'],
    criteria_options: ['准确性', '事实性', '逻辑一致性'],
  },
  {
    id: 'llm_judge_safety',
    name: 'LLM 安全性评估器',
    type: 'llm_judge',
    description: '使用大模型评估输出是否存在有害内容',
    default_config: { criteria: 'safety', threshold: 0.8 },
    applicable_dataset_types: ['qa', 'chat', 'custom'],
    criteria_options: ['安全性', '合规性', '毒性检测', '偏见检测'],
  },
  {
    id: 'llm_judge_conciseness',
    name: 'LLM 简洁性评估器',
    type: 'llm_judge',
    description: '使用大模型评估输出是否简洁无冗余',
    default_config: { criteria: 'conciseness', threshold: 0.7 },
    applicable_dataset_types: ['qa', 'chat', 'custom'],
    criteria_options: ['简洁性', '信息密度', '无冗余'],
  },
  {
    id: 'regex_safety',
    name: '正则安全检测器',
    type: 'regex',
    description: '检查输出是否匹配安全规则',
    default_config: { pattern: '' },
    applicable_dataset_types: ['chat', 'custom'],
  },
  {
    id: 'json_format',
    name: 'JSON 格式验证器',
    type: 'regex',
    description: '检查输出是否为有效的 JSON 格式',
    default_config: { pattern: '^\\s*[\\{\\[]' },
    applicable_dataset_types: ['qa', 'custom'],
  },
  {
    id: 'keyword_blacklist',
    name: '关键词黑名单检测器',
    type: 'contains',
    description: '检查输出是否包含敏感或禁止的关键词',
    default_config: { keywords: ['机密', '密码', 'password', 'secret'], check_mode: 'blacklist' },
    applicable_dataset_types: ['qa', 'chat', 'custom'],
  },
  {
    id: 'length_check',
    name: '长度约束检查器',
    type: 'contains',
    description: '检查输出长度是否在合理范围内',
    default_config: { min_length: 10, max_length: 2000 },
    applicable_dataset_types: ['qa', 'chat', 'custom'],
  },
  {
    id: 'code_quality',
    name: '代码质量评估器',
    type: 'llm_judge',
    description: '使用大模型评估代码片段的质量',
    default_config: { criteria: 'code_quality', threshold: 0.7 },
    applicable_dataset_types: ['custom'],
    criteria_options: ['可读性', '正确性', '效率', '规范性'],
  },
  {
    id: 'instruction_following',
    name: '指令遵循度评估器',
    type: 'llm_judge',
    description: '使用大模型评估输出对指令的遵循程度',
    default_config: { criteria: 'instruction_following', threshold: 0.8 },
    applicable_dataset_types: ['qa', 'chat', 'custom'],
    criteria_options: ['指令遵循度', '完整性', '格式合规'],
  },
];

export function getEvaluatorTemplates(type?: string): EvaluatorTemplate[] {
  if (type) {
    return EVALUATOR_TEMPLATES.filter((t) => t.type === type);
  }
  return EVALUATOR_TEMPLATES;
}

export async function createPresetEvaluatorsForDataset(
  datasetId: string,
  projectId: string
): Promise<Evaluator[]> {
  const dataset = await getDatasetById(datasetId);
  if (!dataset) throw new Error('Dataset not found');

  const templates = EVALUATOR_TEMPLATES.filter((t) =>
    t.applicable_dataset_types.includes(dataset.type)
  );

  // Limit to first 4 most relevant templates to avoid clutter
  const selectedTemplates = templates.slice(0, 4);

  const createdEvaluators: Evaluator[] = [];
  for (const template of selectedTemplates) {
    const evaluator = await createEvaluator(
      projectId,
      `${template.name}`,
      template.type,
      template.description,
      { ...template.default_config }
    );
    createdEvaluators.push(evaluator);
  }

  return createdEvaluators;
}

// ==================== Phase 1: Experiment Progress & Script ====================

export interface ExperimentProgress {
  experiment_id: string;
  status: string;
  total_items: number;
  completed_items: number;
  completion_rate: number;
}

export async function getExperimentProgress(experimentId: string): Promise<ExperimentProgress> {
  const experiment = await getExperimentById(experimentId);
  if (!experiment) throw new Error('Experiment not found');

  const items = await getDatasetItems(experiment.dataset_id);
  const results = await getResultsByExperiment(experimentId);

  const totalItems = items.length;
  const completedItems = results.length;
  const completionRate = totalItems > 0 ? Math.round((completedItems / totalItems) * 10000) / 100 : 0;

  return {
    experiment_id: experimentId,
    status: experiment.status,
    total_items: totalItems,
    completed_items: completedItems,
    completion_rate: completionRate,
  };
}

export interface ScriptTemplate {
  typescript: string;
  python: string;
}

export function getExperimentScriptTemplate(experimentId: string, datasetId: string): ScriptTemplate {
  const tsScript = `// TypeScript Experiment Execution Script
// Auto-generated by AgentMonitor

import { api } from './your-api-client';
import { yourAgent } from './your-agent';

const EXPERIMENT_ID = '${experimentId}';
const DATASET_ID = '${datasetId}';

async function runExperiment() {
  // 1. 获取数据集用例
  const dataset_items = await api.evaluation.datasets.items.list(DATASET_ID);
  console.log(\`Total items: \${dataset_items.length}\`);

  // 2. 逐条执行
  for (const item of dataset_items) {
    const start = Date.now();
    const output = await yourAgent.run(item.input);
    const latencyMs = Date.now() - start;

    // 3. 评估（这里用简单示例，实际应调用评估器）
    const passed = output.trim() === (item.expected_output || '').trim();
    const score = passed ? 1 : 0;

    // 4. 上传结果
    await api.evaluation.results.create({
      experiment_id: EXPERIMENT_ID,
      dataset_item_id: item.id,
      output,
      score,
      passed,
      latency_ms: latencyMs,
    });

    console.log(\`Processed: \${item.id}, score: \${score}\`);
  }

  console.log('Experiment completed!');
}

runExperiment().catch(console.error);
`;

  const pyScript = `# Python Experiment Execution Script
# Auto-generated by AgentMonitor

import requests
import time

EXPERIMENT_ID = "${experimentId}"
DATASET_ID = "${datasetId}"
API_BASE = "http://localhost:3000/api/v1"
TOKEN = "your_auth_token"

headers = {
    "Authorization": f"Bearer {TOKEN}",
    "Content-Type": "application/json",
}

def run_experiment():
    # 1. 获取数据集用例
    resp = requests.get(f"{API_BASE}/evaluation/datasets/{DATASET_ID}/items", headers=headers)
    dataset_items = resp.json()
    print(f"Total items: {len(dataset_items)}")

    # 2. 逐条执行
    for item in dataset_items:
        start = time.time()
        # TODO: 替换为你的 Agent 调用
        output = your_agent_run(item["input"])
        latency_ms = int((time.time() - start) * 1000)

        # 3. 评估（这里用简单示例，实际应调用评估器）
        passed = output.strip() == (item.get("expected_output") or "").strip()
        score = 1.0 if passed else 0.0

        # 4. 上传结果
        result = {
            "experiment_id": EXPERIMENT_ID,
            "dataset_item_id": item["id"],
            "output": output,
            "score": score,
            "passed": passed,
            "latency_ms": latency_ms,
        }
        requests.post(f"{API_BASE}/evaluation/results", headers=headers, json=result)
        print(f"Processed: {item['id']}, score: {score}")

    print("Experiment completed!")

if __name__ == "__main__":
    run_experiment()
`;

  return { typescript: tsScript, python: pyScript };
}
