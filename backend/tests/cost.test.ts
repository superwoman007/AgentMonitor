import request from 'supertest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';

describe('Cost API', () => {
  let app: FastifyInstance;
  let apiKey: string;
  let projectId: string;
  let authToken: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const testEmail = `test-cost-${Date.now()}@example.com`;
    const registerResponse = await request(app.server)
      .post('/api/auth/register')
      .send({
        email: testEmail,
        password: 'Test12345678!',
        name: 'Cost Test User',
      });

    authToken = registerResponse.body.token;

    const projectResponse = await request(app.server)
      .post('/api/projects')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'Cost Test Project' });

    projectId = projectResponse.body.id;

    const keyResponse = await request(app.server)
      .post('/api/apikeys')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ project_id: projectId, name: 'Cost Test Key' });

    apiKey = keyResponse.body.key;

    // Seed traces with token usage metadata for cost calculation
    await request(app.server)
      .post('/api/traces')
      .set('X-API-Key', apiKey)
      .send({
        traceType: 'llm',
        name: 'cost-trace-1',
        status: 'success',
        metadata: {
          model: 'gpt-4',
          usage: {
            prompt_tokens: 100,
            completion_tokens: 50,
          },
        },
      });

    await request(app.server)
      .post('/api/traces')
      .set('X-API-Key', apiKey)
      .send({
        traceType: 'llm',
        name: 'cost-trace-2',
        status: 'success',
        metadata: {
          model: 'gpt-3.5-turbo',
          usage: {
            prompt_tokens: 200,
            completion_tokens: 100,
          },
        },
      });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /api/cost/summary', () => {
    it('应该返回成本摘要和趋势', async () => {
      const response = await request(app.server)
        .get('/api/cost/summary')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ projectId })
        .expect(200);

      expect(response.body).toHaveProperty('summary');
      expect(response.body).toHaveProperty('trend');
    });

    it('应该支持 days 参数', async () => {
      const response = await request(app.server)
        .get('/api/cost/summary')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ projectId, days: '30' })
        .expect(200);

      expect(response.body).toHaveProperty('summary');
      expect(response.body).toHaveProperty('trend');
    });

    it('应该拒绝未认证请求', async () => {
      await request(app.server)
        .get('/api/cost/summary')
        .query({ projectId })
        .expect(401);
    });

    it('应该拒绝访问不属于自己的项目', async () => {
      await request(app.server)
        .get('/api/cost/summary')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ projectId: 'nonexistent-project-id' })
        .expect(404);
    });
  });

  describe('GET /api/cost/by-model', () => {
    it('应该返回按模型分组的成本', async () => {
      const response = await request(app.server)
        .get('/api/cost/by-model')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ projectId })
        .expect(200);

      expect(response.body).toHaveProperty('byModel');
    });

    it('应该拒绝未认证请求', async () => {
      await request(app.server)
        .get('/api/cost/by-model')
        .query({ projectId })
        .expect(401);
    });

    it('应该拒绝访问不属于自己的项目', async () => {
      await request(app.server)
        .get('/api/cost/by-model')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ projectId: 'nonexistent-project-id' })
        .expect(404);
    });
  });

  describe('GET /api/cost/top', () => {
    it('应该返回最昂贵的调用', async () => {
      const response = await request(app.server)
        .get('/api/cost/top')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ projectId })
        .expect(200);

      expect(response.body).toHaveProperty('top');
    });

    it('应该支持 limit 参数', async () => {
      const response = await request(app.server)
        .get('/api/cost/top')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ projectId, limit: '5' })
        .expect(200);

      expect(response.body).toHaveProperty('top');
    });

    it('应该拒绝访问不属于自己的项目', async () => {
      await request(app.server)
        .get('/api/cost/top')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ projectId: 'nonexistent-project-id' })
        .expect(404);
    });
  });

  describe('GET /api/cost/suggestions', () => {
    it('应该返回成本优化建议', async () => {
      const response = await request(app.server)
        .get('/api/cost/suggestions')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ projectId })
        .expect(200);

      expect(response.body).toHaveProperty('suggestions');
    });

    it('应该拒绝未认证请求', async () => {
      await request(app.server)
        .get('/api/cost/suggestions')
        .query({ projectId })
        .expect(401);
    });

    it('应该拒绝访问不属于自己的项目', async () => {
      await request(app.server)
        .get('/api/cost/suggestions')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ projectId: 'nonexistent-project-id' })
        .expect(404);
    });
  });
});
