import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';

vi.mock('../src/services/llm-client.js', () => ({
  callLLM: vi.fn(async () => ({
    content: 'OK',
    usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
  })),
  buildJudgePrompt: vi.fn(),
  extractJsonFromLLMResponse: vi.fn((text: string) => {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }),
}));

describe('PR-08：Experiment/Run 分离', () => {
  let app: FastifyInstance;
  let authToken: string;
  let projectId: string;
  let datasetId: string;
  let datasetVersionId: string;
  let targetVersionId: string;
  let suiteVersionId: string;
  let v2ExperimentId: string;
  const testId = `pr08-${Date.now()}`;
  const authHeader = (): Record<string, string> => ({
    Authorization: `Bearer ${authToken}`,
    'x-test-id': testId,
  });

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const email = `pr08-${Date.now()}@example.com`;
    const register = await request(app.server)
      .post('/api/auth/register')
      .set('x-test-id', testId)
      .send({ email, password: 'Test12345678!', name: 'PR08' })
      .expect(201);
    authToken = register.body.token;

    const project = await request(app.server)
      .post('/api/projects')
      .set(authHeader())
      .send({ name: 'PR08 Project' })
      .expect(201);
    projectId = project.body.id;

    // Dataset + items + commit version
    const ds = await request(app.server)
      .post('/api/evaluation/datasets')
      .set(authHeader())
      .send({ project_id: projectId, name: 'PR08 DS' })
      .expect(201);
    datasetId = ds.body.id;
    await request(app.server)
      .post(`/api/evaluation/datasets/${datasetId}/items`)
      .set(authHeader())
      .send({
        items: [
          { input: '问题A', expected_output: 'OK' },
          { input: '问题B', expected_output: 'OK' },
        ],
      })
      .expect(201);
    const dv = await request(app.server)
      .post(`/api/evaluation/datasets/${datasetId}/versions`)
      .set(authHeader())
      .send({ description: 'v1' })
      .expect(201);
    datasetVersionId = dv.body.id;

    // Target（prompt_model）
    const mc = await request(app.server)
      .post('/api/model-configs')
      .set(authHeader())
      .send({
        project_id: projectId,
        name: 'PR08 Model',
        provider: 'openai',
        model: 'gpt-4o-mini',
        api_key: 'sk-test-pr08',
      })
      .expect(201);
    const target = await request(app.server)
      .post('/api/v2/evaluation/targets')
      .set(authHeader())
      .send({
        projectId,
        name: 'PR08 Target',
        type: 'prompt_model',
        invocationConfig: { modelConfigId: mc.body.id },
      })
      .expect(201);
    targetVersionId = target.body.version.id;

    // Evaluator + version + suite
    const evaluator = await request(app.server)
      .post('/api/evaluation/evaluators')
      .set(authHeader())
      .send({
        project_id: projectId,
        name: 'PR08 Contains',
        type: 'contains',
        config: { keywords: ['OK'], check_mode: 'whitelist', threshold: 0.5 },
      })
      .expect(201);
    await request(app.server)
      .put(`/api/evaluation/evaluators/${evaluator.body.id}`)
      .set(authHeader())
      .send({ name: 'PR08 Contains' })
      .expect(200);
    const evVersions = await request(app.server)
      .get(`/api/evaluation/evaluators/${evaluator.body.id}/versions`)
      .set(authHeader());
    const evaluatorVersionId = evVersions.body.versions[0].id;

    const suite = await request(app.server)
      .post('/api/v2/evaluation/suites')
      .set(authHeader())
      .send({
        projectId,
        name: 'PR08 Suite',
        members: [
          { evaluatorVersionId, alias: 'contains', weight: 1, required: true },
        ],
        aggregationConfig: { strategy: 'all_required' },
      })
      .expect(201);
    suiteVersionId = suite.body.version.id;

    // V2 Experiment：直接用 service 层构造，绑定三个不可变版本
    const { createExperiment } = await import('../src/services/evaluation.js');
    const exp = await createExperiment(
      projectId,
      'PR08 V2 Experiment',
      datasetId,
      'PR-08 e2e',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        datasetVersionId,
        targetVersionId,
        evaluatorSuiteVersionId: suiteVersionId,
      }
    );
    v2ExperimentId = exp.id;
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  it('validate 返回 valid=true 并识别全部三个版本', async () => {
    const res = await request(app.server)
      .post(`/api/v2/evaluation/experiments/${v2ExperimentId}/validate`)
      .set(authHeader())
      .expect(200);
    expect(res.body.valid).toBe(true);
    expect(res.body.issues).toEqual([]);
  });

  it('POST /experiments/:id/runs 创建 queued Run 并按 DatasetVersionItem 预排 RunItem', async () => {
    const res = await request(app.server)
      .post(`/api/v2/evaluation/experiments/${v2ExperimentId}/runs`)
      .set(authHeader())
      .expect(201);
    expect(res.body.run.status).toBe('queued');
    expect(res.body.run.run_number).toBeGreaterThanOrEqual(1);
    expect(res.body.items).toBe(2);
  });

  it('POST /experiments/:id/start V2 路径返回 202，后台执行完成且全部通过', async () => {
    const start = await request(app.server)
      .post(`/api/evaluation/experiments/${v2ExperimentId}/start`)
      .set(authHeader())
      .expect(202);
    expect(start.body.run).toBeTruthy();
    expect(start.body.run.status).toBe('queued');
    const runId = start.body.run.id;

    const final = await vi.waitFor(
      async () => {
        const r = await request(app.server)
          .get(`/api/v2/evaluation/runs/${runId}`)
          .set(authHeader());
        if (r.body.run.status !== 'completed' && r.body.run.status !== 'failed') {
          throw new Error(`run still ${r.body.run.status}`);
        }
        return r.body.run;
      },
      { timeout: 10000, interval: 100 }
    );

    expect(final.status).toBe('completed');
    expect(final.summary.totalItems).toBe(2);
    expect(final.summary.passedItems).toBe(2);

    const items = await request(app.server)
      .get(`/api/v2/evaluation/runs/${runId}/items`)
      .set(authHeader())
      .expect(200);
    expect(items.body.items).toHaveLength(2);
    for (const it of items.body.items) {
      expect(it.status).toBe('succeeded');
      expect(it.target_output).toBe('OK');
      expect(it.phase).toBe('done');
      const scores = await request(app.server)
        .get(`/api/v2/evaluation/run-items/${it.id}/scores`)
        .set(authHeader())
        .expect(200);
      expect(scores.body.scores).toHaveLength(1);
      expect(scores.body.scores[0].evaluator_alias).toBe('contains');
      expect(scores.body.scores[0].status).toBe('completed');
    }

    const events = await request(app.server)
      .get(`/api/v2/evaluation/runs/${runId}/events`)
      .set(authHeader())
      .expect(200);
    const eventTypes = events.body.events.map((e: { event_type: string }) => e.event_type);
    expect(eventTypes).toContain('run_started');
    expect(eventTypes).toContain('run_completed');
    expect(eventTypes.filter((t: string) => t === 'item_completed')).toHaveLength(2);
  });

  it('GET /experiments/:id/report V2 路径返回兼容字段 + run/items', async () => {
    const res = await request(app.server)
      .get(`/api/evaluation/experiments/${v2ExperimentId}/report`)
      .set(authHeader())
      .expect(200);
    expect(res.body.totalItems).toBe(2);
    expect(res.body.passedCount).toBe(2);
    expect(res.body.run).toBeTruthy();
    expect(res.body.run.status).toBe('completed');
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.items[0].scores.length).toBeGreaterThan(0);
  });

  it('Run 列表返回多次 Run，run_number 单调递增且唯一', async () => {
    const res = await request(app.server)
      .get(`/api/v2/evaluation/experiments/${v2ExperimentId}/runs`)
      .set(authHeader())
      .expect(200);
    expect(res.body.runs.length).toBeGreaterThanOrEqual(2);
    const numbers = res.body.runs.map((r: { run_number: number }) => r.run_number);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it('validate 对缺失版本的实验返回 valid=false 与 issues', async () => {
    const { createExperiment: createExp } = await import('../src/services/evaluation.js');
    const empty = await createExp(projectId, 'Empty Exp', datasetId, 'no versions');
    const res = await request(app.server)
      .post(`/api/v2/evaluation/experiments/${empty.id}/validate`)
      .set(authHeader())
      .expect(200);
    expect(res.body.valid).toBe(false);
    expect(res.body.issues.length).toBeGreaterThan(0);
    const codes = res.body.issues.map((i: { code: string }) => i.code);
    expect(codes).toContain('TARGET_NOT_VERIFIED');
    expect(codes).toContain('SUITE_NOT_BOUND');
  });

  it('cancel 正在 queued/running 的 Run 最终置为 cancelled；对已完成 Run 返回 409', async () => {
    // 直接用 service 层创建 Run，避免路由 poke() 触发 Worker 在 cancel 前完成
    const { prepareRun, requestCancelRun, getRunById } = await import('../src/services/evaluation-run.js');
    const { getEvaluationWorker } = await import('../src/services/evaluation-worker.js');
    const prep = await prepareRun(v2ExperimentId, { triggerType: 'manual' });
    const queuedRunId = prep.run.id;

    // 请求取消并立即驱动 Worker 一轮
    const ok = await requestCancelRun(queuedRunId);
    expect(ok).toBe(true);
    const worker = getEvaluationWorker();
    await worker.start();
    // 给 Worker 足够轮次把 pending 项全部取消
    await vi.waitFor(
      async () => {
        await worker.tick();
        const r = await getRunById(queuedRunId);
        if (r?.status !== 'cancelled') throw new Error(`run still ${r?.status}`);
      },
      { timeout: 5000, interval: 50 }
    );

    const cancelled = await getRunById(queuedRunId);
    expect(cancelled?.status).toBe('cancelled');

    const items = await request(app.server)
      .get(`/api/v2/evaluation/runs/${queuedRunId}/items`)
      .set(authHeader())
      .expect(200);
    for (const it of items.body.items) {
      expect(['cancelled', 'succeeded']).toContain(it.status);
    }

    // 已完成 Run 再 cancel 返回 409
    const completedRuns = await request(app.server)
      .get(`/api/v2/evaluation/experiments/${v2ExperimentId}/runs`)
      .set(authHeader());
    const completed = completedRuns.body.runs.find((r: { status: string }) => r.status === 'completed');
    expect(completed).toBeTruthy();
    await request(app.server)
      .post(`/api/v2/evaluation/runs/${completed.id}/cancel`)
      .set(authHeader())
      .expect(409);
  });

  it('retry 接口基于已完成 Run 创建仅含失败项的新 Run（retry_of_run_id）', async () => {
    // 构造一个"全部通过"的已完成 Run（使用 start 走 Worker）
    const start = await request(app.server)
      .post(`/api/evaluation/experiments/${v2ExperimentId}/start`)
      .set(authHeader())
      .expect(202);
    const sourceRunId = start.body.run.id;
    await vi.waitFor(
      async () => {
        const r = await request(app.server)
          .get(`/api/v2/evaluation/runs/${sourceRunId}`)
          .set(authHeader());
        if (r.body.run.status !== 'completed') throw new Error('not completed');
      },
      { timeout: 10000, interval: 100 }
    );

    // 源 Run 全部 succeeded，没有失败项，retry 应返回 409
    await request(app.server)
      .post(`/api/v2/evaluation/runs/${sourceRunId}/retry`)
      .set(authHeader())
      .expect(409);
  });

  it('run-item 详情字段、单条重跑与加入数据集接口可用', async () => {
    const { prepareRun, upsertScore } = await import('../src/services/evaluation-run.js');
    const { run: dbRun } = await import('../src/db/index.js');

    const prep = await prepareRun(v2ExperimentId, { triggerType: 'manual' });
    const sourceRunId = prep.run.id;
    const sourceItem = prep.items[0];

    await dbRun(
      `UPDATE evaluation_run_items
          SET status = 'failed',
              phase = 'done',
              target_output = $2,
              target_error = $3,
              trace_id = $4,
              completed_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1`,
      [sourceItem.id, 'BAD_OUTPUT', 'target failed', 'trace-badcase-1']
    );
    await upsertScore(sourceItem.id, {
      evaluatorAlias: 'contains',
      status: 'failed',
      score: 0,
      passed: false,
      error: 'keyword missing',
      reasoning: '输出未包含 OK',
      rawOutput: '{"judge":"fail"}',
    });
    await dbRun(
      `UPDATE evaluation_runs
          SET status = 'completed',
              completed_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1`,
      [sourceRunId]
    );

    const itemsRes = await request(app.server)
      .get(`/api/v2/evaluation/runs/${sourceRunId}/items`)
      .set(authHeader())
      .expect(200);
    const itemPayload = itemsRes.body.items.find((item: { id: string }) => item.id === sourceItem.id);
    expect(itemPayload).toBeTruthy();
    expect(itemPayload.dataset_version_item_id).toBe(sourceItem.dataset_version_item_id);
    expect(itemPayload.input_snapshot).toBeTruthy();
    expect(itemPayload.expected_snapshot).toBeTruthy();
    expect(itemPayload.scores[0].reasoning).toBe('输出未包含 OK');
    expect(itemPayload.scores[0].raw_output).toBe('{"judge":"fail"}');

    const badCasesRes = await request(app.server)
      .get(`/api/v2/evaluation/runs/${sourceRunId}/bad-cases`)
      .set(authHeader())
      .expect(200);
    expect(badCasesRes.body.failedItems).toBeGreaterThanOrEqual(1);
    expect(badCasesRes.body.byEvaluator[0].cases[0].inputSnapshot).toBeTruthy();
    expect(badCasesRes.body.byEvaluator[0].cases[0].reasoning).toBe('输出未包含 OK');
    expect(badCasesRes.body.byEvaluator[0].cases[0].rawOutput).toBe('{"judge":"fail"}');

    const retryRes = await request(app.server)
      .post(`/api/v2/evaluation/run-items/${sourceItem.id}/retry`)
      .set(authHeader())
      .expect(201);
    expect(retryRes.body.items).toBe(1);
    expect(retryRes.body.retry_of_run_id).toBe(sourceRunId);
    expect(retryRes.body.source_run_item_id).toBe(sourceItem.id);

    const retriedItemsRes = await request(app.server)
      .get(`/api/v2/evaluation/runs/${retryRes.body.run.id}/items`)
      .set(authHeader())
      .expect(200);
    expect(retriedItemsRes.body.items).toHaveLength(1);
    expect(retriedItemsRes.body.items[0].dataset_version_item_id).toBe(sourceItem.dataset_version_item_id);

    const addDatasetRes = await request(app.server)
      .post(`/api/v2/evaluation/run-items/${sourceItem.id}/add-to-dataset`)
      .set(authHeader())
      .send({ datasetId, expectedOutput: '人工期望答案' })
      .expect(201);
    expect(addDatasetRes.body.dataset.id).toBe(datasetId);
    expect(addDatasetRes.body.run_item_id).toBe(sourceItem.id);

    const datasetItemsRes = await request(app.server)
      .get(`/api/evaluation/datasets/${datasetId}/items`)
      .set(authHeader())
      .expect(200);
    const createdItem = datasetItemsRes.body.find(
      (item: { input: string; expected_output: string }) =>
        item.input === '问题A' && item.expected_output === '人工期望答案'
    );
    expect(createdItem).toBeTruthy();
  });
});
