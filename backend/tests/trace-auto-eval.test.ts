import request from 'supertest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';

describe('Trace Auto-Eval API', () => {
  let app: FastifyInstance;
  let authToken: string;
  let projectId: string;
  let apiKey: string;
  let traceId: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const testEmail = `test-auto-eval-${Date.now()}@example.com`;
    const registerResponse = await request(app.server)
      .post('/api/auth/register')
      .send({ email: testEmail, password: 'Test123456!', name: 'Auto Eval Test User' });

    authToken = registerResponse.body.token;

    const projectResponse = await request(app.server)
      .post('/api/projects')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'Auto Eval Test Project' });

    projectId = projectResponse.body.id;

    const keyResponse = await request(app.server)
      .post('/api/apikeys')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ project_id: projectId, name: 'Auto Eval Test Key' });

    apiKey = keyResponse.body.key;

    // Create a trace
    const traceRes = await request(app.server)
      .post('/api/traces')
      .set('X-API-Key', apiKey)
      .send({ traceType: 'llm', name: 'test-llm', input: { prompt: 'hi' }, output: { content: 'hello' }, status: 'success' })
      .expect(201);

    traceId = traceRes.body.trace.id;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/traces/:id/eval', () => {
    it('should add eval result to a trace', async () => {
      const response = await request(app.server)
        .post(`/api/traces/${traceId}/eval`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          evaluator: 'exact_match',
          score: 0.85,
          passed: 1,
          details: { matched: true },
        })
        .expect(201);

      expect(response.body).toHaveProperty('evalResult');
      expect(response.body.evalResult.score).toBe(0.85);
      expect(response.body.evalResult.passed).toBe(1);
    });

    it('should reject invalid score', async () => {
      await request(app.server)
        .post(`/api/traces/${traceId}/eval`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ score: -1 })
        .expect(400);
    });

    it('should reject unauthorized', async () => {
      await request(app.server)
        .post(`/api/traces/${traceId}/eval`)
        .send({ score: 0.5 })
        .expect(401);
    });
  });

  describe('GET /api/traces/:id/evaluations', () => {
    it('should return trace eval results', async () => {
      const response = await request(app.server)
        .get(`/api/traces/${traceId}/evaluations`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('evaluations');
      expect(Array.isArray(response.body.evaluations)).toBe(true);
      expect(response.body.evaluations.length).toBeGreaterThan(0);
    });
  });

  describe('GET /api/traces with eval filter', () => {
    it('should support filtering by eval_status', async () => {
      const response = await request(app.server)
        .get(`/api/traces?projectId=${projectId}&evalStatus=needs_attention`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('traces');
      // The trace we created has score 0.85 (passed), so should not appear in needs_attention
      expect(response.body.traces.length).toBe(0);
    });
  });
});
