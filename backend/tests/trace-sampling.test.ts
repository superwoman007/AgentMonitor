import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';

describe('PR-13b：Trace Sampling 线上 Trace 采样回流', () => {
  let app: FastifyInstance;
  let authToken: string;
  let apiKey: string;
  let projectId: string;
  let datasetId: string;
  const auth = (): Record<string, string> => ({ Authorization: `Bearer ${authToken}` });

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const email = `pr13b-${Date.now()}@example.com`;
    const register = await request(app.server)
      .post('/api/auth/register')
      .send({ email, password: 'Test12345678!', name: 'PR13b' })
      .expect(201);
    authToken = register.body.token;

    const project = await request(app.server)
      .post('/api/projects')
      .set(auth())
      .send({ name: 'PR13b Project' })
      .expect(201);
    projectId = project.body.id;

    const key = await request(app.server)
      .post('/api/apikeys')
      .set(auth())
      .send({ project_id: projectId, name: 'PR13b Key' })
      .expect(201);
    apiKey = key.body.key;

    const ds = await request(app.server)
      .post('/api/evaluation/datasets')
      .set(auth())
      .send({ project_id: projectId, name: 'PR13b 回流集' })
      .expect(201);
    datasetId = ds.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  /**
   * 通过 V1 上报接口写入一条 Trace。
   * @param name - Trace 名称
   * @param overrides - 覆盖字段
   */
  async function ingestTrace(
    name: string,
    overrides: { traceType?: string; status?: string; error?: string } = {}
  ): Promise<string> {
    const res = await request(app.server)
      .post('/api/traces')
      .set('X-API-Key', apiKey)
      .send({
        traceType: overrides.traceType ?? 'llm',
        name,
        input: { content: `问题：${name}` },
        output: { content: `回答：${name}` },
        status: overrides.status ?? 'success',
        error: overrides.error,
      })
      .expect(201);
    return res.body.trace.id;
  }

  /**
   * 读取 Dataset 当前样本数。
   */
  async function datasetItemCount(): Promise<number> {
    const res = await request(app.server)
      .get(`/api/evaluation/datasets/${datasetId}`)
      .set(auth());
    return res.body.item_count ?? res.body.itemCount ?? 0;
  }

  it('POST /sampling-rules 创建规则并校验 sampleRate 非法值', async () => {
    const ok = await request(app.server)
      .post('/api/v2/evaluation/sampling-rules')
      .set(auth())
      .send({
        projectId,
        name: '全量回流 llm',
        targetDatasetId: datasetId,
        traceTypeFilter: 'llm',
        sampleRate: 1,
      })
      .expect(201);
    expect(ok.body.rule.id).toBeTruthy();
    expect(ok.body.rule.enabled).toBe(true);
    expect(ok.body.rule.sampled_count).toBe(0);

    await request(app.server)
      .post('/api/v2/evaluation/sampling-rules')
      .set(auth())
      .send({
        projectId,
        name: '非法采样率',
        targetDatasetId: datasetId,
        sampleRate: 1.5,
      })
      .expect(400);

    // 不存在的数据集：外键/归属校验失败返回 4xx
    await request(app.server)
      .post('/api/v2/evaluation/sampling-rules')
      .set(auth())
      .send({
        projectId,
        name: '不存在的数据集',
        targetDatasetId: '00000000-0000-0000-0000-000000000000',
      })
      .expect((res) => {
        if (res.status !== 400 && res.status !== 404) {
          throw new Error(`expected 400/404, got ${res.status}`);
        }
      });
  });

  it('run-now：trace_type/name/status/error 过滤命中并回流到 Dataset，且幂等不重复', async () => {
    await ingestTrace('客服-退款咨询');
    await ingestTrace('客服-物流咨询');
    await ingestTrace('内部健康检查', { traceType: 'system' });
    await ingestTrace('客服-失败案例', { status: 'error', error: 'LLM timeout' });

    const rule = await request(app.server)
      .post('/api/v2/evaluation/sampling-rules')
      .set(auth())
      .send({
        projectId,
        name: '客服 llm 回流',
        targetDatasetId: datasetId,
        traceTypeFilter: 'llm',
        nameContains: '客服',
        sampleRate: 1,
      })
      .expect(201);
    const ruleId = rule.body.rule.id;

    const first = await request(app.server)
      .post(`/api/v2/evaluation/sampling-rules/${ruleId}/run-now?projectId=${projectId}`)
      .set(auth())
      .expect(201);
    // 命中 3 条客服 llm（退款、物流、失败案例）；system 类型与不含"客服"的被过滤
    expect(first.body.matched).toBe(3);
    expect(first.body.sampled).toBe(3);

    const countAfterFirst = await datasetItemCount();
    expect(countAfterFirst).toBeGreaterThanOrEqual(3);

    // 第二轮扫描：台账去重，不再回流
    const second = await request(app.server)
      .post(`/api/v2/evaluation/sampling-rules/${ruleId}/run-now?projectId=${projectId}`)
      .set(auth())
      .expect(201);
    expect(second.body.matched).toBe(0);
    expect(second.body.sampled).toBe(0);
    expect(await datasetItemCount()).toBe(countAfterFirst);
  });

  it('errorOnly=true 只回流错误 Trace', async () => {
    const rule = await request(app.server)
      .post('/api/v2/evaluation/sampling-rules')
      .set(auth())
      .send({
        projectId,
        name: '仅错误样本',
        targetDatasetId: datasetId,
        errorOnly: true,
        sampleRate: 1,
      })
      .expect(201);
    const ruleId = rule.body.rule.id;

    const res = await request(app.server)
      .post(`/api/v2/evaluation/sampling-rules/${ruleId}/run-now?projectId=${projectId}`)
      .set(auth())
      .expect(201);
    // 只有前面写入的"客服-失败案例"一条 error Trace
    expect(res.body.sampled).toBe(1);
  });

  it('maxItemsTotal 达到上限后停止回流', async () => {
    const rule = await request(app.server)
      .post('/api/v2/evaluation/sampling-rules')
      .set(auth())
      .send({
        projectId,
        name: '限量回流',
        targetDatasetId: datasetId,
        traceTypeFilter: 'llm',
        sampleRate: 1,
        maxItemsTotal: 2,
      })
      .expect(201);
    const ruleId = rule.body.rule.id;

    const res = await request(app.server)
      .post(`/api/v2/evaluation/sampling-rules/${ruleId}/run-now?projectId=${projectId}`)
      .set(auth())
      .expect(201);
    // 新规则对全部 llm Trace 命中，但上限 2 条
    expect(res.body.matched).toBeGreaterThanOrEqual(3);
    expect(res.body.sampled).toBe(2);

    const detail = await request(app.server)
      .get(`/api/v2/evaluation/sampling-rules/${ruleId}?projectId=${projectId}`)
      .set(auth())
      .expect(200);
    expect(detail.body.rule.sampled_count).toBe(2);
    expect(detail.body.rule.last_scanned_at).toBeTruthy();
  });

  it('PATCH 可禁用规则，禁用后 run-now 不回流；DELETE 后 404', async () => {
    const rule = await request(app.server)
      .post('/api/v2/evaluation/sampling-rules')
      .set(auth())
      .send({
        projectId,
        name: '待停用',
        targetDatasetId: datasetId,
        sampleRate: 1,
      })
      .expect(201);
    const ruleId = rule.body.rule.id;

    const patched = await request(app.server)
      .patch(`/api/v2/evaluation/sampling-rules/${ruleId}`)
      .set(auth())
      .send({ projectId, enabled: false })
      .expect(200);
    expect(patched.body.rule.enabled).toBe(false);

    const res = await request(app.server)
      .post(`/api/v2/evaluation/sampling-rules/${ruleId}/run-now?projectId=${projectId}`)
      .set(auth())
      .expect(201);
    expect(res.body.sampled).toBe(0);

    const list = await request(app.server)
      .get(`/api/v2/evaluation/sampling-rules?projectId=${projectId}`)
      .set(auth())
      .expect(200);
    expect(list.body.rules.length).toBeGreaterThanOrEqual(4);

    await request(app.server)
      .delete(`/api/v2/evaluation/sampling-rules/${ruleId}?projectId=${projectId}`)
      .set(auth())
      .expect(204);
    await request(app.server)
      .get(`/api/v2/evaluation/sampling-rules/${ruleId}?projectId=${projectId}`)
      .set(auth())
      .expect(404);
  });

  it('非项目所有者访问返回 404', async () => {
    const other = await request(app.server)
      .post('/api/auth/register')
      .send({
        email: `pr13b-other-${Date.now()}@example.com`,
        password: 'Test12345678!',
        name: 'PR13b Other',
      })
      .expect(201);
    await request(app.server)
      .get(`/api/v2/evaluation/sampling-rules?projectId=${projectId}`)
      .set({ Authorization: `Bearer ${other.body.token}` })
      .expect(404);
  });
});
