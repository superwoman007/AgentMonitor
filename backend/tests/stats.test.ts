import request from 'supertest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';

describe('Stats API', () => {
  let app: FastifyInstance;
  let apiKey: string;
  let projectId: string;
  let authToken: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const testEmail = `test-stats-${Date.now()}@example.com`;
    const registerResponse = await request(app.server)
      .post('/api/auth/register')
      .send({
        email: testEmail,
        password: 'Test123456!',
        name: 'Stats Test User',
      });

    authToken = registerResponse.body.token;

    const projectResponse = await request(app.server)
      .post('/api/projects')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'Stats Test Project' });

    projectId = projectResponse.body.id;

    const keyResponse = await request(app.server)
      .post('/api/apikeys')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ project_id: projectId, name: 'Stats Test Key' });

    apiKey = keyResponse.body.key;

    // Seed some traces for stats
    await request(app.server)
      .post('/api/traces')
      .set('X-API-Key', apiKey)
      .send({
        traceType: 'llm',
        name: 'stats-trace-1',
        input: { prompt: 'hello' },
        output: { content: 'world' },
        status: 'success',
        latencyMs: 150,
      });

    await request(app.server)
      .post('/api/traces')
      .set('X-API-Key', apiKey)
      .send({
        traceType: 'llm',
        name: 'stats-trace-2',
        status: 'error',
        latencyMs: 500,
      });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /api/stats', () => {
    it('应该返回项目级别统计', async () => {
      const response = await request(app.server)
        .get('/api/stats')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ projectId })
        .expect(200);

      expect(response.body).toHaveProperty('stats');
    });

    it('应该返回用户级别统计（无 projectId）', async () => {
      const response = await request(app.server)
        .get('/api/stats')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('stats');
    });

    it('应该拒绝未认证请求', async () => {
      await request(app.server)
        .get('/api/stats')
        .query({ projectId })
        .expect(401);
    });

    it('应该拒绝访问不属于自己的项目', async () => {
      await request(app.server)
        .get('/api/stats')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ projectId: 'nonexistent-project-id' })
        .expect(404);
    });
  });

  describe('GET /api/stats/observation', () => {
    it('应该返回观测统计', async () => {
      const response = await request(app.server)
        .get('/api/stats/observation')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ project_id: projectId })
        .expect(200);

      expect(response.body).toBeDefined();
    });

    it('应该要求 project_id 参数', async () => {
      await request(app.server)
        .get('/api/stats/observation')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);
    });

    it('应该拒绝访问不属于自己的项目', async () => {
      await request(app.server)
        .get('/api/stats/observation')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ project_id: 'nonexistent-project-id' })
        .expect(404);
    });

    it('应该拒绝未认证请求', async () => {
      await request(app.server)
        .get('/api/stats/observation')
        .query({ project_id: projectId })
        .expect(401);
    });
  });

  describe('GET /api/stats/trend', () => {
    it('应该返回项目趋势数据', async () => {
      const response = await request(app.server)
        .get('/api/stats/trend')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ project_id: projectId, days: '7' })
        .expect(200);

      expect(response.body).toHaveProperty('trend');
      expect(Array.isArray(response.body.trend)).toBe(true);
      expect(response.body.trend.length).toBe(7);

      const first = response.body.trend[0];
      expect(first).toHaveProperty('date');
      expect(first).toHaveProperty('traceCount');
      expect(first).toHaveProperty('tokenCount');
      expect(first).toHaveProperty('successRate');
      expect(first).toHaveProperty('errorCount');
      expect(first).toHaveProperty('avgLatency');
    });

    it('应该要求 project_id 参数', async () => {
      await request(app.server)
        .get('/api/stats/trend')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);
    });

    it('应该拒绝访问不属于自己的项目', async () => {
      await request(app.server)
        .get('/api/stats/trend')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ project_id: 'nonexistent-project-id' })
        .expect(404);
    });
  });
});
