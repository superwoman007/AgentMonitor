import request from 'supertest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';

describe('Model Configs API', () => {
  let app: FastifyInstance;
  let authToken: string;
  let projectId: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const testEmail = `test-model-configs-${Date.now()}@example.com`;
    const registerResponse = await request(app.server)
      .post('/api/auth/register')
      .send({
        email: testEmail,
        password: 'Test123456!',
        name: 'Model Config Test User'
      });

    authToken = registerResponse.body.token;

    const projectResponse = await request(app.server)
      .post('/api/projects')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        name: 'Model Config Test Project'
      });

    projectId = projectResponse.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/model-configs', () => {
    it('应该成功创建模型配置（含 api_key / base_url）', async () => {
      const response = await request(app.server)
        .post('/api/model-configs')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          project_id: projectId,
          name: 'GPT-4 Test',
          provider: 'openai',
          model: 'gpt-4',
          api_key: 'sk-test123456',
          base_url: 'https://api.openai.com/v1',
          config: { temperature: 0.7, max_tokens: 4096 },
        })
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body.name).toBe('GPT-4 Test');
      expect(response.body.provider).toBe('openai');
      expect(response.body.model).toBe('gpt-4');
      expect(response.body.api_key).toBe('sk-test123456');
      expect(response.body.base_url).toBe('https://api.openai.com/v1');
      expect(response.body.config).toMatchObject({ temperature: 0.7, max_tokens: 4096 });
    });

    it('应该拒绝缺少必填字段', async () => {
      await request(app.server)
        .post('/api/model-configs')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ project_id: projectId, name: 'Test' })
        .expect(400);
    });

    it('应该拒绝未授权请求', async () => {
      await request(app.server)
        .post('/api/model-configs')
        .send({ project_id: projectId, name: 'Test', provider: 'openai', model: 'gpt-4' })
        .expect(401);
    });
  });

  describe('GET /api/model-configs', () => {
    it('应该返回模型配置列表', async () => {
      const response = await request(app.server)
        .get(`/api/model-configs?project_id=${projectId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);
    });

    it('应该拒绝缺少 project_id', async () => {
      await request(app.server)
        .get('/api/model-configs')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);
    });
  });

  describe('GET /api/model-configs/:id', () => {
    it('应该返回单个模型配置', async () => {
      const createRes = await request(app.server)
        .post('/api/model-configs')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          project_id: projectId,
          name: 'Claude Test',
          provider: 'anthropic',
          model: 'claude-3-opus',
        })
        .expect(201);

      const response = await request(app.server)
        .get(`/api/model-configs/${createRes.body.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.name).toBe('Claude Test');
    });

    it('应该返回 404 对于不存在的配置', async () => {
      await request(app.server)
        .get('/api/model-configs/nonexistent')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });
  });

  describe('DELETE /api/model-configs/:id', () => {
    it('应该删除模型配置', async () => {
      const createRes = await request(app.server)
        .post('/api/model-configs')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          project_id: projectId,
          name: 'To Delete',
          provider: 'custom',
          model: 'custom-model',
        })
        .expect(201);

      await request(app.server)
        .delete(`/api/model-configs/${createRes.body.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(204);

      await request(app.server)
        .get(`/api/model-configs/${createRes.body.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });
  });
});
