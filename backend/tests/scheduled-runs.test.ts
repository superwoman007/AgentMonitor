import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { FastifyInstance } from 'fastify';
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

describe('PR-13a：Scheduled Run 定时回归', () => {
  let app: FastifyInstance;
  let authToken: string;
  let projectId: string;
  let experimentId: string;
  const testId = `pr13a-${Date.now()}`;
  const authHeader = (): Record<string, string> => ({
    Authorization: `Bearer ${authToken}`,
    'x-test-id': testId,
  });

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const email = `pr13a-${Date.now()}@example.com`;
    const register = await request(app.server)
      .post('/api/auth/register')
      .set('x-test-id', testId)
      .send({ email, password: 'Test12345678!', name: 'PR13a' })
      .expect(201);
    authToken = register.body.token;

    const project = await request(app.server)
      .post('/api/projects')
      .set(authHeader())
      .send({ name: 'PR13a Project' })
      .expect(201);
    projectId = project.body.id;

    // Dataset + 2 条样本 + commit
    const ds = await request(app.server)
      .post('/api/evaluation/datasets')
      .set(authHeader())
      .send({ project_id: projectId, name: 'PR13a DS' })
      .expect(201);
    const datasetId = ds.body.id;
    await request(app.server)
      .post(`/api/evaluation/datasets/${datasetId}/items`)
      .set(authHeader())
      .send({ items: [{ input: '问题A', expected_output: 'OK' }] })
      .expect(201);
    const dv = await request(app.server)
      .post(`/api/evaluation/datasets/${datasetId}/versions`)
      .set(authHeader())
      .send({ description: 'v1' })
      .expect(201);

    // Target（prompt_model）
    const mc = await request(app.server)
      .post('/api/model-configs')
      .set(authHeader())
      .send({
        project_id: projectId,
        name: 'PR13a Model',
        provider: 'openai',
        model: 'gpt-4o-mini',
        api_key: 'sk-test-pr13a',
      })
      .expect(201);
    const target = await request(app.server)
      .post('/api/v2/evaluation/targets')
      .set(authHeader())
      .send({
        projectId,
        name: 'PR13a Target',
        type: 'prompt_model',
        invocationConfig: { modelConfigId: mc.body.id },
      })
      .expect(201);

    // Evaluator + suite
    const evaluator = await request(app.server)
      .post('/api/evaluation/evaluators')
      .set(authHeader())
      .send({
        project_id: projectId,
        name: 'PR13a Contains',
        type: 'contains',
        config: { keywords: ['OK'], check_mode: 'whitelist', threshold: 0.5 },
      })
      .expect(201);
    // PUT 一次以生成不可变 EvaluatorVersion 快照
    await request(app.server)
      .put(`/api/evaluation/evaluators/${evaluator.body.id}`)
      .set(authHeader())
      .send({ name: 'PR13a Contains' })
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
        name: 'PR13a Suite',
        members: [{ evaluatorVersionId, alias: 'contains', weight: 1, required: true }],
        aggregationConfig: { strategy: 'all_required' },
      })
      .expect(201);

    const { createExperiment } = await import('../src/services/evaluation.js');
    const exp = await createExperiment(
      projectId,
      'PR13a Experiment',
      datasetId,
      'PR-13a e2e',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        datasetVersionId: dv.body.id,
        targetVersionId: target.body.version.id,
        evaluatorSuiteVersionId: suite.body.version.id,
      }
    );
    experimentId = exp.id;
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  it('POST /schedules 创建 interval 调度并预计算 next_run_at', async () => {
    const res = await request(app.server)
      .post('/api/v2/evaluation/schedules')
      .set(authHeader())
      .send({
        projectId,
        experimentId,
        name: '每小时回归',
        scheduleType: 'interval',
        intervalMinutes: 60,
      })
      .expect(201);
    expect(res.body.schedule.id).toBeTruthy();
    expect(res.body.schedule.enabled).toBe(true);
    expect(res.body.schedule.next_run_at).toBeTruthy();
    expect(new Date(res.body.schedule.next_run_at).getTime()).toBeGreaterThan(Date.now());
  });

  it('POST /schedules 创建 cron 调度，非法表达式返回 400', async () => {
    const ok = await request(app.server)
      .post('/api/v2/evaluation/schedules')
      .set(authHeader())
      .send({
        projectId,
        experimentId,
        name: '工作日早间',
        scheduleType: 'cron',
        cronExpr: '0 9 * * 1-5',
      })
      .expect(201);
    expect(ok.body.schedule.cron_expr).toBe('0 9 * * 1-5');

    await request(app.server)
      .post('/api/v2/evaluation/schedules')
      .set(authHeader())
      .send({
        projectId,
        experimentId,
        name: '非法',
        scheduleType: 'cron',
        cronExpr: '99 * * *',
      })
      .expect(400);

    await request(app.server)
      .post('/api/v2/evaluation/schedules')
      .set(authHeader())
      .send({
        projectId,
        experimentId,
        name: '缺间隔',
        scheduleType: 'interval',
      })
      .expect(400);
  });

  it('GET /schedules 支持按 experimentId 过滤', async () => {
    const res = await request(app.server)
      .get(`/api/v2/evaluation/schedules?projectId=${projectId}&experimentId=${experimentId}`)
      .set(authHeader())
      .expect(200);
    expect(Array.isArray(res.body.schedules)).toBe(true);
    expect(res.body.schedules.length).toBeGreaterThanOrEqual(2);
    for (const s of res.body.schedules) {
      expect(s.experiment_id).toBe(experimentId);
    }
  });

  it('PATCH /schedules/:id 可禁用调度并清空 next_run_at', async () => {
    const created = await request(app.server)
      .post('/api/v2/evaluation/schedules')
      .set(authHeader())
      .send({
        projectId,
        experimentId,
        name: '待禁用',
        scheduleType: 'interval',
        intervalMinutes: 30,
      })
      .expect(201);
    const id = created.body.schedule.id;

    const patched = await request(app.server)
      .patch(`/api/v2/evaluation/schedules/${id}`)
      .set(authHeader())
      .send({ projectId, enabled: false })
      .expect(200);
    expect(patched.body.schedule.enabled).toBe(false);
    expect(patched.body.schedule.next_run_at).toBeNull();

    const reEnabled = await request(app.server)
      .patch(`/api/v2/evaluation/schedules/${id}`)
      .set(authHeader())
      .send({ projectId, enabled: true })
      .expect(200);
    expect(reEnabled.body.schedule.enabled).toBe(true);
    expect(reEnabled.body.schedule.next_run_at).toBeTruthy();
  });

  it('POST /schedules/:id/run-now 立即触发一次 Run', async () => {
    const created = await request(app.server)
      .post('/api/v2/evaluation/schedules')
      .set(authHeader())
      .send({
        projectId,
        experimentId,
        name: '手动触发',
        scheduleType: 'interval',
        intervalMinutes: 120,
      })
      .expect(201);
    const id = created.body.schedule.id;

    const runNow = await request(app.server)
      .post(`/api/v2/evaluation/schedules/${id}/run-now?projectId=${projectId}`)
      .set(authHeader())
      .expect(201);
    expect(runNow.body.runId).toBeTruthy();

    const detail = await request(app.server)
      .get(`/api/v2/evaluation/schedules/${id}?projectId=${projectId}`)
      .set(authHeader())
      .expect(200);
    expect(detail.body.schedule.last_run_id).toBe(runNow.body.runId);
    expect(detail.body.schedule.last_status).toBe('created');

    const executions = await request(app.server)
      .get(`/api/v2/evaluation/schedules/${id}/executions?projectId=${projectId}&limit=10`)
      .set(authHeader())
      .expect(200);
    expect(Array.isArray(executions.body.executions)).toBe(true);
    expect(executions.body.executions[0].trigger_mode).toBe('manual');
    expect(executions.body.executions[0].status).toBe('created');
    expect(executions.body.executions[0].run_id).toBe(runNow.body.runId);
    expect(executions.body.executions[0].completed_at).toBeTruthy();
  });

  it('Worker 到期扫描：next_run_at 置为过去后自动触发 Run 并滚动 next_run_at', async () => {
    const { createScheduledRun, getScheduledRun, __clearScheduledRunsForTests } = await import(
      '../src/services/scheduled-run.js'
    );
    // 隔离：清掉其它调度，避免干扰计数
    await __clearScheduledRunsForTests();

    const schedule = await createScheduledRun({
      projectId,
      experimentId,
      name: '到期扫描',
      scheduleType: 'interval',
      intervalMinutes: 60,
    });
    // 手动把 next_run_at 调到过去
    const { run } = await import('../src/db/index.js');
    await run(`UPDATE scheduled_runs SET next_run_at = $2 WHERE id = $1`, [
      schedule.id,
      new Date(Date.now() - 60_000).toISOString(),
    ]);

    const { getEvaluationWorker } = await import('../src/services/evaluation-worker.js');
    const worker = getEvaluationWorker();
    const triggered = await worker.runDueSchedules();
    expect(triggered).toBe(1);

    const after = await getScheduledRun(projectId, schedule.id);
    expect(after).not.toBeNull();
    expect(after!.last_run_id).toBeTruthy();
    expect(after!.last_status).toBe('created');
    // next_run_at 已滚动到未来
    expect(new Date(after!.next_run_at!).getTime()).toBeGreaterThan(Date.now());

    // 再次扫描无到期项
    const second = await worker.runDueSchedules();
    expect(second).toBe(0);

    const executions = await request(app.server)
      .get(`/api/v2/evaluation/schedules/${schedule.id}/executions?projectId=${projectId}&limit=10`)
      .set(authHeader())
      .expect(200);
    expect(executions.body.executions[0].trigger_mode).toBe('scheduled');
    expect(executions.body.executions[0].status).toBe('created');
    expect(executions.body.executions[0].run_id).toBe(after!.last_run_id);
  });

  it('DELETE /schedules/:id 删除调度', async () => {
    const created = await request(app.server)
      .post('/api/v2/evaluation/schedules')
      .set(authHeader())
      .send({
        projectId,
        experimentId,
        name: '待删除',
        scheduleType: 'interval',
        intervalMinutes: 30,
      })
      .expect(201);
    const id = created.body.schedule.id;

    await request(app.server)
      .delete(`/api/v2/evaluation/schedules/${id}?projectId=${projectId}`)
      .set(authHeader())
      .expect(204);

    await request(app.server)
      .get(`/api/v2/evaluation/schedules/${id}?projectId=${projectId}`)
      .set(authHeader())
      .expect(404);
  });

  it('非项目所有者访问调度列表返回 404', async () => {
    const register2 = await request(app.server)
      .post('/api/auth/register')
      .set('x-test-id', testId)
      .send({
        email: `pr13a-other-${Date.now()}@example.com`,
        password: 'Test12345678!',
        name: 'PR13a Other',
      })
      .expect(201);
    const otherToken = register2.body.token;

    await request(app.server)
      .get(`/api/v2/evaluation/schedules?projectId=${projectId}`)
      .set({ Authorization: `Bearer ${otherToken}` })
      .expect(404);

    await request(app.server)
      .post('/api/v2/evaluation/schedules')
      .set({ Authorization: `Bearer ${otherToken}` })
      .send({
        projectId,
        experimentId,
        name: '越权',
        scheduleType: 'interval',
        intervalMinutes: 60,
      })
      .expect(404);
  });
});
