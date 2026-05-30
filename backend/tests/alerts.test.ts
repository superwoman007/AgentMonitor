import request from 'supertest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';

describe('Alerts API', () => {
  let app: FastifyInstance;
  let apiKey: string;
  let projectId: string;
  let authToken: string;
  let alertId: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const testEmail = `test-alerts-${Date.now()}@example.com`;
    const registerResponse = await request(app.server)
      .post('/api/auth/register')
      .send({
        email: testEmail,
        password: 'Test12345678!',
        name: 'Alerts Test User',
      });

    authToken = registerResponse.body.token;

    const projectResponse = await request(app.server)
      .post('/api/projects')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'Alerts Test Project' });

    projectId = projectResponse.body.id;

    const keyResponse = await request(app.server)
      .post('/api/apikeys')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ project_id: projectId, name: 'Alerts Test Key' });

    apiKey = keyResponse.body.key;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/alerts', () => {
    it('应该成功创建告警规则', async () => {
      const response = await request(app.server)
        .post('/api/alerts')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          projectId,
          name: 'High Latency Alert',
          type: 'latency',
          condition: 'gt',
          threshold: 1000,
          enabled: true,
        })
        .expect(201);

      expect(response.body).toHaveProperty('alert');
      expect(response.body.alert.name).toBe('High Latency Alert');
      expect(response.body.alert.type).toBe('latency');
      expect(response.body.alert.threshold).toBe(1000);

      alertId = response.body.alert.id;
    });

    it('应该创建错误率告警', async () => {
      const response = await request(app.server)
        .post('/api/alerts')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          projectId,
          name: 'Error Rate Alert',
          type: 'error_rate',
          condition: 'gt',
          threshold: 0.1,
          enabled: true,
        })
        .expect(201);

      expect(response.body.alert.type).toBe('error_rate');
    });

    it('应该创建成本告警', async () => {
      const response = await request(app.server)
        .post('/api/alerts')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          projectId,
          name: 'Cost Alert',
          type: 'cost',
          condition: 'gt',
          threshold: 10,
        })
        .expect(201);

      expect(response.body.alert.type).toBe('cost');
    });

    it('应该拒绝未认证请求', async () => {
      await request(app.server)
        .post('/api/alerts')
        .send({
          projectId,
          name: 'Unauthorized Alert',
          type: 'latency',
          condition: 'gt',
          threshold: 1000,
        })
        .expect(401);
    });

    it('应该拒绝访问不属于自己的项目', async () => {
      await request(app.server)
        .post('/api/alerts')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          projectId: 'nonexistent-project-id',
          name: 'Bad Alert',
          type: 'latency',
          condition: 'gt',
          threshold: 1000,
        })
        .expect(404);
    });
  });

  describe('GET /api/alerts', () => {
    it('应该返回告警列表和历史', async () => {
      const response = await request(app.server)
        .get('/api/alerts')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ projectId })
        .expect(200);

      expect(response.body).toHaveProperty('alerts');
      expect(response.body).toHaveProperty('history');
      expect(Array.isArray(response.body.alerts)).toBe(true);
      expect(response.body.alerts.length).toBeGreaterThanOrEqual(1);
    });

    it('应该拒绝未认证请求', async () => {
      await request(app.server)
        .get('/api/alerts')
        .query({ projectId })
        .expect(401);
    });

    it('应该拒绝访问不属于自己的项目', async () => {
      await request(app.server)
        .get('/api/alerts')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ projectId: 'nonexistent-project-id' })
        .expect(404);
    });
  });

  describe('PUT /api/alerts/:id', () => {
    it('应该成功更新告警规则', async () => {
      const response = await request(app.server)
        .put(`/api/alerts/${alertId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: 'Updated Latency Alert',
          threshold: 2000,
          enabled: false,
        })
        .expect(200);

      expect(response.body).toHaveProperty('alert');
      expect(response.body.alert.name).toBe('Updated Latency Alert');
      expect(response.body.alert.threshold).toBe(2000);
    });

    it('应该拒绝更新不存在的告警', async () => {
      await request(app.server)
        .put('/api/alerts/nonexistent-alert-id')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'Ghost Alert' })
        .expect(404);
    });

    it('应该拒绝未认证请求', async () => {
      await request(app.server)
        .put(`/api/alerts/${alertId}`)
        .send({ name: 'Unauthorized Update' })
        .expect(401);
    });
  });

  describe('POST /api/alerts/check', () => {
    it('应该执行告警检查', async () => {
      const response = await request(app.server)
        .post('/api/alerts/check')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ projectId })
        .expect(200);

      expect(response.body).toHaveProperty('triggered');
    });

    it('应该拒绝未认证请求', async () => {
      await request(app.server)
        .post('/api/alerts/check')
        .send({ projectId })
        .expect(401);
    });

    it('应该拒绝访问不属于自己的项目', async () => {
      await request(app.server)
        .post('/api/alerts/check')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ projectId: 'nonexistent-project-id' })
        .expect(404);
    });
  });

  describe('DELETE /api/alerts/:id', () => {
    it('应该成功删除告警规则', async () => {
      await request(app.server)
        .delete(`/api/alerts/${alertId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(204);
    });

    it('应该拒绝删除不存在的告警', async () => {
      await request(app.server)
        .delete('/api/alerts/nonexistent-alert-id')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });

    it('应该拒绝未认证请求', async () => {
      await request(app.server)
        .delete(`/api/alerts/${alertId}`)
        .expect(401);
    });
  });
});
