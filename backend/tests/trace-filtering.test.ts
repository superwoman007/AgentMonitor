import request from 'supertest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';

describe('Trace Filtering API', () => {
  let app: FastifyInstance;
  let authToken: string;
  let projectId: string;
  let apiKey: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const testEmail = `test-filter-${Date.now()}@example.com`;
    const registerResponse = await request(app.server)
      .post('/api/auth/register')
      .send({ email: testEmail, password: 'Test12345678!', name: 'Filter Test' });
    authToken = registerResponse.body.token;

    const projectResponse = await request(app.server)
      .post('/api/projects')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'Filter Test Project' });
    projectId = projectResponse.body.id;

    const keyResponse = await request(app.server)
      .post('/api/apikeys')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ project_id: projectId, name: 'Filter Key' });
    apiKey = keyResponse.body.key;

    // Create test traces with varied data
    const traces = [
      { name: 'chat-completion', traceType: 'llm', status: 'success', latencyMs: 200, startedAt: '2026-05-20T10:00:00Z' },
      { name: 'chat-completion-slow', traceType: 'llm', status: 'success', latencyMs: 5000, startedAt: '2026-05-21T10:00:00Z' },
      { name: 'tool-search', traceType: 'tool', status: 'error', latencyMs: 1500, startedAt: '2026-05-22T10:00:00Z' },
      { name: 'agent-plan', traceType: 'agent', status: 'success', latencyMs: 800, startedAt: '2026-05-23T10:00:00Z' },
      { name: 'embedding-query', traceType: 'llm', status: 'success', latencyMs: 100, startedAt: '2026-05-24T10:00:00Z' },
    ];

    for (const t of traces) {
      await request(app.server)
        .post('/api/traces')
        .set('X-API-Key', apiKey)
        .send({
          projectId,
          name: t.name,
          traceType: t.traceType,
          status: t.status,
          latencyMs: t.latencyMs,
          startedAt: t.startedAt,
          input: { query: 'test' },
        });
    }
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /api/traces - name filter', () => {
    it('should filter traces by name substring', async () => {
      const res = await request(app.server)
        .get(`/api/traces?projectId=${projectId}&name=chat`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body.traces.length).toBe(2);
      expect(res.body.traces.every((t: any) => t.name.includes('chat'))).toBe(true);
    });

    it('should be case-insensitive', async () => {
      const res = await request(app.server)
        .get(`/api/traces?projectId=${projectId}&name=CHAT`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body.traces.length).toBe(2);
    });

    it('should return empty for non-matching name', async () => {
      const res = await request(app.server)
        .get(`/api/traces?projectId=${projectId}&name=nonexistent`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body.traces.length).toBe(0);
    });
  });

  describe('GET /api/traces - date range filter', () => {
    it('should filter by startDate', async () => {
      const res = await request(app.server)
        .get(`/api/traces?projectId=${projectId}&startDate=2026-05-22T00:00:00Z`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Should include traces from May 22, 23, 24
      expect(res.body.traces.length).toBe(3);
    });

    it('should filter by endDate', async () => {
      const res = await request(app.server)
        .get(`/api/traces?projectId=${projectId}&endDate=2026-05-21T23:59:59Z`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Should include traces from May 20, 21
      expect(res.body.traces.length).toBe(2);
    });

    it('should filter by date range', async () => {
      const res = await request(app.server)
        .get(`/api/traces?projectId=${projectId}&startDate=2026-05-21T00:00:00Z&endDate=2026-05-23T23:59:59Z`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Should include traces from May 21, 22, 23
      expect(res.body.traces.length).toBe(3);
    });
  });

  describe('GET /api/traces - latency filter', () => {
    it('should filter by latencyMin', async () => {
      const res = await request(app.server)
        .get(`/api/traces?projectId=${projectId}&latencyMin=1000`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // latency >= 1000: 5000, 1500
      expect(res.body.traces.length).toBe(2);
      expect(res.body.traces.every((t: any) => t.latency_ms >= 1000)).toBe(true);
    });

    it('should filter by latencyMax', async () => {
      const res = await request(app.server)
        .get(`/api/traces?projectId=${projectId}&latencyMax=500`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // latency <= 500: 200, 100
      expect(res.body.traces.length).toBe(2);
      expect(res.body.traces.every((t: any) => t.latency_ms <= 500)).toBe(true);
    });

    it('should filter by latency range', async () => {
      const res = await request(app.server)
        .get(`/api/traces?projectId=${projectId}&latencyMin=500&latencyMax=2000`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // 500 <= latency <= 2000: 1500, 800
      expect(res.body.traces.length).toBe(2);
    });
  });

  describe('GET /api/traces - combined filters', () => {
    it('should combine name and status filters', async () => {
      const res = await request(app.server)
        .get(`/api/traces?projectId=${projectId}&name=chat&status=success`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body.traces.length).toBe(2);
    });

    it('should combine name and latency filters', async () => {
      const res = await request(app.server)
        .get(`/api/traces?projectId=${projectId}&name=chat&latencyMax=1000`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // chat-completion (200ms) only
      expect(res.body.traces.length).toBe(1);
      expect(res.body.traces[0].name).toBe('chat-completion');
    });
  });
});
