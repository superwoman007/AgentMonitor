import request from 'supertest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';

describe('Trace Dataset Reflow API', () => {
  let app: FastifyInstance;
  let authToken: string;
  let projectId: string;
  let apiKey: string;
  let traceId: string;
  let datasetId: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const testEmail = `test-reflow-${Date.now()}@example.com`;
    const registerResponse = await request(app.server)
      .post('/api/auth/register')
      .send({
        email: testEmail,
        password: 'Test123456!',
        name: 'Reflow Test User'
      });

    authToken = registerResponse.body.token;

    const projectResponse = await request(app.server)
      .post('/api/projects')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'Reflow Test Project' });

    projectId = projectResponse.body.id;

    const keyResponse = await request(app.server)
      .post('/api/apikeys')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ project_id: projectId, name: 'Reflow Test Key' });

    apiKey = keyResponse.body.key;

    // Create a trace
    const traceRes = await request(app.server)
      .post('/api/traces')
      .set('X-API-Key', apiKey)
      .send({
        traceType: 'llm',
        name: 'test-completion',
        input: { prompt: 'What is the capital of France?' },
        output: { content: 'The capital of France is Paris.' },
        status: 'success',
      })
      .expect(201);

    traceId = traceRes.body.trace.id;

    // Create a dataset
    const datasetRes = await request(app.server)
      .post('/api/evaluation/datasets')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        project_id: projectId,
        name: 'Test Dataset',
        description: 'For reflow testing',
        type: 'custom',
      })
      .expect(201);

    datasetId = datasetRes.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/traces/:id/add-to-dataset', () => {
    it('应该将单条 trace 沉淀到已有 dataset', async () => {
      const response = await request(app.server)
        .post(`/api/traces/${traceId}/add-to-dataset`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          datasetId,
          expectedOutput: 'Paris',
        })
        .expect(201);

      expect(response.body).toHaveProperty('item');
      expect(response.body.item.input).toContain('capital of France');
      expect(response.body.item.expected_output).toBe('Paris');
      expect(response.body).toHaveProperty('dataset');
      expect(response.body.dataset.item_count).toBeGreaterThan(0);
    });

    it('应该支持自动创建新 dataset', async () => {
      const response = await request(app.server)
        .post(`/api/traces/${traceId}/add-to-dataset`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          datasetName: 'Auto Created Dataset',
          expectedOutput: 'Paris',
        })
        .expect(201);

      expect(response.body).toHaveProperty('item');
      expect(response.body).toHaveProperty('dataset');
      expect(response.body.dataset.name).toBe('Auto Created Dataset');
    });

    it('应该拒绝未授权请求', async () => {
      await request(app.server)
        .post(`/api/traces/${traceId}/add-to-dataset`)
        .send({ datasetId })
        .expect(401);
    });

    it('应该拒绝访问不存在的 trace', async () => {
      await request(app.server)
        .post('/api/traces/nonexistent/add-to-dataset')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ datasetId })
        .expect(404);
    });

    it('应该拒绝没有 datasetId 且没有 datasetName 的请求', async () => {
      await request(app.server)
        .post(`/api/traces/${traceId}/add-to-dataset`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({})
        .expect(400);
    });
  });

  describe('POST /api/traces/bulk-export-dataset', () => {
    it('应该批量沉淀 traces 到新 dataset', async () => {
      // Create multiple traces
      const traces = [];
      for (let i = 0; i < 3; i++) {
        const res = await request(app.server)
          .post('/api/traces')
          .set('X-API-Key', apiKey)
          .send({
            traceType: 'llm',
            name: `bulk-trace-${i}`,
            input: { prompt: `Question ${i}` },
            output: { content: `Answer ${i}` },
            status: i === 2 ? 'error' : 'success',
            error: i === 2 ? 'timeout' : undefined,
          })
          .expect(201);
        traces.push(res.body.trace.id);
      }

      const response = await request(app.server)
        .post('/api/traces/bulk-export-dataset')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          projectId,
          traceIds: traces,
          datasetName: 'Bulk Export Dataset',
        })
        .expect(201);

      expect(response.body.imported).toBe(3);
      expect(response.body).toHaveProperty('dataset');
      expect(response.body.dataset.name).toBe('Bulk Export Dataset');
      expect(response.body.dataset.item_count).toBe(3);
    });

    it('应该支持按条件筛选后批量沉淀', async () => {
      const response = await request(app.server)
        .post('/api/traces/bulk-export-dataset')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          projectId,
          filters: { status: 'error' },
          datasetName: 'Error Cases Dataset',
        })
        .expect(201);

      expect(response.body).toHaveProperty('dataset');
      expect(response.body.dataset.name).toBe('Error Cases Dataset');
    });

    it('应该拒绝未授权请求', async () => {
      await request(app.server)
        .post('/api/traces/bulk-export-dataset')
        .send({ projectId, traceIds: [], datasetName: 'Test' })
        .expect(401);
    });

    it('应该拒绝访问其他项目的 trace', async () => {
      // Create another user and project
      const otherEmail = `other-${Date.now()}@example.com`;
      const otherRegister = await request(app.server)
        .post('/api/auth/register')
        .send({ email: otherEmail, password: 'Test123456!', name: 'Other' });
      const otherToken = otherRegister.body.token;

      const otherProject = await request(app.server)
        .post('/api/projects')
        .set('Authorization', `Bearer ${otherToken}`)
        .send({ name: 'Other Project' });

      // Other user tries to export our trace into their project - should not find the trace
      await request(app.server)
        .post('/api/traces/bulk-export-dataset')
        .set('Authorization', `Bearer ${otherToken}`)
        .send({
          projectId: otherProject.body.id,
          traceIds: [traceId],
          datasetName: 'Test',
        })
        .expect(404);
    });
  });
});
