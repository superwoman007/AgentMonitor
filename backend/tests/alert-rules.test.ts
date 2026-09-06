import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { evaluateRunAlerts, __clearAlertRulesForTests } from '../src/services/alert-rule.js';

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

describe('PR-13c：持久化 Alert Rule / Webhook', () => {
  let app: FastifyInstance;
  let authToken: string;
  let projectId: string;
  let experimentId: string;
  const testId = `pr13c-${Date.now()}`;
  const authHeader = (): Record<string, string> => ({
    Authorization: `Bearer ${authToken}`,
    'x-test-id': testId,
  });

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    await __clearAlertRulesForTests();

    const register = await request(app.server)
      .post('/api/auth/register')
      .set('x-test-id', testId)
      .send({ email: `pr13c-${Date.now()}@example.com`, password: 'Test12345678!', name: 'PR13c' })
      .expect(201);
    authToken = register.body.token;

    const project = await request(app.server)
      .post('/api/projects')
      .set(authHeader())
      .send({ name: 'PR13c Project' })
      .expect(201);
    projectId = project.body.id;

    // 构造一个可运行的 V2 Experiment
    const ds = await request(app.server)
      .post('/api/evaluation/datasets')
      .set(authHeader())
      .send({ project_id: projectId, name: 'PR13c DS' })
      .expect(201);
    await request(app.server)
      .post(`/api/evaluation/datasets/${ds.body.id}/items`)
      .set(authHeader())
      .send({ items: [{ input: '问题A', expected_output: 'OK' }] })
      .expect(201);
    const dv = await request(app.server)
      .post(`/api/evaluation/datasets/${ds.body.id}/versions`)
      .set(authHeader())
      .send({ description: 'v1' })
      .expect(201);

    const mc = await request(app.server)
      .post('/api/model-configs')
      .set(authHeader())
      .send({ project_id: projectId, name: 'PR13c Model', provider: 'openai', model: 'gpt-4o-mini', api_key: 'sk-test' })
      .expect(201);
    const target = await request(app.server)
      .post('/api/v2/evaluation/targets')
      .set(authHeader())
      .send({ projectId, name: 'PR13c Target', type: 'prompt_model', invocationConfig: { modelConfigId: mc.body.id } })
      .expect(201);
    const evaluator = await request(app.server)
      .post('/api/evaluation/evaluators')
      .set(authHeader())
      .send({ project_id: projectId, name: 'PR13c Contains', type: 'contains', config: { keywords: ['OK'], check_mode: 'whitelist', threshold: 0.5 } })
      .expect(201);
    await request(app.server)
      .put(`/api/evaluation/evaluators/${evaluator.body.id}`)
      .set(authHeader())
      .send({ name: 'PR13c Contains' })
      .expect(200);
    const evV = await request(app.server).get(`/api/evaluation/evaluators/${evaluator.body.id}/versions`).set(authHeader());
    const suite = await request(app.server)
      .post('/api/v2/evaluation/suites')
      .set(authHeader())
      .send({
        projectId,
        name: 'PR13c Suite',
        members: [{ evaluatorVersionId: evV.body.versions[0].id, alias: 'contains', weight: 1, required: true }],
        aggregationConfig: { strategy: 'all_required' },
      })
      .expect(201);

    const { createExperiment } = await import('../src/services/evaluation.js');
    const exp = await createExperiment(
      projectId, 'PR13c Experiment', ds.body.id, 'PR-13c e2e',
      undefined, undefined, undefined, undefined, undefined, undefined,
      { datasetVersionId: dv.body.id, targetVersionId: target.body.version.id, evaluatorSuiteVersionId: suite.body.version.id }
    );
    experimentId = exp.id;
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  it('POST /alert-rules 创建规则；run_regression 缺少 threshold 返回 400', async () => {
    const ok = await request(app.server)
      .post('/api/v2/evaluation/alert-rules')
      .set(authHeader())
      .send({
        projectId,
        name: '通过率低于 80%',
        eventType: 'run_regression',
        threshold: 0.8,
        webhookUrl: 'https://hooks.example.com/pr13c',
      })
      .expect(201);
    expect(ok.body.rule.id).toBeTruthy();
    expect(ok.body.rule.event_type).toBe('run_regression');
    expect(ok.body.rule.channels).toEqual(['web']);

    await request(app.server)
      .post('/api/v2/evaluation/alert-rules')
      .set(authHeader())
      .send({ projectId, name: '缺阈值', eventType: 'run_regression' })
      .expect(400);
  });

  it('GET /alert-rules 列表、PATCH 停用、DELETE 删除', async () => {
    const created = await request(app.server)
      .post('/api/v2/evaluation/alert-rules')
      .set(authHeader())
      .send({ projectId, name: 'Run 失败告警', eventType: 'run_failed' })
      .expect(201);
    const id = created.body.rule.id;

    const list = await request(app.server)
      .get(`/api/v2/evaluation/alert-rules?projectId=${projectId}`)
      .set(authHeader())
      .expect(200);
    expect(list.body.rules.length).toBeGreaterThanOrEqual(2);

    const patched = await request(app.server)
      .patch(`/api/v2/evaluation/alert-rules/${id}`)
      .set(authHeader())
      .send({ projectId, enabled: false })
      .expect(200);
    expect(patched.body.rule.enabled).toBe(false);

    await request(app.server)
      .delete(`/api/v2/evaluation/alert-rules/${id}?projectId=${projectId}`)
      .set(authHeader())
      .expect(204);
    await request(app.server)
      .get(`/api/v2/evaluation/alert-rules/${id}?projectId=${projectId}`)
      .set(authHeader())
      .expect(404);
  });

  it('evaluateRunAlerts：run_regression 低通过率触发并投递 Webhook，高通过率不触发', async () => {
    const webhookCalls: unknown[] = [];
    const fetchImpl = (async (url: string, init?: { body?: string }) => {
      webhookCalls.push({ url, body: init?.body ? JSON.parse(init.body) : null });
      return { ok: true, status: 200 } as Response;
    }) as unknown as typeof fetch;

    // 清理其它用例遗留规则，保证本用例 webhook 计数只来自本规则
    const before = await request(app.server)
      .get(`/api/v2/evaluation/alert-rules?projectId=${projectId}`)
      .set(authHeader());
    for (const r of before.body.rules) {
      await request(app.server)
        .delete(`/api/v2/evaluation/alert-rules/${r.id}?projectId=${projectId}`)
        .set(authHeader());
    }

    const ruleRes = await request(app.server)
      .post('/api/v2/evaluation/alert-rules')
      .set(authHeader())
      .send({
        projectId,
        name: '回归 Webhook 测试',
        eventType: 'run_regression',
        threshold: 0.9,
        webhookUrl: 'https://hooks.example.com/regression',
      })
      .expect(201);
    const ruleId = ruleRes.body.rule.id;

    // 通过率 0.5 < 0.9 → 触发；test-1 的 0.8 规则也会命中（仅它没有 webhook）
    const triggered = await evaluateRunAlerts(
      projectId,
      { runId: 'run-low', runNumber: 1, experimentId, experimentName: 'PR13c Experiment', status: 'completed', passRate: 0.5, totalItems: 2, passedItems: 1 },
      { fetchImpl }
    );
    const mine = triggered.find((e) => e.rule_id === ruleId);
    expect(mine).toBeTruthy();
    expect(mine!.severity).toBe('warning');
    expect(mine!.delivery_status).toBe('delivered');
    // 只有本规则配置了 webhook，投递恰好一次
    expect(webhookCalls).toHaveLength(1);
    const body = webhookCalls[0] as { url: string; body: Record<string, unknown> };
    expect(body.url).toBe('https://hooks.example.com/regression');
    expect(body.body.event).toBe('run_regression');
    expect(body.body.runId).toBe('run-low');

    // 同一 Run 重复评估 → 指纹去重，本规则不再产生事件/Webhook
    const again = await evaluateRunAlerts(
      projectId,
      { runId: 'run-low', runNumber: 1, experimentId, status: 'completed', passRate: 0.5 },
      { fetchImpl }
    );
    expect(again.find((e) => e.rule_id === ruleId)).toBeUndefined();
    expect(webhookCalls).toHaveLength(1);

    // 通过率 0.95 ≥ 0.9 → 不触发
    const healthy = await evaluateRunAlerts(
      projectId,
      { runId: 'run-high', runNumber: 2, experimentId, status: 'completed', passRate: 0.95 },
      { fetchImpl }
    );
    expect(healthy).toHaveLength(0);
    expect(webhookCalls).toHaveLength(1);

    // 事件可在 alert-events 列表读到
    const events = await request(app.server)
      .get(`/api/v2/evaluation/alert-events?projectId=${projectId}`)
      .set(authHeader())
      .expect(200);
    expect(events.body.events.length).toBeGreaterThanOrEqual(1);
    expect(events.body.events[0].delivery_status).toBe('delivered');
    // 清理该规则避免影响后续端到端
    await request(app.server)
      .delete(`/api/v2/evaluation/alert-rules/${ruleId}?projectId=${projectId}`)
      .set(authHeader());
  });

  it('evaluateRunAlerts：Webhook 失败时 delivery_status=failed 但事件仍落库', async () => {
    await request(app.server)
      .post('/api/v2/evaluation/alert-rules')
      .set(authHeader())
      .send({
        projectId,
        name: '失败 Webhook',
        eventType: 'run_failed',
        webhookUrl: 'https://hooks.example.com/fail',
      })
      .expect(201);

    const failingFetch = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;

    const events = await evaluateRunAlerts(
      projectId,
      { runId: 'run-failed-1', runNumber: 9, experimentId, status: 'failed' },
      { fetchImpl: failingFetch }
    );
    const failed = events.find((e) => e.event_type === 'run_failed');
    expect(failed).toBeTruthy();
    expect(failed!.severity).toBe('critical');
    expect(failed!.delivery_status).toBe('failed');
    expect(failed!.delivery_error).toContain('ECONNREFUSED');
  });

  it('端到端：Run 完成后 Worker 自动评估告警并生成事件', async () => {
    // 新建一个 run_completed 规则（无 webhook，delivery 应为 skipped）
    await request(app.server)
      .post('/api/v2/evaluation/alert-rules')
      .set(authHeader())
      .send({ projectId, name: '全部完成通知', eventType: 'run_completed' })
      .expect(201);

    const start = await request(app.server)
      .post(`/api/evaluation/experiments/${experimentId}/start`)
      .set(authHeader())
      .expect(202);
    const runId = start.body.run.id;

    await vi.waitFor(
      async () => {
        const r = await request(app.server).get(`/api/v2/evaluation/runs/${runId}`).set(authHeader());
        if (r.body.run.status !== 'completed' && r.body.run.status !== 'failed') {
          throw new Error(`run still ${r.body.run.status}`);
        }
        return r.body.run;
      },
      { timeout: 15000, interval: 200 }
    );

    const events = await vi.waitFor(
      async () => {
        const res = await request(app.server)
          .get(`/api/v2/evaluation/alert-events?projectId=${projectId}&limit=50`)
          .set(authHeader());
        const matched = res.body.events.filter(
          (e: { payload?: { runId?: string } }) => e.payload?.runId === runId
        );
        if (matched.length === 0) throw new Error('alert event not yet created');
        return matched;
      },
      { timeout: 8000, interval: 300 }
    );
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].event_type).toBe('run_completed');
  });

  it('非项目所有者访问返回 404', async () => {
    const other = await request(app.server)
      .post('/api/auth/register')
      .set('x-test-id', testId)
      .send({ email: `pr13c-other-${Date.now()}@example.com`, password: 'Test12345678!', name: 'Other' })
      .expect(201);
    await request(app.server)
      .get(`/api/v2/evaluation/alert-rules?projectId=${projectId}`)
      .set({ Authorization: `Bearer ${other.body.token}` })
      .expect(404);
  });
});
