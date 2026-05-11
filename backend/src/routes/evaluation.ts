import { FastifyInstance } from 'fastify';
import { authMiddleware } from '../middleware/auth.js';
import {
  createDataset,
  getDatasetById,
  getDatasetsByProject,
  updateDataset,
  deleteDataset,
  addDatasetItems,
  getDatasetItems,
  updateDatasetItem,
  deleteDatasetItem,
  createEvaluator,
  getEvaluatorById,
  getEvaluatorsByProject,
  updateEvaluator,
  deleteEvaluator,
  isValidEvaluatorType,
  createExperiment,
  getExperimentById,
  getExperimentsByProject,
  startExperiment,
  completeExperiment,
  deleteExperiment,
  createResult,
  getResultById,
  getResultsByExperiment,
  commitDatasetVersion,
  getDatasetVersions,
  rollbackDatasetVersion,
  reflowFromSession,
  reflowFromTraces,
  commitEvaluatorVersion,
  getEvaluatorVersions,
  rollbackEvaluatorVersion,
  getExperimentReport,
  getExperimentBadCases,
  compareExperiments,
  getEvaluatorTemplates,
  createPresetEvaluatorsForDataset,
  getExperimentProgress,
  getExperimentScriptTemplate,
  calibrateResult,
  createAutoEvalTask,
  getAutoEvalTasksByProject,
  getAutoEvalTaskById,
  updateAutoEvalTask,
  deleteAutoEvalTask,
  triggerAutoEvalTask,
} from '../services/evaluation.js';
import { runExperiment } from '../services/evaluation-runner.js';
import { broadcastToProject } from './ws.js';

function getProjectId(request: { query?: unknown; body?: unknown }): string | null {
  const queryParams = request.query as Record<string, unknown> | undefined;
  const bodyParams = request.body as Record<string, unknown> | undefined;
  return (queryParams?.project_id as string) || (bodyParams?.project_id as string) || null;
}

