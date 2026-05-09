import request from 'supertest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';

describe('Traces API', () => {
  let app: FastifyInstance;
  let apiKey: string;
  let projectId: string;
  let authToken: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const testEmail = `test-traces-${Date.now()}@example.com`;
    const registerResponse = await request(app.server)
      .post('/api/auth/register')
      .send({
        email: testEmail,
        password: 'Test123456!',
        name: 'Trace Test User'
      });

    authToken = registerResponse.body.token;

    const projectResponse = await request(app.server)
      .post('/api/projects')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        name: 'Trace Test Project'
      });

    projectId = projectResponse.body.id;

    const keyResponse = await request(app.server)
      .post('/api/apikeys')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        project_id: projectId,
        name: 'Trace Test Key'
      });

    apiKey = keyResponse.body.key;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/traces', () => {
    it('应该成功创建 trace', async () => {
      const response = await request(app.server)
        .post('/api/traces')
        .set('X-API-Key', apiKey)
        .send({
          traceType: 'llm',
          name: 'test-trace',
          input: { prompt: 'hello' },
          output: { content: 'world' },
          status: 'success',
        })
        .expect(201);

      expect(response.body).toHaveProperty('trace');
      expect(response.body.trace.name).toBe('test-trace');
    });

    it('应该接受 OTel 标识符', async () => {
      const response = await request(app.server)
        .post('/api/traces')
        .set('X-API-Key', apiKey)
        .send({
          traceType: 'llm',
          name: 'otel-trace',
          traceId: 'abc123',
          spanId: 'span456',
          parentSpanId: 'parent789',
          status: 'success',
        })
        .expect(201);

      expect(response.body.trace.trace_id).toBe('abc123');
      expect(response.body.trace.span_id).toBe('span456');
      expect(response.body.trace.parent_span_id).toBe('parent789');
    });
  });

  describe('POST /api/traces/otel-export', () => {
    it('应该导入 OTel spans 并创建 traces', async () => {
      const response = await request(app.server)
        .post('/api/traces/otel-export')
        .set('X-API-Key', apiKey)
        .send({
          resourceSpans: [{
            scopeSpans: [{
              spans: [
                {
                  traceId: 'otel-trace-1',
                  spanId: 'otel-span-1',
                  name: 'llm-completion',
                  kind: 'INTERNAL',
                  startTimeUnixNano: String(Date.now() * 1000000),
                  endTimeUnixNano: String((Date.now() + 100) * 1000000),
                  attributes: [
                    { key: 'trace.type', value: { stringValue: 'llm' } },
                    { key: 'llm.latency_ms', value: { intValue: 100 } },
                  ],
                  status: { code: 'OK' },
                },
                {
                  traceId: 'otel-trace-2',
                  spanId: 'otel-span-2',
                  name: 'tool-call',
                  kind: 'INTERNAL',
                  startTimeUnixNano: String(Date.now() * 1000000),
                  attributes: [
                    { key: 'trace.type', value: { stringValue: 'tool' } },
                  ],
                  status: { code: 'ERROR', message: 'tool failed' },
                  events: [{
                    name: 'exception',
                    timeUnixNano: String(Date.now() * 1000000),
                    attributes: [{ key: 'exception.message', value: { stringValue: 'connection timeout' } }],
                  }],
                },
              ],
            }],
          }],
        })
        .expect(201);

      expect(response.body.imported).toBe(2);
      expect(response.body.traceIds).toHaveLength(2);
    });

    it('应该拒绝无 API Key 的请求', async () => {
      await request(app.server)
        .post('/api/traces/otel-export')
        .send({ resourceSpans: [] })
        .expect(401);
    });
  });

  describe('GET /api/traces/:id/otel', () => {
    it('应该以 OTel 格式导出 trace', async () => {
      const createRes = await request(app.server)
        .post('/api/traces')
        .set('X-API-Key', apiKey)
        .send({
          traceType: 'llm',
          name: 'export-test',
          input: { prompt: 'hello' },
          output: { content: 'world' },
          status: 'success',
          traceId: 'export-trace-1',
          spanId: 'export-span-1',
        })
        .expect(201);

      const traceId = createRes.body.trace.id;

      const response = await request(app.server)
        .get(`/api/traces/${traceId}/otel`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.span).toHaveProperty('traceId', 'export-trace-1');
      expect(response.body.span).toHaveProperty('spanId', 'export-span-1');
      expect(response.body.span).toHaveProperty('name', 'export-test');
      expect(response.body.span.status.code).toBe('OK');
      expect(response.body.span.attributes['trace.type']).toBe('llm');
    });
  });

  describe('GET /api/traces/:id/tree', () => {
    it('应该返回 trace 树', async () => {
      const parentRes = await request(app.server)
        .post('/api/traces')
        .set('X-API-Key', apiKey)
        .send({
          traceType: 'llm',
          name: 'parent-trace',
          status: 'success',
        })
        .expect(201);

      const parentId = parentRes.body.trace.id;

      await request(app.server)
        .post('/api/traces')
        .set('X-API-Key', apiKey)
        .send({
          traceType: 'tool',
          name: 'child-trace',
          parentTraceId: parentId,
          status: 'success',
        })
        .expect(201);

      const response = await request(app.server)
        .get(`/api/traces/${parentId}/tree`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('trace');
      // 路由返回 spans 而非 children
      expect(response.body).toHaveProperty('spans');
      expect(response.body.spans.length).toBeGreaterThan(0);
    });
  });

  describe('Prompt ↔ Trace Linkage', () => {
    it('创建 trace 时应支持 prompt_id 和 prompt_version_id', async () => {
      // Create a prompt first via auth (not api key)
      const promptRes = await request(app.server)
        .post('/api/prompts')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          project_id: projectId,
          name: 'Test Prompt',
          content: 'Hello {{input}}',
        })
        .expect(201);

      const promptId = promptRes.body.id;
      const versionId = promptRes.body.current_version_id;

      const response = await request(app.server)
        .post('/api/traces')
        .set('X-API-Key', apiKey)
        .send({
          traceType: 'llm',
          name: 'prompt-linked-trace',
          promptId,
          promptVersionId: versionId,
          status: 'success',
        })
        .expect(201);

      expect(response.body.trace.prompt_id).toBe(promptId);
      expect(response.body.trace.prompt_version_id).toBe(versionId);
    });

    it('PATCH trace 时应支持更新 prompt 关联', async () => {
      const createRes = await request(app.server)
        .post('/api/traces')
        .set('X-API-Key', apiKey)
        .send({
          traceType: 'llm',
          name: 'update-prompt-test',
          status: 'success',
        })
        .expect(201);

      const traceId = createRes.body.trace.id;

      const promptRes = await request(app.server)
        .post('/api/prompts')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          project_id: projectId,
          name: 'Another Prompt',
          content: 'Test',
        })
        .expect(201);

      const promptId = promptRes.body.id;

      const response = await request(app.server)
        .patch(`/api/traces/${traceId}`)
        .set('X-API-Key', apiKey)
        .send({
          promptId,
        })
        .expect(200);

      expect(response.body.trace.prompt_id).toBe(promptId);
    });
  });
});
