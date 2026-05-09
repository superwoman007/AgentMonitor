import request from 'supertest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';

describe('ToolCalls API', () => {
  let app: FastifyInstance;
  let apiKey: string;
  let projectId: string;
  let authToken: string;
  let sessionId: string;
  let toolCallId: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const testEmail = `test-toolcalls-${Date.now()}@example.com`;
    const registerResponse = await request(app.server)
      .post('/api/auth/register')
      .send({
        email: testEmail,
        password: 'Test123456!',
        name: 'ToolCalls Test User',
      });

    authToken = registerResponse.body.token;

    const projectResponse = await request(app.server)
      .post('/api/projects')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'ToolCalls Test Project' });

    projectId = projectResponse.body.id;

    const keyResponse = await request(app.server)
      .post('/api/apikeys')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ project_id: projectId, name: 'ToolCalls Test Key' });

    apiKey = keyResponse.body.key;

    // Create a session
    const sessionResponse = await request(app.server)
      .post('/api/sessions')
      .set('X-API-Key', apiKey)
      .send({
        session_id: `toolcall-session-${Date.now()}`,
        metadata: { environment: 'test' },
      });

    sessionId = sessionResponse.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/tool-calls', () => {
    it('应该成功创建工具调用', async () => {
      const response = await request(app.server)
        .post('/api/tool-calls')
        .set('X-API-Key', apiKey)
        .send({
          sessionId,
          toolName: 'web_search',
          input: { query: 'latest news' },
          status: 'running',
        })
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body.tool_name).toBe('web_search');

      toolCallId = response.body.id;
    });

    it('应该创建带 messageId 的工具调用', async () => {
      // Create a real message first to satisfy FK constraint
      const msgResponse = await request(app.server)
        .post(`/api/sessions/${sessionId}/messages`)
        .set('X-API-Key', apiKey)
        .send({
          role: 'user',
          content: 'Calculate 2+2',
          timestamp: new Date().toISOString(),
        });

      const messageId = msgResponse.body.id;

      const response = await request(app.server)
        .post('/api/tool-calls')
        .set('X-API-Key', apiKey)
        .send({
          sessionId,
          messageId,
          toolName: 'calculator',
          input: { expression: '2+2' },
          output: { result: 4 },
          status: 'success',
        })
        .expect(201);

      expect(response.body).toHaveProperty('id');
    });

    it('应该要求 sessionId 和 toolName', async () => {
      await request(app.server)
        .post('/api/tool-calls')
        .set('X-API-Key', apiKey)
        .send({
          toolName: 'missing_session',
        })
        .expect(400);
    });

    it('应该拒绝不存在的 session', async () => {
      await request(app.server)
        .post('/api/tool-calls')
        .set('X-API-Key', apiKey)
        .send({
          sessionId: 'nonexistent-session',
          toolName: 'test',
        })
        .expect(404);
    });

    it('应该拒绝未认证请求', async () => {
      await request(app.server)
        .post('/api/tool-calls')
        .send({
          sessionId,
          toolName: 'test',
        })
        .expect(401);
    });
  });

  describe('GET /api/tool-calls', () => {
    it('应该返回会话的工具调用列表', async () => {
      const response = await request(app.server)
        .get('/api/tool-calls')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ session_id: sessionId })
        .expect(200);

      expect(response.body).toHaveProperty('tool_calls');
      expect(Array.isArray(response.body.tool_calls)).toBe(true);
      expect(response.body.tool_calls.length).toBeGreaterThanOrEqual(1);
    });

    it('应该要求 session_id 参数', async () => {
      await request(app.server)
        .get('/api/tool-calls')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);
    });

    it('应该拒绝不存在的 session', async () => {
      await request(app.server)
        .get('/api/tool-calls')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ session_id: 'nonexistent-session' })
        .expect(404);
    });

    it('应该拒绝未认证请求', async () => {
      await request(app.server)
        .get('/api/tool-calls')
        .query({ session_id: sessionId })
        .expect(401);
    });
  });

  describe('PATCH /api/tool-calls/:id', () => {
    it('应该成功更新工具调用', async () => {
      const response = await request(app.server)
        .patch(`/api/tool-calls/${toolCallId}`)
        .set('X-API-Key', apiKey)
        .send({
          output: { results: ['result1', 'result2'] },
          status: 'success',
        })
        .expect(200);

      expect(response.body).toHaveProperty('id', toolCallId);
    });

    it('应该拒绝更新不存在的工具调用', async () => {
      await request(app.server)
        .patch('/api/tool-calls/nonexistent-id')
        .set('X-API-Key', apiKey)
        .send({ status: 'error' })
        .expect(404);
    });

    it('应该拒绝未认证请求', async () => {
      await request(app.server)
        .patch(`/api/tool-calls/${toolCallId}`)
        .send({ status: 'error' })
        .expect(401);
    });
  });
});
