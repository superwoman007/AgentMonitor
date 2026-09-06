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

describe('PR-11：Run Report / Bad Cases / Compare / Export', () => {
  let app: FastifyInstance;
  let authToken: string;
  let projectId: string;
  let datasetId: string;
  let datasetVersionId: string;
  let targetVersionId: string;
  let suiteVersionId: string;
  let experimentId: string;
  let completedRunId: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    const { stopEvaluationWorker } = await import('../src/services/evaluation-worker.js');
    stopEvaluationWorker();

    const email = `pr11-${Date.now()}@example.com`;
    const reg = await request(app.server)
      .post('/api/auth/register')
      .send({ email, password: 'Test12345678!', name: 'PR11' })
      .expect(201);
    authToken = reg.body.token;
    const auth = { Authorization: `Bearer ${authToken}` };

    const proj = await request(app.server).post('/api/projects').set(auth).send({ name: 'PR11' }).expect(201);
    projectId = proj.body.id;

    const ds = await request(app.server)
      .post('/api/evaluation/datasets')
      .set(auth)
      .send({ project_id: projectId, name: 'DS' })
      .expect(201);
    datasetId = ds.body.id;
    await request(app.server)
      .post(`/api/evaluation/datasets/${datasetId}/items`)
      .set(auth)
      .send({ items: [
        { input: 'hello', expected_output: 'OK' },
        { input: 'bye', expected_output: 'OK' },
      ] })
      .expect(201);
    const dv = await request(app.server)
      .post(`/api/evaluation/datasets/${datasetId}/versions`)
      .set(auth)
      .send({ description: 'v1' })
      .expect(201);
    datasetVersionId = dv.body.id;

    const mc = await request(app.server)
      .post('/api/model-configs')
      .set(auth)
      .send({ project_id: projectId, name: 'M', provider: 'openai', model: 'gpt-4o-mini', api_key: 'sk-x' })
      .expect(201);
    const t = await request(app.server)
      .post('/api/v2/evaluation/targets')
      .set(auth)
      .send({ projectId, name: 'T', type: 'prompt_model', invocationConfig: { modelConfigId: mc.body.id } })
      .expect(201);
    targetVersionId = t.body.version.id;

    const ev = await request(app.server)
      .post('/api/evaluation/evaluators')
      .set(auth)
      .send({ project_id: projectId, name: 'contains', type: 'contains', config: { keywords: ['OK'] } })
      .expect(201);
    await request(app.server)
      .put(`/api/evaluation/evaluators/${ev.body.id}`)
      .set(auth)
      .send({ name: 'contains' })
      .expect(200);
    const evVers = await request(app.server)
      .get(`/api/evaluation/evaluators/${ev.body.id}/versions`)
      .set(auth);
    const evaluatorVersionId = evVers.body.versions[0].id;
    const s = await request(app.server)
      .post('/api/v2/evaluation/suites')
      .set(auth)
      .send({
        projectId,
        name: 'S',
        members: [{ evaluatorVersionId, alias: 'kw', weight: 1, required: true }],
        aggregationConfig: { strategy: 'all_required' },
      })
      .expect(201);
    suiteVersionId = s.body.version.id;

    const { createExperiment } = await import('../src/services/evaluation.js');
    const exp = await createExperiment(projectId, 'PR11 Exp', datasetId, undefined, undefined, undefined, undefined, undefined, undefined, undefined, {
      datasetVersionId,
      targetVersionId,
      evaluatorSuiteVersionId: suiteVersionId,
    });
    experimentId = exp.id;

    // 触发一次完整 Run，由 Worker 同步执行完成
    const start = await request(app.server)
      .post(`/api/evaluation/experiments/${experimentId}/start`)
      .set(auth)
      .expect(202);
    completedRunId = start.body.run.id;
    const { getEvaluationWorker } = await import('../src/services/evaluation-worker.js');
    const worker = getEvaluationWorker();
    // 多轮 tick 保证完成
    for (let i = 0; i < 5; i += 1) {
      await worker.tick();
      await new Promise((r) => setTimeout(r, 50));
    }
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  it('GET /runs/:id/report 返回 run + items + badCases', async () => {
    const res = await request(app.server)
      .get(`/api/v2/evaluation/runs/${completedRunId}/report`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    expect(res.body.run.id).toBe(completedRunId);
    expect(res.body.run.status).toBe('completed');
    expect(res.body.items.items.length).toBeGreaterThanOrEqual(2);
    expect(res.body.badCases).toBeDefined();
    expect(res.body.badCases.totalItems).toBe(2);
  });

  it('GET /runs/:id/items 支持 status/passed 过滤', async () => {
    const res = await request(app.server)
      .get(`/api/v2/evaluation/runs/${completedRunId}/items?status=succeeded`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    expect(res.body.items.length).toBeGreaterThanOrEqual(2);
    for (const item of res.body.items) {
      expect(item.status).toBe('succeeded');
    }
  });

  it('GET /runs/:id/bad-cases 返回失败聚合（全通过时 failedItems=0）', async () => {
    const res = await request(app.server)
      .get(`/api/v2/evaluation/runs/${completedRunId}/bad-cases`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    expect(res.body.runId).toBe(completedRunId);
    expect(res.body.failedItems).toBe(0);
    expect(Array.isArray(res.body.byEvaluator)).toBe(true);
  });

  it('GET /runs/:id/export?format=junit 返回合法 XML', async () => {
    const res = await request(app.server)
      .get(`/api/v2/evaluation/runs/${completedRunId}/export?format=junit`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    expect(res.headers['content-type']).toContain('xml');
    const xml = res.text as string;
    expect(xml).toContain('<?xml');
    expect(xml).toContain('<testsuites');
    expect(xml).toContain('<testcase');
    expect(xml).toContain('</testsuites>');
  });

  it('GET /runs/:id/export 默认返回 JSON', async () => {
    const res = await request(app.server)
      .get(`/api/v2/evaluation/runs/${completedRunId}/export`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    expect(res.body.run.id).toBe(completedRunId);
    expect(Array.isArray(res.body.events)).toBe(true);
    expect(res.body.items.items.length).toBeGreaterThanOrEqual(2);
  });

  it('POST /runs:compare 返回两个 Run 的 diff', async () => {
    // 再跑一次 Run 作为 candidate（内容相同，应全部 still passing / 无回归）
    const start = await request(app.server)
      .post(`/api/evaluation/experiments/${experimentId}/start`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(202);
    const candidateRunId = start.body.run.id;
    const { getEvaluationWorker } = await import('../src/services/evaluation-worker.js');
    for (let i = 0; i < 5; i += 1) {
      await getEvaluationWorker().tick();
      await new Promise((r) => setTimeout(r, 50));
    }

    const res = await request(app.server)
      .post('/api/v2/evaluation/runs:compare')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ baselineRunId: completedRunId, candidateRunId })
      .expect(200);
    expect(res.body.baseline.runId).toBe(completedRunId);
    expect(res.body.candidate.runId).toBe(candidateRunId);
    expect(Array.isArray(res.body.fixedCases)).toBe(true);
    expect(Array.isArray(res.body.regressedCases)).toBe(true);
    expect(Array.isArray(res.body.stillFailing)).toBe(true);
    expect(Array.isArray(res.body.newFailed)).toBe(true);
    // 两次都通过，不应有回归/新失败
    expect(res.body.regressedCases.length).toBe(0);
    expect(res.body.newFailed.length).toBe(0);
  });
});
