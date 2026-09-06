import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';

describe('Integration Status API (PR-04)', () => {
  let app: FastifyInstance;
  let authToken: string;
  let projectId: string;
  let apiKey: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const testEmail = `test-integration-${Date.now()}@example.com`;
    const registerResponse = await request(app.server)
      .post('/api/auth/register')
      .send({ email: testEmail, password: 'Test12345678!', name: 'Integration Status User' })
      .expect(201);
    authToken = registerResponse.body.token;

    const projectResponse = await request(app.server)
      .post('/api/projects')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'Integration Status Project' })
      .expect(201);
    projectId = projectResponse.body.id;

    const keyResponse = await request(app.server)
      .post('/api/apikeys')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ project_id: projectId, name: 'Integration Key' })
      .expect(201);
    apiKey = keyResponse.body.key;
  });

  afterAll(async () => {
    await app.close();
  });

  it('未收到事件时返回 disconnected 状态', async () => {
    const response = await request(app.server)
      .get(`/api/v2/projects/${projectId}/integration-status`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(response.body.connected).toBe(false);
    expect(response.body.traceCount).toBe(0);
    expect(response.body.lastEventAt).toBeNull();
    expect(response.body.sampleTraceId).toBeNull();
    expect(response.body.hooks).toEqual({
      agent: false,
      llm: false,
      tool: false,
      retrieval: false,
      decision: false,
    });
  });

  it('收到完整 Agent 链路后返回 connected、Hook 覆盖、SDK 与字段完整度', async () => {
    const traceId = `integration-trace-${Date.now()}`;
    const rootSpanId = `integration-root-${Date.now()}`;
    const llmSpanId = `integration-llm-${Date.now()}`;
    const toolSpanId = `integration-tool-${Date.now()}`;

    await request(app.server)
      .post('/api/v2/telemetry/batch')
      .set('X-API-Key', apiKey)
      .send({
        events: [
          {
            schemaVersion: '2.0',
            eventId: `evt-agent-${Date.now()}`,
            eventType: 'trace.start',
            occurredAt: new Date().toISOString(),
            context: { traceId, spanId: rootSpanId, sessionId: `session-${Date.now()}` },
            payload: {
              name: 'agent.run',
              traceType: 'agent',
              status: 'pending',
              input: { message: 'hello' },
              metadata: {
                'sdk.language': 'typescript',
                'sdk.version': '2.0.0',
                'sdk.frameworks': ['langgraph'],
                'agent.version': '1.2.3',
              },
            },
          },
          {
            schemaVersion: '2.0',
            eventId: `evt-llm-${Date.now()}`,
            eventType: 'span.end',
            occurredAt: new Date().toISOString(),
            context: { traceId, spanId: llmSpanId, parentSpanId: rootSpanId },
            payload: {
              name: 'llm.chat',
              traceType: 'llm',
              status: 'ok',
              output: { content: 'world' },
              attributes: {
                tokens: { prompt: 12, completion: 8, total: 20 },
                model: 'gpt-4o-mini',
              },
            },
          },
          {
            schemaVersion: '2.0',
            eventId: `evt-tool-${Date.now()}`,
            eventType: 'span.end',
            occurredAt: new Date().toISOString(),
            context: { traceId, spanId: toolSpanId, parentSpanId: rootSpanId },
            payload: {
              name: 'tool.search_web',
              traceType: 'tool',
              status: 'ok',
              output: { results: [] },
            },
          },
          {
            schemaVersion: '2.0',
            eventId: `evt-agent-end-${Date.now()}`,
            eventType: 'trace.end',
            occurredAt: new Date().toISOString(),
            context: { traceId, spanId: rootSpanId },
            payload: {
              name: 'agent.run',
              traceType: 'agent',
              status: 'ok',
              output: { answer: 'world' },
            },
          },
        ],
      })
      .expect(202);

    const response = await request(app.server)
      .get(`/api/v2/projects/${projectId}/integration-status`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(response.body.connected).toBe(true);
    expect(response.body.traceCount).toBeGreaterThanOrEqual(1);
    expect(response.body.lastEventAt).toBeTruthy();
    expect(response.body.sampleTraceId).toBeTruthy();
    expect(response.body.detectedSdk).toEqual({
      language: 'typescript',
      version: '2.0.0',
      frameworks: ['langgraph'],
    });
    expect(response.body.hooks.agent).toBe(true);
    expect(response.body.hooks.llm).toBe(true);
    expect(response.body.hooks.tool).toBe(true);
    expect(response.body.fieldCompleteness.parentSpanId).toBeGreaterThan(0);
    expect(response.body.fieldCompleteness.tokenUsage).toBe(1);
    expect(response.body.fieldCompleteness.agentVersion).toBe(1);

    const codes = response.body.warnings.map((w: { code: string }) => w.code);
    expect(codes).not.toContain('MISSING_AGENT_SPAN');
    expect(codes).not.toContain('MISSING_LLM_SPAN');
    expect(codes).not.toContain('MISSING_TOOL_SPAN');
  });

  it('无权访问其他项目的 integration-status', async () => {
    const otherEmail = `integration-other-${Date.now()}@example.com`;
    const otherRegister = await request(app.server)
      .post('/api/auth/register')
      .send({ email: otherEmail, password: 'Test12345678!', name: 'Other User' })
      .expect(201);

    await request(app.server)
      .get(`/api/v2/projects/${projectId}/integration-status`)
      .set('Authorization', `Bearer ${otherRegister.body.token}`)
      .expect(404);
  });
});
