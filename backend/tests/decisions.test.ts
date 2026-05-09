import request from 'supertest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';

describe('Decisions API', () => {
  let app: FastifyInstance;
  let apiKey: string;
  let projectId: string;
  let authToken: string;
  let decisionId: string;
  let sessionId: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const testEmail = `test-decisions-${Date.now()}@example.com`;
    const registerResponse = await request(app.server)
      .post('/api/auth/register')
      .send({
        email: testEmail,
        password: 'Test123456!',
        name: 'Decisions Test User',
      });

    authToken = registerResponse.body.token;

    const projectResponse = await request(app.server)
      .post('/api/projects')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'Decisions Test Project' });

    projectId = projectResponse.body.id;

    const keyResponse = await request(app.server)
      .post('/api/apikeys')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ project_id: projectId, name: 'Decisions Test Key' });

    apiKey = keyResponse.body.key;

    // Create a session for decision association
    const sessionResponse = await request(app.server)
      .post('/api/sessions')
      .set('X-API-Key', apiKey)
      .send({
        session_id: `decision-session-${Date.now()}`,
        metadata: { environment: 'test' },
      });

    sessionId = sessionResponse.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/decisions', () => {
    it('应该成功创建决策记录', async () => {
      const response = await request(app.server)
        .post('/api/decisions')
        .set('X-API-Key', apiKey)
        .send({
          projectId,
          sessionId,
          decisionType: 'model_selection',
          selectedOption: 'gpt-4',
          confidence: 0.85,
          reasoning: 'Complex task requires stronger model',
          decisionMaker: 'llm',
          latencyMs: 120,
          options: [
            { name: 'gpt-4', score: 0.85, pros: ['accurate'], cons: ['expensive'] },
            { name: 'gpt-3.5-turbo', score: 0.6, pros: ['cheap'], cons: ['less accurate'] },
          ],
        })
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body.decision_type).toBe('model_selection');
      expect(response.body.selected_option).toBe('gpt-4');

      decisionId = response.body.id;
    });

    it('应该创建无 session 的决策', async () => {
      const response = await request(app.server)
        .post('/api/decisions')
        .set('X-API-Key', apiKey)
        .send({
          projectId,
          decisionType: 'routing',
          selectedOption: 'agent-a',
          decisionMaker: 'rule',
        })
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body.decision_maker).toBe('rule');
    });

    it('应该自动创建不存在的 session', async () => {
      const newSessionId = `auto-session-${Date.now()}`;
      const response = await request(app.server)
        .post('/api/decisions')
        .set('X-API-Key', apiKey)
        .send({
          projectId,
          sessionId: newSessionId,
          decisionType: 'fallback',
          selectedOption: 'retry',
          decisionMaker: 'human',
        })
        .expect(201);

      expect(response.body).toHaveProperty('id');
    });

    it('应该拒绝未认证请求', async () => {
      await request(app.server)
        .post('/api/decisions')
        .send({
          projectId,
          decisionType: 'test',
          selectedOption: 'a',
          decisionMaker: 'rule',
        })
        .expect(401);
    });

    it('应该拒绝缺少必填字段的请求', async () => {
      await request(app.server)
        .post('/api/decisions')
        .set('X-API-Key', apiKey)
        .send({
          projectId,
          // missing decisionType, selectedOption, decisionMaker
        })
        .expect(400);
    });
  });

  describe('GET /api/decisions/:id', () => {
    it('应该返回决策详情', async () => {
      const response = await request(app.server)
        .get(`/api/decisions/${decisionId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.id).toBe(decisionId);
      expect(response.body.decision_type).toBe('model_selection');
    });

    it('应该拒绝访问不存在的决策', async () => {
      await request(app.server)
        .get('/api/decisions/nonexistent-id')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });

    it('应该拒绝未认证请求', async () => {
      await request(app.server)
        .get(`/api/decisions/${decisionId}`)
        .expect(401);
    });
  });

  describe('GET /api/projects/:projectId/decisions', () => {
    it('应该返回项目的决策列表', async () => {
      const response = await request(app.server)
        .get(`/api/projects/${projectId}/decisions`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThanOrEqual(1);
    });

    it('应该支持分页参数', async () => {
      const response = await request(app.server)
        .get(`/api/projects/${projectId}/decisions`)
        .set('Authorization', `Bearer ${authToken}`)
        .query({ limit: 1, offset: 0 })
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeLessThanOrEqual(1);
    });

    it('应该拒绝访问不属于自己的项目', async () => {
      await request(app.server)
        .get('/api/projects/nonexistent-project-id/decisions')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });
  });

  describe('GET /api/sessions/:sessionId/decisions', () => {
    it('应该返回会话的决策列表', async () => {
      const response = await request(app.server)
        .get(`/api/sessions/${sessionId}/decisions`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThanOrEqual(1);
    });

    it('应该拒绝未认证请求', async () => {
      await request(app.server)
        .get(`/api/sessions/${sessionId}/decisions`)
        .expect(401);
    });
  });

  describe('GET /api/projects/:projectId/decisions/stats', () => {
    it('应该返回决策统计', async () => {
      const response = await request(app.server)
        .get(`/api/projects/${projectId}/decisions/stats`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toBeDefined();
    });

    it('应该拒绝访问不属于自己的项目', async () => {
      await request(app.server)
        .get('/api/projects/nonexistent-project-id/decisions/stats')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });
  });

  describe('DELETE /api/decisions/:id', () => {
    it('应该成功删除决策', async () => {
      await request(app.server)
        .delete(`/api/decisions/${decisionId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(204);
    });

    it('应该拒绝删除不存在的决策', async () => {
      await request(app.server)
        .delete('/api/decisions/nonexistent-id')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });

    it('应该拒绝未认证请求', async () => {
      await request(app.server)
        .delete(`/api/decisions/${decisionId}`)
        .expect(401);
    });
  });
});
