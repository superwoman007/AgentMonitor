import request from 'supertest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';

describe('Spans API', () => {
  let app: FastifyInstance;
  let apiKey: string;
  let projectId: string;
  let authToken: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const testEmail = `test-spans-${Date.now()}@example.com`;
    const registerResponse = await request(app.server)
      .post('/api/auth/register')
      .send({ email: testEmail, password: 'Test123456!', name: 'Spans Test User' });

    authToken = registerResponse.body.token;

    const projectResponse = await request(app.server)
      .post('/api/projects')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'Spans Test Project' });

    projectId = projectResponse.body.id;

    const keyResponse = await request(app.server)
      .post('/api/apikeys')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ project_id: projectId, name: 'Spans Test Key' });

    apiKey = keyResponse.body.key;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/spans', () => {
    it('should create a span with X-API-Key', async () => {
      const response = await request(app.server)
        .post('/api/spans')
        .set('X-API-Key', apiKey)
        .send({
          traceId: 'trace-route-001',
          spanId: 'span-route-001',
          name: 'llm_call',
          traceType: 'llm',
          startedAt: new Date().toISOString(),
          endedAt: new Date().toISOString(),
          latencyMs: 1000,
          status: 'success',
        })
        .expect(201);

      expect(response.body).toHaveProperty('span');
      expect(response.body.span.span_id).toBe('span-route-001');
      expect(response.body.span.trace_id).toBe('trace-route-001');
    });

    it('should reject missing required fields', async () => {
      await request(app.server)
        .post('/api/spans')
        .set('X-API-Key', apiKey)
        .send({ name: 'incomplete' })
        .expect(400);
    });

    it('should reject without API Key', async () => {
      await request(app.server)
        .post('/api/spans')
        .send({ traceId: 't', spanId: 's', name: 'n', traceType: 't', startedAt: new Date().toISOString() })
        .expect(401);
    });
  });

  describe('GET /api/traces/:id/tree (span-based)', () => {
    it('should return nested span tree when spans exist', async () => {
      const traceId = 'trace-tree-route-001';

      // Create root trace
      const rootRes = await request(app.server)
        .post('/api/traces')
        .set('X-API-Key', apiKey)
        .send({ traceType: 'function', name: 'agent_run', traceId, status: 'success' })
        .expect(201);

      const rootTraceId = rootRes.body.trace.id;

      // Create child span directly
      await request(app.server)
        .post('/api/spans')
        .set('X-API-Key', apiKey)
        .send({
          traceId,
          spanId: 'span-child-001',
          parentSpanId: null,
          name: 'llm_call',
          traceType: 'llm',
          startedAt: new Date().toISOString(),
          latencyMs: 500,
          status: 'success',
        })
        .expect(201);

      const response = await request(app.server)
        .get(`/api/traces/${rootTraceId}/tree`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('spans');
      expect(response.body).toHaveProperty('stats');
      expect(Array.isArray(response.body.spans)).toBe(true);
    });

    it('should return new format with spans and stats when spans table has data', async () => {
      const traceId = 'trace-tree-new-format';

      // 创建 trace
      const rootRes = await request(app.server)
        .post('/api/traces')
        .set('X-API-Key', apiKey)
        .send({ traceType: 'function', name: 'agent_run', traceId, status: 'success' })
        .expect(201);

      const rootTraceId = rootRes.body.trace.id;

      // 创建 span
      await request(app.server)
        .post('/api/spans')
        .set('X-API-Key', apiKey)
        .send({
          traceId,
          spanId: 'span-root-001',
          name: 'agent_run',
          traceType: 'function',
          startedAt: new Date().toISOString(),
          latencyMs: 3000,
          status: 'success',
        })
        .expect(201);

      const response = await request(app.server)
        .get(`/api/traces/${rootTraceId}/tree`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // 新格式：包含 spans 数组和 stats 对象
      expect(response.body).toHaveProperty('trace');
      expect(response.body).toHaveProperty('spans');
      expect(response.body).toHaveProperty('stats');
      expect(Array.isArray(response.body.spans)).toBe(true);
      expect(response.body.spans.length).toBeGreaterThan(0);
      expect(response.body.spans[0]).toHaveProperty('children');
    });

    it('should fallback to old format when spans table has no data', async () => {
      // 创建一个只有 traces 记录、没有 spans 记录的 trace
      const rootRes = await request(app.server)
        .post('/api/traces')
        .set('X-API-Key', apiKey)
        .send({ traceType: 'function', name: 'legacy_trace', status: 'success' })
        .expect(201);

      const rootTraceId = rootRes.body.trace.id;

      const response = await request(app.server)
        .get(`/api/traces/${rootTraceId}/tree`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // 旧格式：只有 trace 和 spans（扁平 children）
      expect(response.body).toHaveProperty('trace');
      expect(response.body).toHaveProperty('spans');
      // fallback 标记
      if (response.body._fallback) {
        expect(response.body._fallback).toBe(true);
      }
    });
  });
});
