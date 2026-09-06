import { FastifyInstance } from 'fastify';
import { authMiddleware } from '../middleware/auth.js';
import { getProjectById } from '../services/project.js';
import { queryOne } from '../db/index.js';
import { addDatasetItems, createDataset, getDatasetById, getExperimentById } from '../services/evaluation.js';
import {
  getRunItemById,
  getRunById,
  listRunsByExperiment,
  listRunItems,
  listRunEvents,
  listScoresByRunItem,
  prepareRun,
  requestCancelRun,
  validateExperiment,
  createRetryRun,
  createSingleItemRetryRun,
} from '../services/evaluation-run.js';
import {
  listRunItems as listRunItemsFiltered,
  getBadCases,
  compareRuns,
  exportRun,
  generateJunitXml,
  type ListRunItemsFilter,
} from '../services/run-reports.js';
import { getEvaluationWorker } from '../services/evaluation-worker.js';

/**
 * 校验当前用户是否拥有指定项目。
 * @param userId - 用户 ID
 * @param projectId - 项目 ID
 * @returns 项目存在且属于该用户返回 true
 */
async function userOwnsProject(userId: string, projectId: string): Promise<boolean> {
  const project = await getProjectById(projectId);
  return !!project && project.user_id === userId;
}

/**
 * 根据实验 ID 反查项目归属。
 * @param experimentId - Experiment ID
 * @returns 项目 ID 或 null
 */
async function projectIdForExperiment(experimentId: string): Promise<string | null> {
  const exp = await getExperimentById(experimentId);
  return exp?.project_id ?? null;
}

/**
 * 根据 Run ID 反查项目归属。
 * @param runId - Run ID
 * @returns 项目 ID 或 null
 */
async function projectIdForRun(runId: string): Promise<string | null> {
  const run = await getRunById(runId);
  return run?.project_id ?? null;
}

/**
 * 根据 RunItem ID 反查项目归属。
 * @param runItemId - RunItem ID
 * @returns 项目 ID 或 null
 */
async function projectIdForRunItem(runItemId: string): Promise<string | null> {
  const row = await queryOne<{ project_id: string }>(
    `SELECT r.project_id AS project_id
       FROM evaluation_run_items ri
       JOIN evaluation_runs r ON r.id = ri.run_id
      WHERE ri.id = $1`,
    [runItemId]
  );
  return row?.project_id ?? null;
}

/**
 * 从 RunItem 的快照 JSON 中提取适合作为 Dataset 文本的内容。
 * @param snapshot - RunItem 的 input/expected 快照
 * @returns 优先提取的文本；无法提取时退化为 JSON 字符串
 */
function extractSnapshotText(snapshot: Record<string, unknown> | null): string | undefined {
  if (!snapshot) return undefined;
  const preferredKeys = ['query', 'input', 'content', 'text', 'answer', 'expected', 'output'];
  for (const key of preferredKeys) {
    const value = snapshot[key];
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }
  try {
    return JSON.stringify(snapshot);
  } catch {
    return undefined;
  }
}

/**
 * 注册 PR-08 V2 Experiment/Run 路由。
 * @param app - Fastify 实例
 * @returns 无返回值
 */
