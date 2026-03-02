import request from 'supertest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';

describe('Sessions API', () => {
  let app: FastifyInstance;
  let apiKey: string;
  let projectId: string;
  let sessionId: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    // 创建测试用户和项目
    const testEmail = `test-sessions-${Date.now()}@example.com`;
    const registerResponse = await request(app.server)
      .post('/api/auth/register')
      .send({
        email: testEmail,
        password: 'Test123456!',
        name: 'Session Test User'
      });
    
    const authToken = registerResponse.body.token;

    const projectResponse = await request(app.server)
      .post('/api/projects')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        name: 'Session Test Project'
      });
    
    projectId = projectResponse.body.id;

    const keyResponse = await request(app.server)
      .post('/api/apikeys')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        project_id: projectId,
        name: 'Session Test Key'
      });
    
    apiKey = keyResponse.body.key;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/sessions', () => {
    it('应该成功创建会话', async () => {
      const response = await request(app.server)
        .post('/api/sessions')
        .set('X-API-Key', apiKey)
        .send({
          session_id: `test-session-${Date.now()}`,
          metadata: {
            user_id: 'user-123',
            environment: 'test'
          }
        })
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body).toHaveProperty('session_id');
      
      sessionId = response.body.id;
    });

    it('应该拒绝无 API Key 的请求', async () => {
      await request(app.server)
        .post('/api/sessions')
        .send({
          session_id: 'unauthorized-session'
        })
        .expect(401);
    });

    it('应该拒绝无效的 API Key', async () => {
      await request(app.server)
        .post('/api/sessions')
        .set('X-API-Key', 'invalid-key')
        .send({
          session_id: 'invalid-key-session'
        })
        .expect(401);
    });
  });

  describe('POST /api/sessions/:id/messages', () => {
    it('应该成功添加消息', async () => {
      const response = await request(app.server)
        .post(`/api/sessions/${sessionId}/messages`)
        .set('X-API-Key', apiKey)
        .send({
          role: 'user',
          content: 'Hello, AI!',
          timestamp: new Date().toISOString()
        })
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body.role).toBe('user');
      expect(response.body.content).toBe('Hello, AI!');
    });

    it('应该成功添加 AI 响应', async () => {
      const response = await request(app.server)
        .post(`/api/sessions/${sessionId}/messages`)
        .set('X-API-Key', apiKey)
        .send({
          role: 'assistant',
          content: 'Hello! How can I help you?',
          timestamp: new Date().toISOString(),
          metadata: {
            model: 'gpt-4',
            tokens: 15,
            latency_ms: 234
          }
        })
        .expect(201);

      expect(response.body.role).toBe('assistant');
      expect(response.body.metadata.model).toBe('gpt-4');
    });

    it('应该拒绝无效的 role', async () => {
      await request(app.server)
        .post(`/api/sessions/${sessionId}/messages`)
        .set('X-API-Key', apiKey)
        .send({
          role: 'invalid-role',
          content: 'Test'
        })
        .expect(400);
    });
  });

  describe('GET /api/sessions', () => {
    it('应该返回会话列表', async () => {
      const response = await request(app.server)
        .get('/api/sessions')
        .set('X-API-Key', apiKey)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);
      expect(response.body[0]).toHaveProperty('id');
      expect(response.body[0]).toHaveProperty('session_id');
    });

    it('应该支持分页', async () => {
      const response = await request(app.server)
        .get('/api/sessions')
        .set('X-API-Key', apiKey)
        .query({ limit: 5, offset: 0 })
        .expect(200);

      expect(response.body.length).toBeLessThanOrEqual(5);
    });
  });

  describe('GET /api/sessions/:id', () => {
    it('应该返回会话详情（包含消息）', async () => {
      const response = await request(app.server)
        .get(`/api/sessions/${sessionId}`)
        .set('X-API-Key', apiKey)
        .expect(200);

      expect(response.body.id).toBe(sessionId);
      expect(response.body).toHaveProperty('messages');
      expect(Array.isArray(response.body.messages)).toBe(true);
      expect(response.body.messages.length).toBeGreaterThan(0);
    });

    it('应该拒绝访问不存在的会话', async () => {
      await request(app.server)
        .get('/api/sessions/99999')
        .set('X-API-Key', apiKey)
        .expect(404);
    });
  });
});
