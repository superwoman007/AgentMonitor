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
        password: 'Test12345678!',
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
    it('should create model config and encrypt api_key (return masked)', async () => {
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
      expect(response.body.api_key).not.toBe('sk-test123456');
      expect(response.body.api_key).toMatch(/\.\.\./);
      expect(response.body.base_url).toBe('https://api.openai.com/v1');
      expect(response.body.config).toMatchObject({ temperature: 0.7, max_tokens: 4096 });
    });

    it('should reject missing required fields', async () => {
      await request(app.server)
        .post('/api/model-configs')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ project_id: projectId, name: 'Test' })
        .expect(400);
    });

    it('should reject unauthorized request', async () => {
      await request(app.server)
        .post('/api/model-configs')
        .send({ project_id: projectId, name: 'Test', provider: 'openai', model: 'gpt-4' })
        .expect(401);
    });
  });

  describe('GET /api/model-configs', () => {
    it('should return list with masked api_key', async () => {
      const response = await request(app.server)
        .get(`/api/model-configs?project_id=${projectId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);

      for (const cfg of response.body) {
        if (cfg.api_key) {
          expect(cfg.api_key).not.toBe('sk-test123456');
          expect(cfg.api_key).toMatch(/\.\.\./);
        }
      }
    });

    it('should reject missing project_id', async () => {
      await request(app.server)
        .get('/api/model-configs')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);
    });
  });

  describe('GET /api/model-configs/:id', () => {
    it('should return single config with masked api_key', async () => {
      const createRes = await request(app.server)
        .post('/api/model-configs')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          project_id: projectId,
          name: 'Claude Test',
          provider: 'anthropic',
          model: 'claude-3-opus',
          api_key: 'sk-claude-secret-key',
        })
        .expect(201);

      const response = await request(app.server)
        .get(`/api/model-configs/${createRes.body.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.name).toBe('Claude Test');
      expect(response.body.api_key).not.toBe('sk-claude-secret-key');
      expect(response.body.api_key).toMatch(/\.\.\./);
    });

    it('should return 404 for nonexistent config', async () => {
      await request(app.server)
        .get('/api/model-configs/nonexistent')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });
  });

  describe('PUT /api/model-configs/:id', () => {
    it('should update model config including api_key', async () => {
      const createRes = await request(app.server)
        .post('/api/model-configs')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          project_id: projectId,
          name: 'Original Name',
          provider: 'openai',
          model: 'gpt-3.5-turbo',
          api_key: 'sk-original-key',
          base_url: 'https://original.com',
        })
        .expect(201);

      const configId = createRes.body.id;

      const updateRes = await request(app.server)
        .put(`/api/model-configs/${configId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: 'Updated Name',
          model: 'gpt-4o',
          api_key: 'sk-new-secret-key',
          base_url: 'https://new.com',
        })
        .expect(200);

      expect(updateRes.body.name).toBe('Updated Name');
      expect(updateRes.body.model).toBe('gpt-4o');
      expect(updateRes.body.base_url).toBe('https://new.com');
      expect(updateRes.body.api_key).not.toBe('sk-new-secret-key');
      expect(updateRes.body.api_key).toMatch(/\.\.\./);

      const getRes = await request(app.server)
        .get(`/api/model-configs/${configId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(getRes.body.name).toBe('Updated Name');
      expect(getRes.body.model).toBe('gpt-4o');
    });

    it('should support partial update without changing api_key', async () => {
      const createRes = await request(app.server)
        .post('/api/model-configs')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          project_id: projectId,
          name: 'Partial Update Test',
          provider: 'deepseek',
          model: 'deepseek-chat',
          api_key: 'sk-partial-key',
        })
        .expect(201);

      const updateRes = await request(app.server)
        .put(`/api/model-configs/${createRes.body.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'Only Name Changed' })
        .expect(200);

      expect(updateRes.body.name).toBe('Only Name Changed');
      expect(updateRes.body.model).toBe('deepseek-chat');
    });

    it('should return 404 for nonexistent config', async () => {
      await request(app.server)
        .put('/api/model-configs/nonexistent')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'New Name' })
        .expect(404);
    });
  });

  describe('POST /api/model-configs/:id/test', () => {
    it('should return connection test result', async () => {
      const createRes = await request(app.server)
        .post('/api/model-configs')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          project_id: projectId,
          name: 'Test Connection Config',
          provider: 'openai',
          model: 'gpt-4o-mini',
          api_key: 'sk-test-connection-key',
        })
        .expect(201);

      const response = await request(app.server)
        .post(`/api/model-configs/${createRes.body.id}/test`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('success');
      expect(response.body).toHaveProperty('latency_ms');
      expect(typeof response.body.success).toBe('boolean');
    });

    it('should return 404 for nonexistent config', async () => {
      await request(app.server)
        .post('/api/model-configs/nonexistent/test')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });
  });

  describe('国内供应商配置', () => {
    it('应支持创建 DeepSeek 配置', async () => {
      const response = await request(app.server)
        .post('/api/model-configs')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          project_id: projectId,
          name: 'DeepSeek V4',
          provider: 'deepseek',
          model: 'deepseek-v4-pro',
          api_key: 'sk-deepseek-test',
          base_url: 'https://api.deepseek.com',
        })
        .expect(201);

      expect(response.body.provider).toBe('deepseek');
      expect(response.body.model).toBe('deepseek-v4-pro');
      expect(response.body.base_url).toBe('https://api.deepseek.com');
    });

    it('应支持创建 Kimi 配置', async () => {
      const response = await request(app.server)
        .post('/api/model-configs')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          project_id: projectId,
          name: 'Kimi K2.6',
          provider: 'kimi',
          model: 'kimi-k2.6',
          api_key: 'sk-kimi-test',
          base_url: 'https://api.moonshot.ai/v1',
        })
        .expect(201);

      expect(response.body.provider).toBe('kimi');
      expect(response.body.model).toBe('kimi-k2.6');
    });

    it('应支持创建 GLM 配置', async () => {
      const response = await request(app.server)
        .post('/api/model-configs')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          project_id: projectId,
          name: 'GLM 4.7',
          provider: 'glm',
          model: 'glm-4.7',
          api_key: 'sk-glm-test',
          base_url: 'https://open.bigmodel.cn/api/paas/v4',
        })
        .expect(201);

      expect(response.body.provider).toBe('glm');
      expect(response.body.model).toBe('glm-4.7');
    });

    it('应支持创建豆包配置', async () => {
      const response = await request(app.server)
        .post('/api/model-configs')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          project_id: projectId,
          name: 'Doubao Pro',
          provider: 'doubao',
          model: 'doubao-pro-32k',
          api_key: 'sk-doubao-test',
          base_url: 'https://ark.cn-beijing.volces.com/api/v3',
        })
        .expect(201);

      expect(response.body.provider).toBe('doubao');
      expect(response.body.model).toBe('doubao-pro-32k');
    });

    it('应支持创建 MiMo 配置', async () => {
      const response = await request(app.server)
        .post('/api/model-configs')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          project_id: projectId,
          name: 'MiMo V2',
          provider: 'mimo',
          model: 'mimo-v2-pro',
          api_key: 'sk-mimo-test',
          base_url: 'https://api.xiaomimimo.com/v1',
        })
        .expect(201);

      expect(response.body.provider).toBe('mimo');
      expect(response.body.model).toBe('mimo-v2-pro');
    });
  });

  describe('DELETE /api/model-configs/:id', () => {
    it('should delete model config', async () => {
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
