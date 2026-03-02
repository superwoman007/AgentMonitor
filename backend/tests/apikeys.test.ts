import request from 'supertest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';

describe('API Keys', () => {
  let app: FastifyInstance;
  let authToken: string;
  let projectId: string;
  let apiKeyId: string;
  const testEmail = `test-apikeys-${Date.now()}@example.com`;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    // 注册用户
    const registerResponse = await request(app.server)
      .post('/api/auth/register')
      .send({
        email: testEmail,
        password: 'Test123456!',
        name: 'API Key Test User'
      });
    
    authToken = registerResponse.body.token;

    // 创建项目
    const projectResponse = await request(app.server)
      .post('/api/projects')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        name: 'API Key Test Project'
      });
    
    projectId = projectResponse.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/apikeys', () => {
    it('应该成功创建 API Key', async () => {
      const response = await request(app.server)
        .post('/api/apikeys')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          project_id: projectId,
          name: 'Test API Key'
        })
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body).toHaveProperty('key');
      expect(response.body.key).toMatch(/^am_[a-zA-Z0-9]{32}$/);
      expect(response.body.name).toBe('Test API Key');
      
      apiKeyId = response.body.id;
    });

    it('应该拒绝未认证的请求', async () => {
      await request(app.server)
        .post('/api/apikeys')
        .send({
          project_id: projectId,
          name: 'Unauthorized Key'
        })
        .expect(401);
    });

    it('应该拒绝无效的项目 ID', async () => {
      await request(app.server)
        .post('/api/apikeys')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          project_id: 99999,
          name: 'Invalid Project Key'
        })
        .expect(404);
    });
  });

  describe('GET /api/apikeys', () => {
    it('应该返回 API Key 列表', async () => {
      const response = await request(app.server)
        .get('/api/apikeys')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ project_id: projectId })
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);
      expect(response.body[0]).toHaveProperty('id');
      expect(response.body[0]).toHaveProperty('key_prefix');
      expect(response.body[0]).not.toHaveProperty('key'); // 完整密钥不应该在列表中
    });
  });

  describe('GET /api/apikeys/:id/secret', () => {
    it('应该返回完整的 API Key', async () => {
      const response = await request(app.server)
        .get(`/api/apikeys/${apiKeyId}/secret`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('key');
      expect(response.body.key).toMatch(/^am_[a-zA-Z0-9]{32}$/);
    });

    it('应该拒绝未认证的请求', async () => {
      await request(app.server)
        .get(`/api/apikeys/${apiKeyId}/secret`)
        .expect(401);
    });

    it('应该拒绝访问不存在的 Key', async () => {
      await request(app.server)
        .get('/api/apikeys/99999/secret')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });
  });

  describe('DELETE /api/apikeys/:id', () => {
    it('应该成功吊销 API Key', async () => {
      await request(app.server)
        .delete(`/api/apikeys/${apiKeyId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(204);

      // 验证 Key 已吊销（列表中应该标记为 inactive）
      const response = await request(app.server)
        .get('/api/apikeys')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ project_id: projectId });

      const revokedKey = response.body.find((k: any) => k.id === apiKeyId);
      expect(revokedKey.is_active).toBe(false);
    });

    it('应该拒绝重复吊销', async () => {
      await request(app.server)
        .delete(`/api/apikeys/${apiKeyId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);
    });
  });
});
