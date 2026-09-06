import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { computeBucket, pickVariantByBucket } from '../src/services/prompt-ab-test.js';
import { __clearAnnotationsForTests } from '../src/services/trace-annotation.js';
import { __clearAbVariantsForTests } from '../src/services/prompt-ab-test.js';

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

describe('P1：trace_replay / Trace 标注 / Prompt A/B', () => {
  let app: FastifyInstance;
  let authToken: string;
  let projectId: string;
  let apiKey: string;
  const testId = `p1-${Date.now()}`;
  const authHeader = (): Record<string, string> => ({
    Authorization: `Bearer ${authToken}`,
    'x-test-id': testId,
  });

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    await __clearAnnotationsForTests();
    await __clearAbVariantsForTests();

    const register = await request(app.server)
      .post('/api/auth/register')
      .set('x-test-id', testId)
      .send({ email: `p1-${Date.now()}@example.com`, password: 'Test12345678!', name: 'P1' })
      .expect(201);
    authToken = register.body.token;

    const project = await request(app.server)
      .post('/api/projects')
      .set(authHeader())
      .send({ name: 'P1 Project' })
      .expect(201);
    projectId = project.body.id;

    const key = await request(app.server)
      .post('/api/apikeys')
      .set(authHeader())
      .send({ project_id: projectId, name: 'P1 Key' })
      .expect(201);
    apiKey = key.body.key;
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  describe('trace_replay Target 回放评分', () => {
    it('trace_replay Target 不实时调用 Agent，直接对历史输出评分', async () => {
      // 数据集：样本 expected 即历史 Agent 输出
      const ds = await request(app.server)
        .post('/api/evaluation/datasets')
        .set(authHeader())
        .send({ project_id: projectId, name: 'P1 Replay DS' })
        .expect(201);
      await request(app.server)
        .post(`/api/evaluation/datasets/${ds.body.id}/items`)
        .set(authHeader())
        .send({ items: [{ input: '问题A', expected_output: 'OK 答案' }] })
        .expect(201);
      const dv = await request(app.server)
        .post(`/api/evaluation/datasets/${ds.body.id}/versions`)
        .set(authHeader())
        .send({ description: 'v1' })
        .expect(201);

      // trace_replay Target（无需 modelConfig）
      const target = await request(app.server)
        .post('/api/v2/evaluation/targets')
        .set(authHeader())
        .send({ projectId, name: 'P1 Replay Target', type: 'trace_replay', invocationConfig: { source: 'trace' } })
        .expect(201);
      expect(target.body.version.target_type).toBe('trace_replay');

      const evaluator = await request(app.server)
        .post('/api/evaluation/evaluators')
        .set(authHeader())
        .send({ project_id: projectId, name: 'P1 Contains', type: 'contains', config: { keywords: ['OK'], check_mode: 'whitelist', threshold: 0.5 } })
        .expect(201);
      await request(app.server).put(`/api/evaluation/evaluators/${evaluator.body.id}`).set(authHeader()).send({ name: 'P1 Contains' }).expect(200);
      const evV = await request(app.server).get(`/api/evaluation/evaluators/${evaluator.body.id}/versions`).set(authHeader());
      const suite = await request(app.server)
        .post('/api/v2/evaluation/suites')
        .set(authHeader())
        .send({ projectId, name: 'P1 Replay Suite', members: [{ evaluatorVersionId: evV.body.versions[0].id, alias: 'contains', weight: 1, required: true }], aggregationConfig: { strategy: 'all_required' } })
        .expect(201);

      const { createExperiment } = await import('../src/services/evaluation.js');
      const exp = await createExperiment(projectId, 'P1 Replay Exp', ds.body.id, 'replay', undefined, undefined, undefined, undefined, undefined, undefined, {
        datasetVersionId: dv.body.id,
        targetVersionId: target.body.version.id,
        evaluatorSuiteVersionId: suite.body.version.id,
      });

      const start = await request(app.server)
        .post(`/api/evaluation/experiments/${exp.id}/start`)
        .set(authHeader())
        .expect(202);
      const runId = start.body.run.id;

      const final = await vi.waitFor(
        async () => {
          const r = await request(app.server).get(`/api/v2/evaluation/runs/${runId}`).set(authHeader());
          if (r.body.run.status !== 'completed' && r.body.run.status !== 'failed') {
            throw new Error(`run still ${r.body.run.status}`);
          }
          return r.body.run;
        },
        { timeout: 12000, interval: 150 }
      );
      // 回放模式：历史输出含 "OK" → contains 评测通过，不调用任何模型
      expect(final.status).toBe('completed');
      expect(final.summary.passedItems).toBe(1);
      expect(final.summary.totalItems).toBe(1);
    });
  });

  describe('Trace 人工标注', () => {
    it('PUT/GET/列表/统计/删除标注全流程', async () => {
      // 写入一条 Trace
      const traceRes = await request(app.server)
        .post('/api/traces')
        .set('X-API-Key', apiKey)
        .send({ traceType: 'llm', name: '标注测试', input: { content: 'q' }, output: { content: 'a' }, status: 'success' })
        .expect(201);
      const traceId = traceRes.body.trace.id;

      const enums = await request(app.server)
        .get('/api/v2/trace-annotations/enums')
        .set(authHeader())
        .expect(200);
      expect(enums.body.rootCauses).toContain('prompt');
      expect(enums.body.verdicts).toContain('bad');

      const put = await request(app.server)
        .put(`/api/v2/trace-annotations/${traceId}`)
        .set(authHeader())
        .send({ projectId, rootCause: 'prompt', verdict: 'bad', note: '提示词缺少约束', tags: ['回归', 'v2.1'] })
        .expect(200);
      expect(put.body.annotation.root_cause).toBe('prompt');
      expect(put.body.annotation.verdict).toBe('bad');
      expect(put.body.annotation.tags).toEqual(['回归', 'v2.1']);

      // UPSERT：同一 Trace 再次提交覆盖
      const put2 = await request(app.server)
        .put(`/api/v2/trace-annotations/${traceId}`)
        .set(authHeader())
        .send({ projectId, rootCause: 'model', verdict: 'uncertain' })
        .expect(200);
      expect(put2.body.annotation.root_cause).toBe('model');

      const get = await request(app.server)
        .get(`/api/v2/trace-annotations/${traceId}?projectId=${projectId}`)
        .set(authHeader())
        .expect(200);
      expect(get.body.annotation.verdict).toBe('uncertain');

      const list = await request(app.server)
        .get(`/api/v2/trace-annotations?projectId=${projectId}&rootCause=model`)
        .set(authHeader())
        .expect(200);
      expect(list.body.annotations.length).toBeGreaterThanOrEqual(1);

      const stats = await request(app.server)
        .get(`/api/v2/trace-annotations-stats?projectId=${projectId}`)
        .set(authHeader())
        .expect(200);
      expect(stats.body.stats.model).toBeGreaterThanOrEqual(1);

      // 非法枚举 400
      await request(app.server)
        .put(`/api/v2/trace-annotations/${traceId}`)
        .set(authHeader())
        .send({ projectId, rootCause: 'not_a_cause' })
        .expect(400);

      // 不存在的 Trace 404
      await request(app.server)
        .put('/api/v2/trace-annotations/00000000-0000-0000-0000-000000000000')
        .set(authHeader())
        .send({ projectId, verdict: 'good' })
        .expect(404);

      await request(app.server)
        .delete(`/api/v2/trace-annotations/${traceId}?projectId=${projectId}`)
        .set(authHeader())
        .expect(204);
      await request(app.server)
        .get(`/api/v2/trace-annotations/${traceId}?projectId=${projectId}`)
        .set(authHeader())
        .expect(404);
    });
  });

  describe('Prompt A/B 分流', () => {
    it('分桶确定性：同一 bucketKey 桶号稳定，权重分流比例近似正确', () => {
      // 同一键稳定
      const b1 = computeBucket('prompt-1', 'production', 'user-42');
      const b2 = computeBucket('prompt-1', 'production', 'user-42');
      expect(b1).toBe(b2);
      // 不同键分布
      const buckets = new Set<number>();
      for (let i = 0; i < 200; i += 1) buckets.add(computeBucket('prompt-1', 'production', `user-${i}`));
      expect(buckets.size).toBeGreaterThan(50);

      // B 变体权重 30%：桶 0-29 命中 B
      expect(pickVariantByBucket([{ variant_key: 'B', weight: 30 }], 0)).toBe('B');
      expect(pickVariantByBucket([{ variant_key: 'B', weight: 30 }], 29)).toBe('B');
      expect(pickVariantByBucket([{ variant_key: 'B', weight: 30 }], 30)).toBeNull();
      expect(pickVariantByBucket([{ variant_key: 'B', weight: 30 }], 99)).toBeNull();
    });

    it('Runtime 按 bucketKey 分流到变体版本', async () => {
      // Prompt + 两个版本 + 基线部署
      const prompt = await request(app.server)
        .post('/api/prompts')
        .set(authHeader())
        .send({ project_id: projectId, name: 'ab-agent', description: 'ab', content: 'base v1' })
        .expect(201);
      const promptId = prompt.body.id;
      const versionsRes = await request(app.server).get(`/api/prompts/${promptId}/versions`).set(authHeader());
      const v1Id = versionsRes.body[0].id;
      const v2 = await request(app.server)
        .post(`/api/prompts/${promptId}/versions`)
        .set(authHeader())
        .send({ content: 'candidate v2', description: 'B variant' })
        .expect(201);
      const v2Id = v2.body.version.id;

      // 基线部署 v1
      await request(app.server)
        .put(`/api/v2/prompt-deployments/${promptId}`)
        .set(authHeader())
        .send({ projectId, promptVersionId: v1Id, environment: 'production' })
        .expect(200);

      // 无变体：bucketKey 任意都走基线
      const baseline = await request(app.server)
        .get(`/api/v2/runtime/prompts/ab-agent?projectId=${projectId}&environment=production&bucketKey=user-1`)
        .set(authHeader())
        .expect(200);
      expect(baseline.body.promptVersionId).toBe(v1Id);
      expect(baseline.body.variantKey).toBeNull();

      // 配置 B 变体 100% 权重指向 v2
      await request(app.server)
        .put(`/api/v2/prompt-ab-variants/${promptId}/B`)
        .set(authHeader())
        .send({ projectId, environment: 'production', promptVersionId: v2Id, weight: 100 })
        .expect(200);

      const variantList = await request(app.server)
        .get(`/api/v2/prompt-ab-variants/${promptId}?projectId=${projectId}&environment=production`)
        .set(authHeader())
        .expect(200);
      expect(variantList.body.variants).toHaveLength(1);
      expect(variantList.body.variants[0].variant_key).toBe('B');

      // 100% 权重：任意 bucketKey 命中 B（v2）
      const onB = await request(app.server)
        .get(`/api/v2/runtime/prompts/ab-agent?projectId=${projectId}&environment=production&bucketKey=user-7`)
        .set(authHeader())
        .expect(200);
      expect(onB.body.promptVersionId).toBe(v2Id);
      expect(onB.body.variantKey).toBe('B');
      expect(onB.body.content).toContain('candidate v2');
      expect(typeof onB.body.bucket).toBe('number');

      // 权重降为 0 → 回到基线
      await request(app.server)
        .put(`/api/v2/prompt-ab-variants/${promptId}/B`)
        .set(authHeader())
        .send({ projectId, environment: 'production', promptVersionId: v2Id, weight: 0 })
        .expect(200);
      const backToBaseline = await request(app.server)
        .get(`/api/v2/runtime/prompts/ab-agent?projectId=${projectId}&environment=production&bucketKey=user-7`)
        .set(authHeader())
        .expect(200);
      expect(backToBaseline.body.promptVersionId).toBe(v1Id);

      // 删除变体
      await request(app.server)
        .delete(`/api/v2/prompt-ab-variants/${promptId}/B?projectId=${projectId}&environment=production`)
        .set(authHeader())
        .expect(204);
    });

    it('A/B 效果分析接口按基线与变体聚合真实 Trace 指标', async () => {
      const prompt = await request(app.server)
        .post('/api/prompts')
        .set(authHeader())
        .send({ project_id: projectId, name: `ab-analytics-${Date.now()}`, description: 'ab analytics', content: 'base analytics v1' })
        .expect(201);
      const promptId = prompt.body.id;

      const versionsRes = await request(app.server)
        .get(`/api/prompts/${promptId}/versions`)
        .set(authHeader())
        .expect(200);
      const v1Id = versionsRes.body[0].id;

      const v2 = await request(app.server)
        .post(`/api/prompts/${promptId}/versions`)
        .set(authHeader())
        .send({ content: 'candidate analytics v2', description: 'analytics B' })
        .expect(201);
      const v2Id = v2.body.version.id;

      await request(app.server)
        .put(`/api/v2/prompt-deployments/${promptId}`)
        .set(authHeader())
        .send({ projectId, promptVersionId: v1Id, environment: 'production' })
        .expect(200);

      await request(app.server)
        .put(`/api/v2/prompt-ab-variants/${promptId}/B`)
        .set(authHeader())
        .send({ projectId, environment: 'production', promptVersionId: v2Id, weight: 40 })
        .expect(200);

      const { createTrace, addTraceEvalResult } = await import('../src/services/trace.js');

      const baselineTrace1 = await createTrace({
        projectId,
        traceType: 'llm',
        name: 'baseline-1',
        promptId,
        promptVersionId: v1Id,
        startedAt: new Date(Date.now() - 60 * 60 * 1000),
        endedAt: new Date(Date.now() - 60 * 60 * 1000 + 120),
        latencyMs: 120,
        status: 'success',
      });
      await addTraceEvalResult(baselineTrace1.id, 'judge', 0.9, true);

      const baselineTrace2 = await createTrace({
        projectId,
        traceType: 'llm',
        name: 'baseline-2',
        promptId,
        promptVersionId: v1Id,
        startedAt: new Date(Date.now() - 30 * 60 * 1000),
        endedAt: new Date(Date.now() - 30 * 60 * 1000 + 80),
        latencyMs: 80,
        status: 'error',
        error: 'baseline error',
      });

      const variantTrace = await createTrace({
        projectId,
        traceType: 'llm',
        name: 'variant-1',
        promptId,
        promptVersionId: v2Id,
        metadata: { promptRuntime: { variantKey: 'B', bucket: 7 } },
        startedAt: new Date(Date.now() - 20 * 60 * 1000),
        endedAt: new Date(Date.now() - 20 * 60 * 1000 + 60),
        latencyMs: 60,
        status: 'success',
      });
      await addTraceEvalResult(variantTrace.id, 'judge', 0.6, false);

      const analytics = await request(app.server)
        .get(`/api/v2/prompt-ab-analytics/${promptId}?projectId=${projectId}&environment=production&days=14`)
        .set(authHeader())
        .expect(200);

      expect(analytics.body.report.promptId).toBe(promptId);
      expect(analytics.body.report.totalSamples).toBe(3);
      expect(analytics.body.report.variants).toHaveLength(2);

      const baseline = analytics.body.report.variants.find((item: { variantKey: string | null }) => item.variantKey === null);
      const variantB = analytics.body.report.variants.find((item: { variantKey: string | null }) => item.variantKey === 'B');

      expect(baseline).toBeTruthy();
      expect(baseline.sampleCount).toBe(2);
      expect(baseline.successRate).toBe(50);
      expect(baseline.evalPassRate).toBe(100);

      expect(variantB).toBeTruthy();
      expect(variantB.sampleCount).toBe(1);
      expect(variantB.successRate).toBe(100);
      expect(variantB.evalPassRate).toBe(0);
      expect(variantB.avgEvalScore).toBe(0.6);
      expect(variantB.configuredWeight).toBe(40);

      expect(Array.isArray(analytics.body.report.timeline)).toBe(true);
      expect(analytics.body.report.timeline.length).toBeGreaterThan(0);
    });
  });
});
