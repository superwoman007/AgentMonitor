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

describe('PR-10：Service Token + External Runner 协议', () => {
  let app: FastifyInstance;
  let authToken: string;
  let projectId: string;
  let datasetId: string;
  let datasetVersionId: string;
  let targetVersionId: string;
  let suiteVersionId: string;
  let experimentId: string;
  let serviceToken: string;

  const authHeader = (): Record<string, string> => ({ Authorization: `Bearer ${authToken}` });
  const svcHeader = (): Record<string, string> => ({ Authorization: `Bearer ${serviceToken}` });

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    // 显式停止全局 Worker，避免在 Runner Session 创建前自动 claim 并完成 Run
    const { stopEvaluationWorker } = await import('../src/services/evaluation-worker.js');
    stopEvaluationWorker();

    const email = `pr10-${Date.now()}@example.com`;
    const register = await request(app.server)
      .post('/api/auth/register')
      .send({ email, password: 'Test12345678!', name: 'PR10' })
      .expect(201);
    authToken = register.body.token;

    const project = await request(app.server)
      .post('/api/projects')
      .set(authHeader())
      .send({ name: 'PR10 Project' })
      .expect(201);
    projectId = project.body.id;

    // Dataset + 1 item + version
    const ds = await request(app.server)
      .post('/api/evaluation/datasets')
      .set(authHeader())
      .send({ project_id: projectId, name: 'PR10 DS' })
      .expect(201);
    datasetId = ds.body.id;
    await request(app.server)
      .post(`/api/evaluation/datasets/${datasetId}/items`)
      .set(authHeader())
      .send({ items: [{ input: 'hello', expected_output: 'OK' }] })
      .expect(201);
    const dv = await request(app.server)
      .post(`/api/evaluation/datasets/${datasetId}/versions`)
      .set(authHeader())
      .send({ description: 'v1' })
      .expect(201);
    datasetVersionId = dv.body.id;

    // Target (prompt_model, since platform evaluates; external runner just provides output)
    const mc = await request(app.server)
      .post('/api/model-configs')
      .set(authHeader())
      .send({
        project_id: projectId,
        name: 'PR10 Model',
        provider: 'openai',
        model: 'gpt-4o-mini',
        api_key: 'sk-pr10',
      })
      .expect(201);
    const target = await request(app.server)
      .post('/api/v2/evaluation/targets')
      .set(authHeader())
      .send({
        projectId,
        name: 'PR10 Target',
        type: 'prompt_model',
        invocationConfig: { modelConfigId: mc.body.id },
      })
      .expect(201);
    targetVersionId = target.body.version.id;

    // Evaluator + suite
    const evaluator = await request(app.server)
      .post('/api/evaluation/evaluators')
      .set(authHeader())
      .send({
        project_id: projectId,
        name: 'PR10 Contains',
        type: 'contains',
        config: { keywords: ['OK'], check_mode: 'whitelist', threshold: 0.5 },
      })
      .expect(201);
    await request(app.server)
      .put(`/api/evaluation/evaluators/${evaluator.body.id}`)
      .set(authHeader())
      .send({ name: 'PR10 Contains' })
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
        name: 'PR10 Suite',
        members: [{ evaluatorVersionId, alias: 'contains', weight: 1, required: true }],
        aggregationConfig: { strategy: 'all_required' },
      })
      .expect(201);
    suiteVersionId = suite.body.version.id;

    // V2 Experiment
    const { createExperiment } = await import('../src/services/evaluation.js');
    const exp = await createExperiment(
      projectId,
      'PR10 Exp',
      datasetId,
      'external runner test',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { datasetVersionId, targetVersionId, evaluatorSuiteVersionId: suiteVersionId }
    );
    experimentId = exp.id;

    // Create a Service Token with runner scopes
    const tokenRes = await request(app.server)
      .post('/api/v2/service-tokens')
      .set(authHeader())
      .send({
        projectId,
        name: 'PR10 Runner Token',
        scopes: ['evaluation:run', 'evaluation:read', 'evaluation:result:write', 'datasets:read'],
      })
      .expect(201);
    serviceToken = tokenRes.body.token.plain_token;
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  it('GET /service-tokens/scopes 返回合法 scope 列表', async () => {
    const res = await request(app.server)
      .get('/api/v2/service-tokens/scopes')
      .set(authHeader())
      .expect(200);
    expect(res.body.scopes).toContain('evaluation:run');
    expect(res.body.scopes).toContain('evaluation:result:write');
  });

  it('Service Token 缺失 scope 时返回 403 INSUFFICIENT_SCOPE', async () => {
    // 创建一个只有 evaluation:read scope 的 token
    const readOnly = await request(app.server)
      .post('/api/v2/service-tokens')
      .set(authHeader())
      .send({ projectId, name: 'Read Only', scopes: ['evaluation:read'] })
      .expect(201);
    const readToken = readOnly.body.token.plain_token;
    // 尝试创建 runner session（需要 evaluation:run）应被拒
    await request(app.server)
      .post('/api/v2/evaluation/runner-sessions')
      .set('Authorization', `Bearer ${readToken}`)
      .send({ runId: '00000000-0000-0000-0000-000000000000' })
      .expect(403);
  });

  it('完整 External Runner 流程：start → session → claim → target-result → 平台补评分 → completed', async () => {
    // 1. 直接用 service 层准备 Run（绕过 POST /runs 路由的 worker.poke()），
    //    避免 Worker 在 Runner Session 创建前 claim 并完成 Run。
    const { prepareRun } = await import('../src/services/evaluation-run.js');
    const prep = await prepareRun(experimentId, { triggerType: 'manual' });
    const runId = prep.run.id;

    // 2. External Runner 用 Service Token 创建 session
    const sessionRes = await request(app.server)
      .post('/api/v2/evaluation/runner-sessions')
      .set(svcHeader())
      .send({ runId, runnerId: 'test-runner' })
      .expect(201);
    expect(sessionRes.body.session.run_id).toBe(runId);
    expect(sessionRes.body.session.status).toBe('active');
    const sessionId = sessionRes.body.session.id;

    // 3. 领取 RunItem
    const claim = await request(app.server)
      .post(`/api/v2/evaluation/runner-sessions/${sessionId}/claim`)
      .set(svcHeader())
      .send({})
      .expect(200);
    expect(claim.body.claimed).toBe(true);
    expect(claim.body.runItem.caseKey).toBeTruthy();
    const runItemId = claim.body.runItem.id;
    const leaseToken = claim.body.leaseToken;

    // 4. 模拟本地 Agent 执行后上传结果
    await request(app.server)
      .post(`/api/v2/evaluation/run-items/${runItemId}/target-result`)
      .set(svcHeader())
      .send({
        leaseToken,
        output: 'OK',
        latencyMs: 42,
      })
      .expect(200);

    // 5. Runner 关闭 session
    await request(app.server)
      .post(`/api/v2/evaluation/runner-sessions/${sessionId}/close`)
      .set(svcHeader())
      .expect(200);

    // 6. 平台 Worker 在下一轮 tick 补做评分并完成 Run
    const { getEvaluationWorker } = await import('../src/services/evaluation-worker.js');
    const worker = getEvaluationWorker();
    await worker.tick();
    // 给异步处理一点时间
    await new Promise((r) => setTimeout(r, 200));
    await worker.tick();

    const finalRes = await request(app.server)
      .get(`/api/v2/evaluation/runs-for-runner/${runId}`)
      .set(svcHeader())
      .expect(200);
    expect(finalRes.body.run.status).toBe('completed');
    expect(finalRes.body.run.summary.passedItems).toBe(1);
  });
});
