import request from 'supertest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';

describe('Quality API', () => {
  let app: FastifyInstance;
  let apiKey: string;
  let projectId: string;
  let authToken: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const testEmail = `test-quality-${Date.now()}@example.com`;
    const registerResponse = await request(app.server)
      .post('/api/auth/register')
      .send({
        email: testEmail,
        password: 'Test12345678!',
        name: 'Quality Test User',
      });

    authToken = registerResponse.body.token;

    const projectResponse = await request(app.server)
      .post('/api/projects')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'Quality Test Project' });

    projectId = projectResponse.body.id;

    const keyResponse = await request(app.server)
      .post('/api/apikeys')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ project_id: projectId, name: 'Quality Test Key' });

    apiKey = keyResponse.body.key;

    // Seed traces for quality scoring
    for (let i = 0; i < 5; i++) {
      await request(app.server)
        .post('/api/traces')
        .set('X-API-Key', apiKey)
        .send({
          traceType: 'llm',
          name: `quality-trace-${i}`,
          status: i < 4 ? 'success' : 'error',
          latencyMs: 100 + i * 50,
        });
    }
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /api/quality/score', () => {
    it('应该返回质量评分', async () => {
      const response = await request(app.server)
        .get('/api/quality/score')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ projectId })
        .expect(200);

      expect(response.body).toHaveProperty('score');
    });

    it('应该拒绝未认证请求', async () => {
      await request(app.server)
        .get('/api/quality/score')
        .query({ projectId })
        .expect(401);
    });

    it('应该拒绝访问不属于自己的项目', async () => {
      await request(app.server)
        .get('/api/quality/score')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ projectId: 'nonexistent-project-id' })
        .expect(404);
    });
  });

  describe('GET /api/quality/trend', () => {
    it('应该返回质量趋势', async () => {
      const response = await request(app.server)
        .get('/api/quality/trend')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ projectId })
        .expect(200);

      expect(response.body).toHaveProperty('trend');
    });

    it('应该支持 days 参数', async () => {
      const response = await request(app.server)
        .get('/api/quality/trend')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ projectId, days: '30' })
        .expect(200);

      expect(response.body).toHaveProperty('trend');
    });

    it('应该拒绝未认证请求', async () => {
      await request(app.server)
        .get('/api/quality/trend')
        .query({ projectId })
        .expect(401);
    });

    it('应该拒绝访问不属于自己的项目', async () => {
      await request(app.server)
        .get('/api/quality/trend')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ projectId: 'nonexistent-project-id' })
        .expect(404);
    });
  });
});
