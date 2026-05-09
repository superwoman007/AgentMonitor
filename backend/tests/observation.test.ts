import request from 'supertest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';

describe('Observation Center API', () => {
  let app: FastifyInstance;
  let authToken: string;
  let apiKey: string;
  let projectId: string;
  let sessionId: string;
  let parentTraceId: string;
  let childTraceId: string;
  const testEmail = `test-observation-${Date.now()}@example.com`;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    // Register and login
    const registerResponse = await request(app.server)
      .post('/api/auth/register')
      .send({
        email: testEmail,
        password: 'Test123456!',
        name: 'Observation Test User'
      });

    authToken = registerResponse.body.token;

    // Create project
    const projectResponse = await request(app.server)
      .post('/api/projects')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        name: 'Observation Test Project',
        description: 'For observation center testing'
      });

    projectId = projectResponse.body.id;

    // Create API key for agent-side operations
    const keyResponse = await request(app.server)
      .post('/api/apikeys')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        project_id: projectId,
        name: 'Observation Test Key'
      });

    apiKey = keyResponse.body.key;

    // Create session via API key
    const sessionResponse = await request(app.server)
      .post('/api/sessions')
      .set('X-API-Key', apiKey)
      .send({
        session_id: `session-${Date.now()}`,
        metadata: { agent: 'test-agent' }
      });

    sessionId = sessionResponse.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  // ==================== Trace Tree / Parent-Child ====================
  describe('Trace Tree', () => {
    it('should create a parent trace', async () => {
      const response = await request(app.server)
        .post('/api/traces')
        .set('X-API-Key', apiKey)
        .send({
          sessionId: sessionId,
          traceType: 'agent_execution',
          name: 'Agent Run #1',
          input: { query: 'Hello' },
          status: 'success'
        })
        .expect(201);

      expect(response.body.trace).toHaveProperty('id');
      parentTraceId = response.body.trace.id;
    });

    it('should create a child trace linked to parent', async () => {
      const response = await request(app.server)
        .post('/api/traces')
        .set('X-API-Key', apiKey)
        .send({
          sessionId: sessionId,
          parentTraceId: parentTraceId,
          traceType: 'llm_call',
          name: 'LLM Completion',
          input: { prompt: 'Hello' },
          output: { content: 'Hi there!' },
          latencyMs: 1200,
          status: 'success'
        })
        .expect(201);

      expect(response.body.trace).toHaveProperty('id');
      expect(response.body.trace.parent_trace_id).toBe(parentTraceId);
      childTraceId = response.body.trace.id;
    });

    it('should get trace tree by parent id', async () => {
      const response = await request(app.server)
        .get(`/api/traces/${parentTraceId}/tree`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.trace).toHaveProperty('id', parentTraceId);
      // 路由返回 spans 数组（span 树格式），而非 children
      expect(response.body.spans).toBeDefined();
      expect(Array.isArray(response.body.spans)).toBe(true);
      expect(response.body.spans.length).toBeGreaterThanOrEqual(1);
    });

    it('should list traces with parent_trace_id filter', async () => {
      const response = await request(app.server)
        .get('/api/traces')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ projectId, parentTraceId })
        .expect(200);

      expect(response.body.traces).toBeInstanceOf(Array);
      expect(response.body.traces.length).toBeGreaterThanOrEqual(1);
      expect(response.body.traces.some((t: any) => t.id === childTraceId)).toBe(true);
    });
  });

  // ==================== Tool Calls ====================
  describe('Tool Calls', () => {
    it('should create a tool call', async () => {
      const response = await request(app.server)
        .post('/api/tool-calls')
        .set('X-API-Key', apiKey)
        .send({
          sessionId: sessionId,
          toolName: 'search',
          input: { query: 'weather in Beijing' },
          status: 'pending'
        })
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body.tool_name).toBe('search');
    });

    it('should list tool calls for a session', async () => {
      const response = await request(app.server)
        .get('/api/tool-calls')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ session_id: sessionId })
        .expect(200);

      expect(response.body.tool_calls).toBeInstanceOf(Array);
      expect(response.body.tool_calls.length).toBeGreaterThanOrEqual(1);
    });

    it('should update tool call with output', async () => {
      const createResponse = await request(app.server)
        .post('/api/tool-calls')
        .set('X-API-Key', apiKey)
        .send({
          sessionId: sessionId,
          toolName: 'calculator',
          input: { expression: '1+1' },
          status: 'pending'
        })
        .expect(201);

      const toolCallId = createResponse.body.id;

      const updateResponse = await request(app.server)
        .patch(`/api/tool-calls/${toolCallId}`)
        .set('X-API-Key', apiKey)
        .send({
          output: { result: 2 },
          status: 'success',
          endedAt: new Date().toISOString()
        })
        .expect(200);

      expect(updateResponse.body.output).toEqual({ result: 2 });
      expect(updateResponse.body.status).toBe('success');
    });
  });

  // ==================== Session Timeline ====================
  describe('Session Timeline', () => {
    beforeAll(async () => {
      // Add a message to session for timeline testing
      await request(app.server)
        .post(`/api/sessions/${sessionId}/messages`)
        .set('X-API-Key', apiKey)
        .send({
          role: 'user',
          content: 'What is the weather?',
          timestamp: new Date().toISOString()
        })
        .expect(201);
    });

    it('should get session timeline with messages, traces and tool_calls', async () => {
      const response = await request(app.server)
        .get(`/api/sessions/${sessionId}/timeline`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.timeline).toBeInstanceOf(Array);
      expect(response.body.timeline.length).toBeGreaterThanOrEqual(1);

      // Check that timeline items have required fields
      const items = response.body.timeline;
      const hasMessage = items.some((item: any) => item.type === 'message');
      const hasTrace = items.some((item: any) => item.type === 'trace');
      const hasToolCall = items.some((item: any) => item.type === 'tool_call');

      expect(hasMessage).toBe(true);
      expect(hasTrace).toBe(true);
      expect(hasToolCall).toBe(true);

      // Check ordering by timestamp
      for (let i = 1; i < items.length; i++) {
        expect(new Date(items[i].timestamp).getTime()).toBeGreaterThanOrEqual(
          new Date(items[i - 1].timestamp).getTime()
        );
      }
    });

    it('should return 404 for non-existent session timeline', async () => {
      await request(app.server)
        .get('/api/sessions/non-existent-id/timeline')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });
  });

  // ==================== Observation Stats ====================
  describe('Observation Stats', () => {
    it('should get enhanced observation stats', async () => {
      const response = await request(app.server)
        .get('/api/stats/observation')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ project_id: projectId })
        .expect(200);

      expect(response.body).toHaveProperty('totalTraces');
      expect(response.body).toHaveProperty('totalSessions');
      expect(response.body).toHaveProperty('totalToolCalls');
      expect(response.body).toHaveProperty('traceTypeBreakdown');
      expect(response.body).toHaveProperty('avgLatency');
      expect(response.body).toHaveProperty('successRate');
      expect(response.body).toHaveProperty('topTools');
      expect(response.body.traceTypeBreakdown).toBeInstanceOf(Array);
    });
  });

  // ==================== Trace Detail Enhancements ====================
  describe('Trace Detail', () => {
    it('should get trace with child count', async () => {
      const response = await request(app.server)
        .get(`/api/traces/${parentTraceId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.trace).toHaveProperty('id', parentTraceId);
      // The enhanced trace detail should include child_count
      expect(response.body).toHaveProperty('childCount');
      expect(response.body.childCount).toBeGreaterThanOrEqual(1);
    });
  });
});
