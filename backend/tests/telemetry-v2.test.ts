import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { query, queryOne } from '../src/db/index.js';

describe('Telemetry V2 API (PR-02)', () => {
  let app: FastifyInstance;
  let authToken: string;
  let projectId: string;
  let apiKey: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const testEmail = `test-telemetry-v2-${Date.now()}@example.com`;
    const registerResponse = await request(app.server)
      .post('/api/auth/register')
      .send({ email: testEmail, password: 'Test12345678!', name: 'Telemetry V2 Test User' })
      .expect(201);
    authToken = registerResponse.body.token;

    const projectResponse = await request(app.server)
      .post('/api/projects')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'Telemetry V2 Test Project' })
      .expect(201);
    projectId = projectResponse.body.id;

    const keyResponse = await request(app.server)
      .post('/api/apikeys')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ project_id: projectId, name: 'Telemetry V2 Key' })
      .expect(201);
    apiKey = keyResponse.body.key;
  });

  afterAll(async () => {
    await app.close();
  });

  it('should upsert span.start and span.end into one span row', async () => {
    const traceId = `trace_v2_${Date.now()}`;
    const spanId = `span_v2_${Date.now()}`;

    const response = await request(app.server)
      .post('/api/v2/telemetry/batch')
      .set('X-API-Key', apiKey)
      .send({
        events: [
          {
            schemaVersion: '2.0',
            eventId: `evt_start_${Date.now()}`,
            eventType: 'span.start',
            occurredAt: '2026-08-23T12:00:00.000Z',
            context: { traceId, spanId },
            payload: {
              name: 'planner',
              traceType: 'planner',
              input: { task: 'plan' },
              attributes: { step: 1 },
            },
          },
          {
            schemaVersion: '2.0',
            eventId: `evt_end_${Date.now()}`,
            eventType: 'span.end',
            occurredAt: '2026-08-23T12:00:01.500Z',
            context: { traceId, spanId },
            payload: {
              name: 'planner',
              traceType: 'planner',
              output: { result: 'done' },
              status: 'ok',
              latencyMs: 1500,
            },
          },
        ],
      })
      .expect(202);

    expect(response.body.summary.accepted).toBe(2);

    const rows = await query<{ span_id: string }>('SELECT span_id FROM spans WHERE span_id = $1', [spanId]);
    const span = await queryOne<{
      span_id: string;
      status: string;
      ended_at: string | null;
      latency_ms: number | null;
      output: string | null;
    }>('SELECT span_id, status, ended_at, latency_ms, output FROM spans WHERE span_id = $1', [spanId]);

    expect(rows).toHaveLength(1);
    expect(span?.status).toBe('ok');
    expect(span?.ended_at).not.toBeNull();
    expect(span?.latency_ms).toBe(1500);
    expect(span?.output ? JSON.parse(span.output) : null).toEqual({ result: 'done' });
  });

  it('should merge trace.start and trace.end into one root trace', async () => {
    const traceId = `trace_root_${Date.now()}`;
    const spanId = `trace_root_span_${Date.now()}`;

    const response = await request(app.server)
      .post('/api/v2/telemetry/batch')
      .set('X-API-Key', apiKey)
      .send({
        events: [
          {
            schemaVersion: '2.0',
            eventId: `evt_trace_start_${Date.now()}`,
            eventType: 'trace.start',
            occurredAt: '2026-08-23T13:00:00.000Z',
            context: { traceId, spanId },
            payload: {
              name: 'agent_run',
              traceType: 'agent',
              input: { message: 'hello' },
              status: 'pending',
            },
          },
          {
            schemaVersion: '2.0',
            eventId: `evt_trace_end_${Date.now()}`,
            eventType: 'trace.end',
            occurredAt: '2026-08-23T13:00:02.000Z',
            context: { traceId, spanId },
            payload: {
              name: 'agent_run',
              traceType: 'agent',
              output: { answer: 'world' },
              status: 'ok',
              latencyMs: 2000,
            },
          },
        ],
      })
      .expect(202);

    expect(response.body.summary.accepted).toBe(2);

    const rows = await query<{ id: string }>('SELECT id FROM traces WHERE span_id = $1', [spanId]);
    const trace = await queryOne<{
      id: string;
      status: string;
      ended_at: string | null;
      latency_ms: number | null;
      output: string | null;
      project_id: string;
    }>('SELECT id, status, ended_at, latency_ms, output, project_id FROM traces WHERE span_id = $1', [spanId]);

    expect(rows).toHaveLength(1);
    expect(trace?.project_id).toBe(projectId);
    expect(trace?.status).toBe('success');
    expect(trace?.ended_at).not.toBeNull();
    expect(trace?.latency_ms).toBe(2000);
    expect(trace?.output ? JSON.parse(trace.output) : null).toEqual({ answer: 'world' });
  });
});
