import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';

describe('PR-07：DatasetVersionItem 与 Evaluator Suite API', () => {
  let app: FastifyInstance;
  let authToken: string;
  let projectId: string;
  let evaluatorVersionA: string;
  let evaluatorVersionB: string;
  let datasetId: string;
  let datasetVersionId: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const email = `pr07-${Date.now()}@example.com`;
    const register = await request(app.server)
      .post('/api/auth/register')
      .send({ email, password: 'Test12345678!', name: 'PR07 User' })
      .expect(201);
    authToken = register.body.token;

    const project = await request(app.server)
      .post('/api/projects')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'PR07 Project' })
      .expect(201);
    projectId = project.body.id;

    // 创建两个评估器；update 会自动提交不可变版本
    const evalA = await request(app.server)
      .post('/api/evaluation/evaluators')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        project_id: projectId,
        name: 'Accuracy Evaluator',
        type: 'exact_match',
        config: { case_sensitive: false },
      })
      .expect(201);
    const evalB = await request(app.server)
      .post('/api/evaluation/evaluators')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        project_id: projectId,
        name: 'Style Evaluator',
        type: 'contains',
        config: { keyword: '退款' },
      })
      .expect(201);

    // 触发版本提交
    await request(app.server)
      .put(`/api/evaluation/evaluators/${evalA.body.id}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'Accuracy Evaluator' })
      .expect(200);
    await request(app.server)
      .put(`/api/evaluation/evaluators/${evalB.body.id}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'Style Evaluator' })
      .expect(200);

    const [vA, vB] = await Promise.all([
      request(app.server)
        .get(`/api/evaluation/evaluators/${evalA.body.id}/versions`)
        .set('Authorization', `Bearer ${authToken}`),
      request(app.server)
        .get(`/api/evaluation/evaluators/${evalB.body.id}/versions`)
        .set('Authorization', `Bearer ${authToken}`),
    ]);
    evaluatorVersionA = vA.body.versions[0].id;
    evaluatorVersionB = vB.body.versions[0].id;

    // 创建数据集 + 两条 item + 提交版本（commitDatasetVersion 会同步写 dataset_version_items）
    const ds = await request(app.server)
      .post('/api/evaluation/datasets')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ project_id: projectId, name: 'PR07 Dataset' })
      .expect(201);
    datasetId = ds.body.id;

    await request(app.server)
      .post(`/api/evaluation/datasets/${datasetId}/items`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        items: [
          { input: '如何退款', expected_output: '点击订单退款' },
          { input: '如何开发票', expected_output: '在个人中心申请' },
        ],
      })
      .expect(201);

    const version = await request(app.server)
      .post(`/api/evaluation/datasets/${datasetId}/versions`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ description: 'v1' })
      .expect(201);
    datasetVersionId = version.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('DatasetVersionItem 按 ordinal 返回，caseKey/contentHash/input/expected 完整', async () => {
    const response = await request(app.server)
      .get(`/api/v2/evaluation/dataset-versions/${datasetVersionId}/items`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(response.body.items).toHaveLength(2);
    const [first, second] = response.body.items;
    expect(first.ordinal).toBe(0);
    expect(second.ordinal).toBe(1);
    expect(first.case_key).toBeTruthy();
    expect(first.content_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.input_data).toHaveProperty('query');
    expect(first.expected_data).toHaveProperty('answer');
  });

  it('按 caseKey 读取单条快照；未知 caseKey 返回 404', async () => {
    const list = await request(app.server)
      .get(`/api/v2/evaluation/dataset-versions/${datasetVersionId}/items`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    const caseKey = list.body.items[0].case_key;

    const one = await request(app.server)
      .get(`/api/v2/evaluation/dataset-versions/${datasetVersionId}/items/${encodeURIComponent(caseKey)}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    expect(one.body.item.case_key).toBe(caseKey);

    await request(app.server)
      .get(`/api/v2/evaluation/dataset-versions/${datasetVersionId}/items/does-not-exist`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(404);
  });

  it('创建 EvaluatorSuite 自动生成 v1 与成员，current_version_id 指向 v1', async () => {
    const response = await request(app.server)
      .post('/api/v2/evaluation/suites')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        projectId,
        name: 'Refund Suite',
        description: '退款回归套件',
        members: [
          { evaluatorVersionId: evaluatorVersionA, alias: 'accuracy', weight: 2, required: true },
          { evaluatorVersionId: evaluatorVersionB, alias: 'style', weight: 1, required: false },
        ],
        aggregationConfig: { strategy: 'weighted_avg', passThreshold: 0.7 },
      })
      .expect(201);

    expect(response.body.suite.current_version_id).toBe(response.body.version.id);
    expect(response.body.version.version_number).toBe(1);
    expect(response.body.version.aggregation_config.strategy).toBe('weighted_avg');
    expect(response.body.members).toHaveLength(2);
    expect(response.body.members[0].alias).toBe('accuracy');
    expect(response.body.members[0].weight).toBe(2);
  });

  it('Suite 成员 alias 重复被拒绝', async () => {
    await request(app.server)
      .post('/api/v2/evaluation/suites')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        projectId,
        name: 'Duplicate Suite',
        members: [
          { evaluatorVersionId: evaluatorVersionA, alias: 'dup' },
          { evaluatorVersionId: evaluatorVersionB, alias: 'dup' },
        ],
      })
      .expect(400);
  });

  it('为已有 Suite 创建新版本后版本号递增，历史版本成员不可变', async () => {
    const created = await request(app.server)
      .post('/api/v2/evaluation/suites')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        projectId,
        name: `Versioned Suite ${Date.now()}`,
        members: [{ evaluatorVersionId: evaluatorVersionA, alias: 'accuracy' }],
      })
      .expect(201);
    const suiteId = created.body.suite.id;
    const v1Id = created.body.version.id;

    const v2 = await request(app.server)
      .post(`/api/v2/evaluation/suites/${suiteId}/versions`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        description: 'v2 增加 style',
        members: [
          { evaluatorVersionId: evaluatorVersionA, alias: 'accuracy' },
          { evaluatorVersionId: evaluatorVersionB, alias: 'style' },
        ],
      })
      .expect(201);
    expect(v2.body.version.version_number).toBe(2);
    expect(v2.body.suite.current_version_id).toBe(v2.body.version.id);
    expect(v2.body.suite.current_version_id).not.toBe(v1Id);
    expect(v2.body.members).toHaveLength(2);

    const v1Members = await request(app.server)
      .get(`/api/v2/evaluation/suite-versions/${v1Id}/members`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    expect(v1Members.body.members).toHaveLength(1);
  });

  it('引用不存在的 evaluatorVersionId 创建 Suite 被拒绝', async () => {
    await request(app.server)
      .post('/api/v2/evaluation/suites')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        projectId,
        name: 'Bad Suite',
        members: [{ evaluatorVersionId: '00000000-0000-0000-0000-000000000000', alias: 'ghost' }],
      })
      .expect(400);
  });

  it('其他用户无法访问本项目 Suite', async () => {
    const other = await request(app.server)
      .post('/api/auth/register')
      .send({ email: `pr07-other-${Date.now()}@example.com`, password: 'Test12345678!', name: 'Other' })
      .expect(201);

    const list = await request(app.server)
      .get('/api/v2/evaluation/suites')
      .set('Authorization', `Bearer ${other.body.token}`)
      .query({ projectId })
      .expect(404);
    expect(list.body.error).toBeTruthy();
  });

  it('DatasetVersion diff 按 caseKey 分类 added/removed/changed/unchanged', async () => {
    // 修改 dataset item 并提交 v2
    const list = await request(app.server)
      .get(`/api/evaluation/datasets/${datasetId}/items`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    const items = list.body as Array<{ id: string }>;
    expect(items.length).toBeGreaterThan(0);
    await request(app.server)
      .put(`/api/evaluation/datasets/items/${items[0].id}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ input: '如何退款到银行卡', expected_output: '点击订单退款到银行卡' })
      .expect(200);
    await request(app.server)
      .post(`/api/evaluation/datasets/${datasetId}/items`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        items: [{ input: '如何注销账户', expected_output: '设置-账户-注销' }],
      })
      .expect(201);

    const v2 = await request(app.server)
      .post(`/api/evaluation/datasets/${datasetId}/versions`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ description: 'v2' })
      .expect(201);

    const diff = await request(app.server)
      .get(`/api/v2/evaluation/datasets/${datasetId}/versions/diff`)
      .query({ baselineVersionId: datasetVersionId, candidateVersionId: v2.body.id })
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(diff.body.added.length).toBeGreaterThanOrEqual(1);
    expect(diff.body.changed.length).toBeGreaterThanOrEqual(1);
    expect(diff.body.unchanged.length).toBeGreaterThanOrEqual(1);
  });
});
