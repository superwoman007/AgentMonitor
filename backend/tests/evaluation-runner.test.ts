import request from 'supertest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

describe('Evaluation Runner (EV-01)', () => {
  let app: FastifyInstance;
  let authToken: string;
  let projectId: string;
  let datasetId: string;
  let evaluatorId: string;
  let experimentId: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    // 注册测试用户
    const testEmail = `test-runner-${Date.now()}@example.com`;
    const registerResponse = await request(app.server)
      .post('/api/auth/register')
      .send({ email: testEmail, password: 'Test123456!', name: 'Runner Test User' });
    authToken = registerResponse.body.token;

    // 创建项目
    const projectResponse = await request(app.server)
      .post('/api/projects')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'Runner Test Project' });
    projectId = projectResponse.body.id;

    // 创建数据集（含 3 条数据）
    const datasetResponse = await request(app.server)
      .post('/api/evaluation/datasets')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ project_id: projectId, name: 'Runner Dataset', type: 'qa' })
      .expect(201);
    datasetId = datasetResponse.body.id;

    await request(app.server)
      .post(`/api/evaluation/datasets/${datasetId}/items`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        items: [
          { input: 'What is 2+2?', expected_output: '4' },
          { input: 'What is 3+3?', expected_output: '6' },
          { input: 'What is 5+5?', expected_output: '10' },
        ],
      })
      .expect(201);

    // 创建评估器
    const evaluatorResponse = await request(app.server)
      .post('/api/evaluation/evaluators')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        project_id: projectId,
        name: 'Exact Match Runner',
        type: 'exact_match',
        config: { case_sensitive: false },
      })
      .expect(201);
    evaluatorId = evaluatorResponse.body.id;

    // 创建实验
    const experimentResponse = await request(app.server)
      .post('/api/evaluation/experiments')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        project_id: projectId,
        name: 'Auto Run Experiment',
        dataset_id: datasetId,
        model_config: { model: 'gpt-4' },
      })
      .expect(201);
    experimentId = experimentResponse.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/evaluation/experiments/:id/start (with auto-run)', () => {
    it('启动实验后应自动生成评测结果', async () => {
      // 绑定评估器到实验（通过创建结果时的 evaluator_id）
      // 实际执行引擎会在 start 时自动使用项目中的评估器
      const startResponse = await request(app.server)
        .post(`/api/evaluation/experiments/${experimentId}/start`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(startResponse.body.status).toBe('completed');
    });

    it('实验完成后应生成与数据集条目数相同的结果数', async () => {
      const resultsResponse = await request(app.server)
        .get(`/api/evaluation/experiments/${experimentId}/results`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(Array.isArray(resultsResponse.body)).toBe(true);
      expect(resultsResponse.body.length).toBe(3);
    });

    it('每条结果应包含评分和通过状态', async () => {
      const resultsResponse = await request(app.server)
        .get(`/api/evaluation/experiments/${experimentId}/results`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      resultsResponse.body.forEach((result: any) => {
        expect(result).toHaveProperty('score');
        expect(typeof result.score).toBe('number');
        expect(result).toHaveProperty('passed');
        expect([0, 1]).toContain(result.passed);
        expect(result).toHaveProperty('dataset_item_id');
        expect(result).toHaveProperty('output');
        expect(result).toHaveProperty('latency_ms');
      });
    });

    it('实验报告应反映正确统计', async () => {
      const reportResponse = await request(app.server)
        .get(`/api/evaluation/experiments/${experimentId}/report`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(reportResponse.body.totalItems).toBe(3);
      expect(reportResponse.body.passedCount + reportResponse.body.failedCount).toBe(3);
      expect(reportResponse.body.passRate).toBeGreaterThanOrEqual(0);
      expect(reportResponse.body.passRate).toBeLessThanOrEqual(100);
    });

    it('进度查询应显示 100% 完成', async () => {
      const progressResponse = await request(app.server)
        .get(`/api/evaluation/experiments/${experimentId}/progress`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(progressResponse.body.total_items).toBe(3);
      expect(progressResponse.body.completed_items).toBe(3);
      expect(progressResponse.body.completion_rate).toBe(100);
      expect(progressResponse.body.status).toBe('completed');
    });
  });

  describe('评估器类型兼容性', () => {
    it('contains 评估器应正确评分', async () => {
      // 创建 contains 评估器
      const containsEvalRes = await request(app.server)
        .post('/api/evaluation/evaluators')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          project_id: projectId,
          name: 'Contains Eval',
          type: 'contains',
          config: { keywords: ['answer'] },
        })
        .expect(201);

      // 创建新实验
      const expRes = await request(app.server)
        .post('/api/evaluation/experiments')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          project_id: projectId,
          name: 'Contains Test',
          dataset_id: datasetId,
        })
        .expect(201);

      await request(app.server)
        .post(`/api/evaluation/experiments/${expRes.body.id}/start`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      const resultsRes = await request(app.server)
        .get(`/api/evaluation/experiments/${expRes.body.id}/results`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(resultsRes.body.length).toBe(3);
    });

    it('空数据集实验应直接完成且结果为空', async () => {
      const emptyDatasetRes = await request(app.server)
        .post('/api/evaluation/datasets')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ project_id: projectId, name: 'Empty Dataset' })
        .expect(201);

      const emptyExpRes = await request(app.server)
        .post('/api/evaluation/experiments')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          project_id: projectId,
          name: 'Empty Experiment',
          dataset_id: emptyDatasetRes.body.id,
        })
        .expect(201);

      await request(app.server)
        .post(`/api/evaluation/experiments/${emptyExpRes.body.id}/start`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      const resultsRes = await request(app.server)
        .get(`/api/evaluation/experiments/${emptyExpRes.body.id}/results`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(resultsRes.body.length).toBe(0);
    });
  });
});