export async function evaluationRoutes(app: FastifyInstance): Promise<void> {
  // ==================== Datasets ====================

  app.post('/datasets', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const body = request.body as {
      project_id: string;
      name: string;
      description?: string;
      type?: string;
      column_schema?: string;
      auto_create_evaluators?: boolean;
    };

    if (!body.project_id) {
      reply.code(400).send({ error: 'project_id is required' });
      return;
    }

    if (!body.name) {
      reply.code(400).send({ error: 'name is required' });
      return;
    }

    let columnSchema = null;
    if (body.column_schema) {
      try {
        columnSchema = JSON.parse(body.column_schema);
      } catch {
        reply.code(400).send({ error: 'Invalid column_schema JSON' });
        return;
      }
    }

    const dataset = await createDataset(body.project_id, body.name, body.description, body.type);
    if (columnSchema) {
      await updateDataset(dataset.id, { column_schema: JSON.stringify(columnSchema) });
    }

    let presetEvaluators = undefined;
    if (body.auto_create_evaluators) {
      try {
        presetEvaluators = await createPresetEvaluatorsForDataset(dataset.id, body.project_id);
      } catch {
        // Ignore preset evaluator creation errors
      }
    }

    const responseData: Record<string, unknown> = { ...dataset };
    if (columnSchema) {
      responseData.column_schema = columnSchema;
    }
    if (presetEvaluators) {
      responseData.preset_evaluators = presetEvaluators;
    }
    reply.code(201).send(responseData);
  });

  app.get('/datasets', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const query = request.query as { project_id?: string };
    if (!query.project_id) {
      reply.code(400).send({ error: 'project_id is required' });
      return;
    }

    const datasets = await getDatasetsByProject(query.project_id);
    reply.send(datasets);
  });

  app.get('/datasets/:id', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const params = request.params as { id: string };
    const dataset = await getDatasetById(params.id);

    if (!dataset) {
      reply.code(404).send({ error: 'Dataset not found' });
      return;
    }

    reply.send(dataset);
  });

  app.put('/datasets/:id', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const params = request.params as { id: string };
    const body = request.body as {
      name?: string;
      description?: string;
      type?: string;
      column_schema?: string;
    };

    const updateData: { name?: string; description?: string; type?: string; column_schema?: string } = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.type !== undefined) updateData.type = body.type;
    if (body.column_schema !== undefined) updateData.column_schema = body.column_schema;

    const dataset = await updateDataset(params.id, updateData);

    if (!dataset) {
      reply.code(404).send({ error: 'Dataset not found' });
      return;
    }

    reply.send(dataset);
  });

  app.delete('/datasets/:id', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const params = request.params as { id: string };
    const deleted = await deleteDataset(params.id);

    if (!deleted) {
      reply.code(404).send({ error: 'Dataset not found' });
      return;
    }

    reply.code(204).send();
  });

  // ==================== Dataset Preset Evaluators ====================

  app.post('/datasets/:id/preset-evaluators', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const params = request.params as { id: string };
    const body = request.body as { project_id?: string };

    if (!body.project_id) {
      reply.code(400).send({ error: 'project_id is required' });
      return;
    }

    try {
      const evaluators = await createPresetEvaluatorsForDataset(params.id, body.project_id);
      reply.code(201).send({ evaluators });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create preset evaluators';
      reply.code(400).send({ error: message });
    }
  });

  // ==================== Dataset Versions ====================

  app.post('/datasets/:id/versions', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const params = request.params as { id: string };
    const body = request.body as { description?: string };

    try {
      const version = await commitDatasetVersion(params.id, {
        description: body.description,
        createdBy: request.userId,
      });
      reply.code(201).send(version);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to commit version';
      reply.code(400).send({ error: message });
    }
  });

  app.get('/datasets/:id/versions', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const params = request.params as { id: string };
    const versions = await getDatasetVersions(params.id);
    reply.send({ versions });
  });

  app.post('/datasets/:id/rollback/:versionId', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const params = request.params as { id: string; versionId: string };
    const result = await rollbackDatasetVersion(params.id, params.versionId);
    reply.send(result);
  });

  // ==================== Data Reflow ====================

  app.post('/datasets/reflow', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const body = request.body as {
      target_dataset_id: string;
      source_type: 'session' | 'traces';
      source_id?: string;
      source_session_id?: string;
      trace_type_filter?: string;
      mapping?: { input_field?: string; output_field?: string };
    };

    if (!body.target_dataset_id) {
      reply.code(400).send({ error: 'target_dataset_id is required' });
      return;
    }

    try {
      let result;
      if (body.source_type === 'session' && body.source_id) {
        result = await reflowFromSession(body.target_dataset_id, body.source_id, body.mapping);
      } else if (body.source_type === 'traces' && body.source_session_id) {
        result = await reflowFromTraces(body.target_dataset_id, body.source_session_id, body.trace_type_filter);
      } else {
        reply.code(400).send({ error: 'Invalid source configuration' });
        return;
      }
      reply.code(201).send(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Reflow failed';
      reply.code(400).send({ error: message });
    }
  });

  // ==================== Dataset Items ====================

  app.post('/datasets/:id/items', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const params = request.params as { id: string };
    const body = request.body as {
      items: Array<{ input: string; expected_output?: string; fields?: Record<string, unknown>; metadata?: Record<string, unknown> }>;
    };

    if (!body.items || !Array.isArray(body.items) || body.items.length === 0) {
      reply.code(400).send({ error: 'items array is required and must not be empty' });
      return;
    }

    const items = await addDatasetItems(params.id, body.items);
    reply.code(201).send(items);
  });

  app.get('/datasets/:id/items', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const params = request.params as { id: string };
    const items = await getDatasetItems(params.id);
    reply.send(items);
  });

  app.put('/datasets/items/:itemId', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const params = request.params as { itemId: string };
    const body = request.body as {
      input?: string;
      expected_output?: string;
      fields?: Record<string, unknown>;
      metadata?: Record<string, unknown>;
    };

    const item = await updateDatasetItem(params.itemId, body);

    if (!item) {
      reply.code(404).send({ error: 'Dataset item not found' });
      return;
    }

    reply.send(item);
  });

  app.delete('/datasets/items/:itemId', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const params = request.params as { itemId: string };
    const deleted = await deleteDatasetItem(params.itemId);

    if (!deleted) {
      reply.code(404).send({ error: 'Dataset item not found' });
      return;
    }

    reply.code(204).send();
  });

  // ==================== Evaluator Templates ====================

  app.get('/evaluator-templates', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const query = request.query as { type?: string };
    const templates = getEvaluatorTemplates(query.type);
    reply.send({ templates });
  });

  // ==================== Evaluators ====================

  app.post('/evaluators', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const body = request.body as {
      project_id: string;
      name: string;
      description?: string;
      type: string;
      config?: Record<string, unknown>;
      model_config_id?: string;
    };

    if (!body.project_id) {
      reply.code(400).send({ error: 'project_id is required' });
      return;
    }

    if (!body.name) {
      reply.code(400).send({ error: 'name is required' });
      return;
    }

    if (!body.type || !isValidEvaluatorType(body.type)) {
      reply.code(400).send({ error: 'type is required and must be one of: exact_match, contains, llm_judge, regex, similarity' });
      return;
    }

    const evaluator = await createEvaluator(body.project_id, body.name, body.type, body.description, body.config, body.model_config_id);
    reply.code(201).send(evaluator);
  });

  app.get('/evaluators', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const query = request.query as { project_id?: string };
    if (!query.project_id) {
      reply.code(400).send({ error: 'project_id is required' });
      return;
    }

    const evaluators = await getEvaluatorsByProject(query.project_id);
    reply.send(evaluators);
  });

  app.get('/evaluators/:id', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const params = request.params as { id: string };
    const evaluator = await getEvaluatorById(params.id);

    if (!evaluator) {
      reply.code(404).send({ error: 'Evaluator not found' });
      return;
    }

    reply.send(evaluator);
  });

  app.put('/evaluators/:id', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const params = request.params as { id: string };
    const body = request.body as {
      name?: string;
      description?: string;
      type?: string;
      config?: Record<string, unknown>;
      model_config_id?: string;
    };

    const evaluator = await updateEvaluator(params.id, body);

    if (!evaluator) {
      reply.code(404).send({ error: 'Evaluator not found' });
      return;
    }

    // Auto-commit version on update
    try {
      await commitEvaluatorVersion(params.id);
    } catch {
      // Ignore version commit errors
    }

    reply.send(evaluator);
  });

  app.delete('/evaluators/:id', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const params = request.params as { id: string };
    const deleted = await deleteEvaluator(params.id);

    if (!deleted) {
      reply.code(404).send({ error: 'Evaluator not found' });
      return;
    }

    reply.code(204).send();
  });

  // ==================== Evaluator Versions ====================

  app.get('/evaluators/:id/versions', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const params = request.params as { id: string };
    const versions = await getEvaluatorVersions(params.id);
    reply.send({ versions });
  });

  app.post('/evaluators/:id/rollback/:versionId', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const params = request.params as { id: string; versionId: string };
    const evaluator = await rollbackEvaluatorVersion(params.id, params.versionId);

    if (!evaluator) {
      reply.code(404).send({ error: 'Version or evaluator not found' });
      return;
    }

    reply.send(evaluator);
  });

  // ==================== Evaluation Experiments ====================

  app.post('/experiments', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const body = request.body as {
      project_id: string;
      name: string;
      description?: string;
      dataset_id: string;
      model_config?: Record<string, unknown>;
      prompt_id?: string;
      prompt_version_id?: string;
      target_model_config_id?: string;
      run_config?: Record<string, unknown>;
    };

    if (!body.project_id) {
      reply.code(400).send({ error: 'project_id is required' });
      return;
    }

    if (!body.name) {
      reply.code(400).send({ error: 'name is required' });
      return;
    }

    if (!body.dataset_id) {
      reply.code(400).send({ error: 'dataset_id is required' });
      return;
    }

    const experiment = await createExperiment(
      body.project_id, body.name, body.dataset_id, body.description, body.model_config,
      body.prompt_id, body.prompt_version_id, body.target_model_config_id, body.run_config
    );
    reply.code(201).send(experiment);
  });

  app.get('/experiments', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const query = request.query as { project_id?: string };
    if (!query.project_id) {
      reply.code(400).send({ error: 'project_id is required' });
      return;
    }

    const experiments = await getExperimentsByProject(query.project_id);
    reply.send(experiments);
  });

  app.get('/experiments/:id', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const params = request.params as { id: string };
    const experiment = await getExperimentById(params.id);

    if (!experiment) {
      reply.code(404).send({ error: 'Experiment not found' });
      return;
    }

    reply.send(experiment);
  });

  app.post('/experiments/:id/start', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const params = request.params as { id: string };
    const experiment = await startExperiment(params.id);

    if (!experiment) {
      reply.code(404).send({ error: 'Experiment not found' });
      return;
    }

    // EV-01: 自动执行评测引擎
    try {
      await runExperiment(params.id, (current, total, itemResult) => {
        broadcastToProject(experiment.project_id, {
          type: 'experiment_progress',
          experiment_id: params.id,
          current,
          total,
          completion_rate: Math.round((current / total) * 10000) / 100,
          item_result: itemResult,
        });
      });
      const freshExperiment = await getExperimentById(params.id);
      reply.send(freshExperiment || experiment);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Experiment execution failed';
      const freshExperiment = await getExperimentById(params.id);
      reply.send(freshExperiment || { ...experiment, error: message });
    }
  });

  app.post('/experiments/:id/complete', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const params = request.params as { id: string };
    const body = request.body as { results_summary?: Record<string, unknown> };
    const experiment = await completeExperiment(params.id, body.results_summary);

    if (!experiment) {
      reply.code(404).send({ error: 'Experiment not found' });
      return;
    }

    reply.send(experiment);
  });

  app.get('/experiments/:id/progress', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const params = request.params as { id: string };
    try {
      const progress = await getExperimentProgress(params.id);
      reply.send(progress);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to get progress';
      reply.code(404).send({ error: message });
    }
  });

  app.get('/experiments/:id/script-template', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const params = request.params as { id: string };
    const experiment = await getExperimentById(params.id);

    if (!experiment) {
      reply.code(404).send({ error: 'Experiment not found' });
      return;
    }

    const template = getExperimentScriptTemplate(params.id, experiment.dataset_id);
    reply.send(template);
  });

  app.get('/experiments/:id/results', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const params = request.params as { id: string };
    const results = await getResultsByExperiment(params.id);
    reply.send(results);
  });

  app.get('/experiments/:id/report', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const params = request.params as { id: string };
    const report = await getExperimentReport(params.id);
    reply.send(report);
  });

  app.get('/experiments/:id/badcases', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const params = request.params as { id: string };
    const badcases = await getExperimentBadCases(params.id);
    reply.send({ badcases });
  });

  app.delete('/experiments/:id', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const params = request.params as { id: string };
    const deleted = await deleteExperiment(params.id);

    if (!deleted) {
      reply.code(404).send({ error: 'Experiment not found' });
      return;
    }

    reply.code(204).send();
  });

  app.post('/experiments/compare', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const body = request.body as { experiment_ids: string[] };

    if (!body.experiment_ids || !Array.isArray(body.experiment_ids) || body.experiment_ids.length < 2) {
      reply.code(400).send({ error: 'At least 2 experiment_ids are required' });
      return;
    }

    const result = await compareExperiments(body.experiment_ids);
    reply.send(result);
  });

  // ==================== Evaluation Results ====================

  app.post('/results', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const body = request.body as {
      experiment_id: string;
      dataset_item_id: string;
      evaluator_id?: string;
      output?: string;
      score?: number;
      passed?: boolean;
      details?: Record<string, unknown>;
      latency_ms?: number;
    };

    if (!body.experiment_id) {
      reply.code(400).send({ error: 'experiment_id is required' });
      return;
    }

    if (!body.dataset_item_id) {
      reply.code(400).send({ error: 'dataset_item_id is required' });
      return;
    }

    const result = await createResult(body.experiment_id, body.dataset_item_id, body);
    reply.code(201).send(result);
  });

  app.get('/results/:id', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const params = request.params as { id: string };
    const result = await getResultById(params.id);

    if (!result) {
      reply.code(404).send({ error: 'Result not found' });
      return;
    }

    reply.send(result);
  });

  // ==================== Result Calibration ====================

  app.put('/results/:id/calibrate', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const params = request.params as { id: string };
    const body = request.body as {
      calibrated_score: number;
      calibrated_passed: boolean;
      calibration_note?: string;
    };

    if (body.calibrated_score === undefined || body.calibrated_passed === undefined) {
      reply.code(400).send({ error: 'calibrated_score and calibrated_passed are required' });
      return;
    }

    const result = await calibrateResult(params.id, {
      calibrated_score: body.calibrated_score,
      calibrated_passed: body.calibrated_passed,
      calibration_note: body.calibration_note,
      calibrated_by: request.userId,
    });

    if (!result) {
      reply.code(404).send({ error: 'Result not found' });
      return;
    }

    reply.send(result);
  });

  // ==================== Auto Evaluation Tasks ====================

  app.post('/auto-eval-tasks', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const body = request.body as {
      project_id: string;
      name: string;
      dataset_id: string;
      evaluator_id?: string;
      interval_hours?: number;
      sample_count?: number;
      trace_type_filter?: string;
      enabled?: boolean;
    };

    if (!body.project_id) {
      reply.code(400).send({ error: 'project_id is required' });
      return;
    }

    if (!body.name) {
      reply.code(400).send({ error: 'name is required' });
      return;
    }

    if (!body.dataset_id) {
      reply.code(400).send({ error: 'dataset_id is required' });
      return;
    }

    const task = await createAutoEvalTask(
      body.project_id,
      body.name,
      body.dataset_id,
      body.evaluator_id,
      body.interval_hours,
      body.sample_count,
      body.trace_type_filter,
      body.enabled
    );
    reply.code(201).send(task);
  });

  app.get('/auto-eval-tasks', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const query = request.query as { project_id?: string };
    if (!query.project_id) {
      reply.code(400).send({ error: 'project_id is required' });
      return;
    }

    const tasks = await getAutoEvalTasksByProject(query.project_id);
    reply.send({ tasks });
  });

  app.put('/auto-eval-tasks/:id', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const params = request.params as { id: string };
    const body = request.body as {
      name?: string;
      interval_hours?: number;
      sample_count?: number;
      trace_type_filter?: string;
      enabled?: boolean;
    };

    const task = await updateAutoEvalTask(params.id, body);

    if (!task) {
      reply.code(404).send({ error: 'Task not found' });
      return;
    }

    reply.send(task);
  });

  app.delete('/auto-eval-tasks/:id', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const params = request.params as { id: string };
    const deleted = await deleteAutoEvalTask(params.id);

    if (!deleted) {
      reply.code(404).send({ error: 'Task not found' });
      return;
    }

    reply.code(204).send();
  });

  app.post('/auto-eval-tasks/:id/trigger', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const params = request.params as { id: string };
    try {
      const result = await triggerAutoEvalTask(params.id);
      reply.send(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Trigger failed';
      reply.code(400).send({ error: message });
    }
  });
}
