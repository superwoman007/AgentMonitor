import request from 'supertest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';

describe('Snapshots API', () => {
  let app: FastifyInstance;
  let apiKey: string;
  let projectId: string;
  let authToken: string;
  let sessionId: string;
  let snapshotId: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const testEmail = `test-snapshots-${Date.now()}@example.com`;
    const registerResponse = await request(app.server)
      .post('/api/auth/register')
      .send({
        email: testEmail,
        password: 'Test12345678!',
        name: 'Snapshots Test User',
      });

    authToken = registerResponse.body.token;

    const projectResponse = await request(app.server)
      .post('/api/projects')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'Snapshots Test Project' });

    projectId = projectResponse.body.id;

    const keyResponse = await request(app.server)
      .post('/api/apikeys')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ project_id: projectId, name: 'Snapshots Test Key' });

    apiKey = keyResponse.body.key;

    // Create a session
    const sessionResponse = await request(app.server)
      .post('/api/sessions')
      .set('X-API-Key', apiKey)
      .send({
        session_id: `snapshot-session-${Date.now()}`,
        metadata: { environment: 'test' },
      });

    sessionId = sessionResponse.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/snapshots', () => {
    it('应该成功创建快照', async () => {
      const response = await request(app.server)
        .post('/api/snapshots')
        .set('X-API-Key', apiKey)
        .send({
          sessionId,
          triggerReason: 'breakpoint_hit',
          state: {
            variables: { x: 1, y: 'hello' },
            callStack: ['main', 'processInput'],
          },
        })
        .expect(201);

      expect(response.body).toHaveProperty('snapshot');
      expect(response.body.snapshot).toHaveProperty('id');

      snapshotId = response.body.snapshot.id;
    });

    it('应该创建带 breakpointId 的快照', async () => {
      // Create a real breakpoint first to satisfy FK constraint
      const bpResponse = await request(app.server)
        .post('/api/breakpoints')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          projectId,
          name: 'test-bp',
          condition: 'always',
        });

      const breakpointId = bpResponse.body.breakpoint?.id || bpResponse.body.id;

      const response = await request(app.server)
        .post('/api/snapshots')
        .set('X-API-Key', apiKey)
        .send({
          sessionId,
          breakpointId,
          triggerReason: 'manual',
          state: { step: 'after_tool_call' },
        })
        .expect(201);

      expect(response.body.snapshot).toHaveProperty('id');
    });

    it('应该创建带 timestamp 的快照', async () => {
      const ts = new Date().toISOString();
      const response = await request(app.server)
        .post('/api/snapshots')
        .set('X-API-Key', apiKey)
        .send({
          sessionId,
          triggerReason: 'scheduled',
          state: { checkpoint: true },
          timestamp: ts,
        })
        .expect(201);

      expect(response.body.snapshot).toHaveProperty('id');
    });

    it('应该要求必填字段', async () => {
      await request(app.server)
        .post('/api/snapshots')
        .set('X-API-Key', apiKey)
        .send({
          sessionId,
          // missing triggerReason and state
        })
        .expect(400);
    });

    it('应该拒绝不存在的 session', async () => {
      await request(app.server)
        .post('/api/snapshots')
        .set('X-API-Key', apiKey)
        .send({
          sessionId: 'nonexistent-session',
          triggerReason: 'test',
          state: { x: 1 },
        })
        .expect(404);
    });

    it('应该拒绝未认证请求', async () => {
      await request(app.server)
        .post('/api/snapshots')
        .send({
          sessionId,
          triggerReason: 'test',
          state: { x: 1 },
        })
        .expect(401);
    });
  });

  describe('GET /api/snapshots', () => {
    it('应该按 sessionId 查询快照', async () => {
      const response = await request(app.server)
        .get('/api/snapshots')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ sessionId })
        .expect(200);

      expect(response.body).toHaveProperty('snapshots');
      expect(Array.isArray(response.body.snapshots)).toBe(true);
      expect(response.body.snapshots.length).toBeGreaterThanOrEqual(1);
    });

    it('应该按 projectId 查询快照', async () => {
      const response = await request(app.server)
        .get('/api/snapshots')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ projectId })
        .expect(200);

      expect(response.body).toHaveProperty('snapshots');
      expect(Array.isArray(response.body.snapshots)).toBe(true);
    });

    it('应该要求至少一个查询参数', async () => {
      await request(app.server)
        .get('/api/snapshots')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);
    });

    it('应该拒绝未认证请求', async () => {
      await request(app.server)
        .get('/api/snapshots')
        .query({ sessionId })
        .expect(401);
    });

    it('应该拒绝访问不属于自己的项目', async () => {
      await request(app.server)
        .get('/api/snapshots')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ projectId: 'nonexistent-project-id' })
        .expect(404);
    });
  });

  describe('GET /api/snapshots/:id', () => {
    it('应该返回快照详情', async () => {
      const response = await request(app.server)
        .get(`/api/snapshots/${snapshotId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('snapshot');
      expect(response.body.snapshot.id).toBe(snapshotId);
    });

    it('应该拒绝访问不存在的快照', async () => {
      await request(app.server)
        .get('/api/snapshots/nonexistent-id')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });

    it('应该拒绝未认证请求', async () => {
      await request(app.server)
        .get(`/api/snapshots/${snapshotId}`)
        .expect(401);
    });
  });

  describe('GET /api/snapshots/count/:sessionId', () => {
    it('应该返回快照数量', async () => {
      const response = await request(app.server)
        .get(`/api/snapshots/count/${sessionId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('count');
      expect(response.body.count).toBeGreaterThanOrEqual(1);
    });

    it('应该拒绝不存在的 session', async () => {
      await request(app.server)
        .get('/api/snapshots/count/nonexistent-session')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });

    it('应该拒绝未认证请求', async () => {
      await request(app.server)
        .get(`/api/snapshots/count/${sessionId}`)
        .expect(401);
    });
  });
});
