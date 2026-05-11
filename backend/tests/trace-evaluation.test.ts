import { vi, describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';

// Mock callLLM to avoid real API calls during tests
vi.mock('../src/services/llm-client.js', async () => {
  const actual = await vi.importActual<typeof import('../src/services/llm-client.js')>('../src/services/llm-client.js');
  return {
    ...actual,
    callLLM: vi.fn(),
  };
});

import { callLLM } from '../src/services/llm-client.js';

describe('Trace Trajectory Evaluation', () => {
  let app: FastifyInstance;
  let authToken: string;
  let projectId: string;
  let modelConfigId: string;
  let traceId: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const testEmail = `test-trajectory-${Date.now()}@example.com`;
    const registerResponse = await request(app.server)
      .post('/api/auth/register')
      .send({ email: testEmail, password: 'Test123456!', name: 'Trajectory Test User' });
    authToken = registerResponse.body.token;

    const projectResponse = await request(app.server)
      .post('/api/projects')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'Trajectory Test Project' });
    projectId = projectResponse.body.id;

    // Create model config
    const cfgRes = await request(app.server)
      .post('/api/model-configs')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        project_id: projectId,
        name: 'Judge Model',
        provider: 'openai',
        model: 'gpt-4',
        api_key: 'sk-test-key',
        base_url: 'https://api.openai.com/v1',
      })
      .expect(201);
    modelConfigId = cfgRes.body.id;

    // Create a trace with child spans via OTel export
    const otelResponse = await request(app.server)
      .post('/api/traces/otel-export')
      .set('x-api-key', await getApiKey())
      .send({
        resourceSpans: [{
          scopeSpans: [{
            spans: [
              {
                traceId: 'trace-001',
                spanId: 'span-root',
                name: 'agent.run',
                kind: 'INTERNAL',
                startTimeUnixNano: String(Date.now() * 1000000),
                endTimeUnixNano: String((Date.now() + 500) * 1000000),
                attributes: [
                  { key: 'trace.type', value: { stringValue: 'agent' } },
                  { key: 'trace.session_id', value: { stringValue: 'session-001' } },
                  { key: 'llm.input', value: { stringValue: 'Search for latest AI news' } },
                  { key: 'llm.output', value: { stringValue: 'Here are the latest AI news...' } },
                ],
                status: { code: 'OK' },
              },
              {
                traceId: 'trace-001',
                spanId: 'span-tool',
                parentSpanId: 'span-root',
                name: 'tool.search_web',
                kind: 'INTERNAL',
                startTimeUnixNano: String((Date.now() + 100) * 1000000),
                endTimeUnixNano: String((Date.now() + 300) * 1000000),
                attributes: [
                  { key: 'trace.type', value: { stringValue: 'tool' } },
                  { key: 'llm.input', value: { stringValue: '{"query": "latest AI news"}' } },
                  { key: 'llm.output', value: { stringValue: '{"results": [...]}' } },
                ],
                status: { code: 'OK' },
              },
            ],
          }],
        }],
      })
      .expect(201);

    // Find the created trace via OTel response
    const otelBody = otelResponse.body;
    expect(otelBody.imported).toBeGreaterThan(0);
    traceId = otelBody.traceIds[0];
  }, 30000);

  afterAll(async () => {
    await app.close();
  }, 30000);

  async function getApiKey(): Promise<string> {
    const res = await request(app.server)
      .post('/api/apikeys')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ project_id: projectId, name: 'Test Key' })
      .expect(201);
    return res.body.key;
  }

  describe('POST /api/traces/:id/trajectory-eval', () => {
    it('should evaluate agent trajectory with 4 dimensions', async () => {
      const mockedCallLLM = vi.mocked(callLLM);
      mockedCallLLM.mockResolvedValueOnce({
        content: JSON.stringify({
          dimensions: [
            { name: 'tool_selection', score: 0.9, reasoning: 'Correctly chose search tool' },
            { name: 'parameter_correctness', score: 0.85, reasoning: 'Query parameter was appropriate' },
            { name: 'task_completion', score: 0.8, reasoning: 'Task completed successfully' },
            { name: 'trajectory_quality', score: 0.75, reasoning: 'Efficient execution path' },
          ],
          overall_score: 0.825,
          overall_reasoning: 'Good overall performance',
        }),
      });

      const response = await request(app.server)
        .post(`/api/traces/${traceId}/trajectory-eval`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          model_config_id: modelConfigId,
          user_request: 'Search for latest AI news',
          expected_outcome: 'Should return relevant AI news articles',
        })
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body.trace_id).toBeTruthy();
      expect(response.body.evaluator).toBe('trajectory_llm_judge');
      expect(response.body.score).toBe(0.825);
      expect(response.body.passed).toBe(true);
      expect(Array.isArray(response.body.dimensions)).toBe(true);
      expect(response.body.dimensions.length).toBe(4);

      const dimNames = response.body.dimensions.map((d: any) => d.name);
      expect(dimNames).toContain('tool_selection');
      expect(dimNames).toContain('parameter_correctness');
      expect(dimNames).toContain('task_completion');
      expect(dimNames).toContain('trajectory_quality');

      expect(response.body.details).toHaveProperty('span_count');
      expect(response.body.details).toHaveProperty('error_count');
    });

    it('should reject unauthorized requests', async () => {
      await request(app.server)
        .post(`/api/traces/${traceId}/trajectory-eval`)
        .send({ model_config_id: modelConfigId })
        .expect(401);
    });

    it('should return 404 for non-existent trace', async () => {
      await request(app.server)
        .post('/api/traces/nonexistent/trajectory-eval')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ model_config_id: modelConfigId })
        .expect(404);
    });
  });

  describe('GET /api/traces/:id/trajectory-eval', () => {
    it('should return trajectory evaluation results', async () => {
      const response = await request(app.server)
        .get(`/api/traces/${traceId}/trajectory-eval`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('evaluations');
      expect(Array.isArray(response.body.evaluations)).toBe(true);
      expect(response.body.evaluations.length).toBeGreaterThan(0);
    });
  });
});
