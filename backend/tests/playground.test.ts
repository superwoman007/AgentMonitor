import request from 'supertest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';

describe('Playground API', () => {
  let app: FastifyInstance;
  let projectId: string;
  let authToken: string;
  let runId: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const testEmail = `test-playground-${Date.now()}@example.com`;
    const registerResponse = await request(app.server)
      .post('/api/auth/register')
      .send({
        email: testEmail,
        password: 'Test123456!',
        name: 'Playground Test User',
      });

    authToken = registerResponse.body.token;

    const projectResponse = await request(app.server)
      .post('/api/projects')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'Playground Test Project' });

    projectId = projectResponse.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/playground/run', () => {
    it('应该成功创建运行记录', async () => {
      const response = await request(app.server)
        .post('/api/playground/run')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          project_id: projectId,
          model: 'gpt-4',
          input: 'What is the meaning of life?',
          output: '42',
          latency_ms: 350,
          status: 'success',
          metadata: { temperature: 0.7 },
        })
        .expect(201);

      expect(response.body).toHaveProperty('id');
      runId = response.body.id;
    });

    it('应该创建无 output 的运行记录', async () => {
      const response = await request(app.server)
        .post('/api/playground/run')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          project_id: projectId,
          model: 'gpt-3.5-turbo',
          input: 'Hello world',
        })
        .expect(201);

      expect(response.body).toHaveProperty('id');
    });

    it('应该要求 project_id', async () => {
      await request(app.server)
        .post('/api/playground/run')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          model: 'gpt-4',
          input: 'test',
        })
        .expect(400);
    });

    it('应该要求 model', async () => {
      await request(app.server)
        .post('/api/playground/run')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          project_id: projectId,
          input: 'test',
        })
        .expect(400);
    });

    it('应该要求 input', async () => {
      await request(app.server)
        .post('/api/playground/run')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          project_id: projectId,
          model: 'gpt-4',
        })
        .expect(400);
    });

    it('应该拒绝未认证请求', async () => {
      await request(app.server)
        .post('/api/playground/run')
        .send({
          project_id: projectId,
          model: 'gpt-4',
          input: 'test',
        })
        .expect(401);
    });
  });

  describe('GET /api/playground/runs', () => {
    it('应该返回运行记录列表', async () => {
      const response = await request(app.server)
        .get('/api/playground/runs')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ project_id: projectId })
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThanOrEqual(1);
    });

    it('应该要求 project_id', async () => {
      await request(app.server)
        .get('/api/playground/runs')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);
    });

    it('应该拒绝未认证请求', async () => {
      await request(app.server)
        .get('/api/playground/runs')
        .query({ project_id: projectId })
        .expect(401);
    });
  });

  describe('GET /api/playground/runs/:id', () => {
    it('应该返回运行记录详情', async () => {
      const response = await request(app.server)
        .get(`/api/playground/runs/${runId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('id', runId);
    });

    it('应该拒绝访问不存在的运行记录', async () => {
      await request(app.server)
        .get('/api/playground/runs/nonexistent-id')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });

    it('应该拒绝未认证请求', async () => {
      await request(app.server)
        .get(`/api/playground/runs/${runId}`)
        .expect(401);
    });
  });
});