export async function evaluationRunRoutes(app: FastifyInstance): Promise<void> {
  app.post('/experiments/:id/validate', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    const params = request.params as { id: string };
    const projectId = await projectIdForExperiment(params.id);
    if (!projectId || !(await userOwnsProject(request.userId, projectId))) {
      reply.code(404).send({ error: 'Experiment not found' });
      return;
    }
    const result = await validateExperiment(params.id);
    reply.send({ valid: result.valid, issues: result.issues });
  });

  app.post('/experiments/:id/runs', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    const params = request.params as { id: string };
    const projectId = await projectIdForExperiment(params.id);
    if (!projectId || !(await userOwnsProject(request.userId, projectId))) {
      reply.code(404).send({ error: 'Experiment not found' });
      return;
    }

    const body = (request.body ?? {}) as {
      triggerType?: 'manual' | 'scheduled' | 'api' | 'retry' | 'webhook';
      triggerRef?: string;
      baselineRunId?: string;
      idempotencyKey?: string;
    };

    try {
      const prep = await prepareRun(params.id, {
        triggerType: body.triggerType,
        triggerRef: body.triggerRef,
        requestedBy: request.userId,
        baselineRunId: body.baselineRunId,
        idempotencyKey: body.idempotencyKey,
      });
      reply.code(201).send({
        run: prep.run,
        items: prep.items.length,
      });
      // 唤醒 Worker，缩短首个任务的等待延迟
      getEvaluationWorker().poke();
    } catch (error) {
      const issues = (error as Error & { issues?: unknown[] }).issues;
      if (issues) {
        reply.code(400).send({ error: 'Experiment validation failed', issues });
        return;
      }
      reply.code(400).send({
        error: error instanceof Error ? error.message : 'Failed to prepare run',
      });
    }
  });

  app.get('/experiments/:id/runs', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    const params = request.params as { id: string };
    const projectId = await projectIdForExperiment(params.id);
    if (!projectId || !(await userOwnsProject(request.userId, projectId))) {
      reply.code(404).send({ error: 'Experiment not found' });
      return;
    }
    const runs = await listRunsByExperiment(params.id);
    reply.send({ runs });
  });

  app.get('/runs/:id', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    const params = request.params as { id: string };
    const projectId = await projectIdForRun(params.id);
    if (!projectId || !(await userOwnsProject(request.userId, projectId))) {
      reply.code(404).send({ error: 'Run not found' });
      return;
    }
    const run = await getRunById(params.id);
    reply.send({ run });
  });

  app.post('/runs/:id/cancel', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    const params = request.params as { id: string };
    const projectId = await projectIdForRun(params.id);
    if (!projectId || !(await userOwnsProject(request.userId, projectId))) {
      reply.code(404).send({ error: 'Run not found' });
      return;
    }
    const ok = await requestCancelRun(params.id);
    if (!ok) {
      reply.code(409).send({ error: 'Run is not cancellable' });
      return;
    }
    // 立即唤醒 Worker，让它尽快把 pending 项置 cancelled
    getEvaluationWorker().poke();
    reply.send({ cancelled: true });
  });

  /**
   * 重试失败项：基于源 Run 创建一个新的 Run（retry_of_run_id 指向源 Run），
   * 新 Run 仅包含源 Run 中 status='failed' 的样本。
   * 源 Run 必须处于 completed/failed 终态。
   */
  app.post('/runs/:id/retry', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    const params = request.params as { id: string };
    const projectId = await projectIdForRun(params.id);
    if (!projectId || !(await userOwnsProject(request.userId, projectId))) {
      reply.code(404).send({ error: 'Run not found' });
      return;
    }
    const sourceRun = await getRunById(params.id);
    if (!sourceRun) {
      reply.code(404).send({ error: 'Run not found' });
      return;
    }
    if (!['completed', 'failed'].includes(sourceRun.status)) {
      reply.code(409).send({ error: 'Only completed/failed runs can be retried' });
      return;
    }
    try {
      const prep = await createRetryRun(params.id);
      reply.code(201).send({
        run: prep.run,
        items: prep.items.length,
        retry_of_run_id: params.id,
      });
      getEvaluationWorker().poke();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create retry run';
      const status = message.includes('No failed items') ? 409 : 400;
      reply.code(status).send({ error: message });
    }
  });

  /**
   * 单条重跑：基于某个 Bad Case 对应的 RunItem 创建只包含一条样本的新 Run。
   */
  app.post('/run-items/:id/retry', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    const params = request.params as { id: string };
    const projectId = await projectIdForRunItem(params.id);
    if (!projectId || !(await userOwnsProject(request.userId, projectId))) {
      reply.code(404).send({ error: 'Run item not found' });
      return;
    }
    const sourceItem = await getRunItemById(params.id);
    if (!sourceItem) {
      reply.code(404).send({ error: 'Run item not found' });
      return;
    }
    const sourceRun = await getRunById(sourceItem.run_id);
    if (!sourceRun) {
      reply.code(404).send({ error: 'Run not found' });
      return;
    }
    if (!['completed', 'failed'].includes(sourceRun.status)) {
      reply.code(409).send({ error: 'Only completed/failed runs can be retried' });
      return;
    }
    try {
      const prep = await createSingleItemRetryRun(sourceRun.id, params.id);
      reply.code(201).send({
        run: prep.run,
        items: prep.items.length,
        retry_of_run_id: sourceRun.id,
        source_run_item_id: params.id,
      });
      getEvaluationWorker().poke();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create retry run';
      reply.code(400).send({ error: message });
    }
  });

  /**
   * 将单条 Bad Case 沉淀为数据集条目，便于加入回归集。
   */
  app.post('/run-items/:id/add-to-dataset', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    const params = request.params as { id: string };
    const body = (request.body ?? {}) as {
      datasetId?: string;
      datasetName?: string;
      expectedOutput?: string;
    };
    const projectId = await projectIdForRunItem(params.id);
    if (!projectId || !(await userOwnsProject(request.userId, projectId))) {
      reply.code(404).send({ error: 'Run item not found' });
      return;
    }
    if (!body.datasetId && !body.datasetName) {
      reply.code(400).send({ error: 'datasetId or datasetName is required' });
      return;
    }
    const runItem = await getRunItemById(params.id);
    if (!runItem) {
      reply.code(404).send({ error: 'Run item not found' });
      return;
    }
    const sourceRun = await getRunById(runItem.run_id);
    if (!sourceRun) {
      reply.code(404).send({ error: 'Run not found' });
      return;
    }

    let dataset;
    if (body.datasetId) {
      dataset = await getDatasetById(body.datasetId);
      if (!dataset || dataset.project_id !== sourceRun.project_id) {
        reply.code(404).send({ error: 'Dataset not found' });
        return;
      }
    } else {
      dataset = await createDataset(
        sourceRun.project_id,
        body.datasetName as string,
        `Auto-created from run item ${params.id}`,
        'chat'
      );
    }

    const scores = await listScoresByRunItem(runItem.id);
    const createdItems = await addDatasetItems(dataset.id, [
      {
        input: extractSnapshotText(runItem.input_snapshot) ?? runItem.case_key,
        expected_output:
          body.expectedOutput ??
          extractSnapshotText(runItem.expected_snapshot) ??
          undefined,
        fields: {
          inputSnapshot: runItem.input_snapshot,
          expectedSnapshot: runItem.expected_snapshot,
          targetOutput: runItem.target_output,
          targetError: runItem.target_error,
          traceId: runItem.trace_id,
        },
        metadata: {
          source: 'run_bad_case',
          runId: sourceRun.id,
          runItemId: runItem.id,
          caseKey: runItem.case_key,
          datasetVersionItemId: runItem.dataset_version_item_id,
          traceId: runItem.trace_id,
          targetOutput: runItem.target_output,
          targetError: runItem.target_error,
          scores: scores.map((score) => ({
            evaluatorAlias: score.evaluator_alias,
            status: score.status,
            score: score.score,
            passed: score.passed,
            error: score.error,
            reasoning: score.reasoning,
            rawOutput: score.raw_output,
          })),
        },
      },
    ]);
    const updatedDataset = await getDatasetById(dataset.id);
    reply.code(201).send({
      item: createdItems[0],
      dataset: updatedDataset ?? dataset,
      run_item_id: params.id,
    });
  });

  app.get('/runs/:id/items', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    const params = request.params as { id: string };
    const projectId = await projectIdForRun(params.id);
    if (!projectId || !(await userOwnsProject(request.userId, projectId))) {
      reply.code(404).send({ error: 'Run not found' });
      return;
    }
    const q = request.query as Record<string, string | undefined>;
    const result = await listRunItemsFiltered({
      runId: params.id,
      status: q.status as ListRunItemsFilter['status'],
      passed: q.passed === 'true' ? true : q.passed === 'false' ? false : undefined,
      caseKey: q.caseKey,
      caseKeyPrefix: q.caseKeyPrefix,
      evaluatorAlias: q.evaluatorAlias,
      scoreMin: q.scoreMin !== undefined ? Number(q.scoreMin) : undefined,
      scoreMax: q.scoreMax !== undefined ? Number(q.scoreMax) : undefined,
      errorCode: q.errorCode,
      cursor: q.cursor,
      limit: q.limit !== undefined ? Number(q.limit) : undefined,
    });
    // 兼容历史响应：保持 EvaluationRunItem 的 snake_case 字段结构
    reply.send({
      items: result.items.map((it) => ({
        id: it.id,
        dataset_version_item_id: it.datasetVersionItemId,
        case_key: it.caseKey,
        status: it.status,
        phase: it.phase,
        input_snapshot: it.inputSnapshot,
        expected_snapshot: it.expectedSnapshot,
        target_output: it.targetOutput,
        target_error: it.targetError,
        trace_id: it.traceId,
        latency_ms: it.latencyMs,
        started_at: it.startedAt,
        completed_at: it.completedAt,
        scores: it.scores.map((s) => ({
          evaluator_alias: s.evaluatorAlias,
          status: s.status,
          score: s.score,
          passed: s.passed,
          error: s.error,
          reasoning: s.reasoning,
          raw_output: s.rawOutput,
        })),
      })),
      nextCursor: result.nextCursor,
    });
  });

  app.get('/runs/:id/events', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    const params = request.params as { id: string };
    const projectId = await projectIdForRun(params.id);
    if (!projectId || !(await userOwnsProject(request.userId, projectId))) {
      reply.code(404).send({ error: 'Run not found' });
      return;
    }
    const events = await listRunEvents(params.id);
    reply.send({ events });
  });

  app.get('/run-items/:id/scores', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    const params = request.params as { id: string };
    // 反查项目归属：scores → run_item → run → project
    const run = await queryOne<{ project_id: string }>(
      `SELECT r.project_id AS project_id
         FROM evaluation_run_items ri
         JOIN evaluation_runs r ON r.id = ri.run_id
        WHERE ri.id = $1`,
      [params.id]
    );
    if (!run || !(await userOwnsProject(request.userId, run.project_id))) {
      reply.code(404).send({ error: 'Run item not found' });
      return;
    }
    const scores = await listScoresByRunItem(params.id);
    reply.send({ scores });
  });

  // PR-11: Run 报告（含 summary + items + scores 聚合）
  app.get('/runs/:id/report', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    const params = request.params as { id: string };
    const projectId = await projectIdForRun(params.id);
    if (!projectId || !(await userOwnsProject(request.userId, projectId))) {
      reply.code(404).send({ error: 'Run not found' });
      return;
    }
    const [run, itemsResult, badCases] = await Promise.all([
      getRunById(params.id),
      listRunItemsFiltered({ runId: params.id, limit: 500 }),
      getBadCases(params.id),
    ]);
    reply.send({ run, items: itemsResult, badCases });
  });

  // PR-11: Bad Cases 聚合
  app.get('/runs/:id/bad-cases', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    const params = request.params as { id: string };
    const q = request.query as { limit?: string };
    const projectId = await projectIdForRun(params.id);
    if (!projectId || !(await userOwnsProject(request.userId, projectId))) {
      reply.code(404).send({ error: 'Run not found' });
      return;
    }
    const badCases = await getBadCases(params.id, q.limit ? Number(q.limit) : 20);
    reply.send(badCases);
  });

  // PR-11: 导出 Run（JSON 或 JUnit XML）
  app.get('/runs/:id/export', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    const params = request.params as { id: string };
    const q = request.query as { format?: string };
    const projectId = await projectIdForRun(params.id);
    if (!projectId || !(await userOwnsProject(request.userId, projectId))) {
      reply.code(404).send({ error: 'Run not found' });
      return;
    }
    const data = await exportRun(params.id);
    if (q.format === 'junit') {
      const xml = generateJunitXml(params.id, data.run, data.items.items);
      reply.header('Content-Type', 'application/xml');
      reply.header('Content-Disposition', `attachment; filename="run-${params.id}.xml"`);
      reply.send(xml);
      return;
    }
    reply.header('Content-Disposition', `attachment; filename="run-${params.id}.json"`);
    reply.send(data);
  });

  // PR-11: 对比两个 Run
  app.post('/runs:compare', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    const body = request.body as { baselineRunId?: string; candidateRunId?: string };
    if (!body.baselineRunId || !body.candidateRunId) {
      reply.code(400).send({ error: 'baselineRunId and candidateRunId are required' });
      return;
    }
    const [baseProj, candProj] = await Promise.all([
      projectIdForRun(body.baselineRunId),
      projectIdForRun(body.candidateRunId),
    ]);
    if (!baseProj || !candProj || baseProj !== candProj || !(await userOwnsProject(request.userId, baseProj))) {
      reply.code(404).send({ error: 'Runs not found in same project' });
      return;
    }
    const result = await compareRuns(body.baselineRunId, body.candidateRunId);
    reply.send(result);
  });
}
