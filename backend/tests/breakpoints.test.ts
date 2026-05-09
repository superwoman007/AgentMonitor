import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { buildApp } from '../src/app.js';
import type { FastifyInstance } from 'fastify';

describe('Breakpoints API', () => {
  let app: FastifyInstance;
  let authToken: string;
  let projectId: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    // Register a test user
    const registerRes = await request(app.server)
      .post('/api/auth/register')
      .send({
        name: 'Breakpoint Test User',
        email: `bp-test-${Date.now()}@example.com`,
        password: 'Test123456!',
      });

    authToken = registerRes.body.token;

    // Create a project
    const projectRes = await request(app.server)
      .post('/api/projects')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'Breakpoint Test Project' });

    projectId = projectRes.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /api/breakpoints - should create a breakpoint', async () => {
    const res = await request(app.server)
      .post('/api/breakpoints')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        projectId,
        name: 'Test Keyword Breakpoint',
        type: 'keyword',
        condition: 'error, fail',
        enabled: true,
      });

    expect(res.status).toBe(201);
    expect(res.body.breakpoint).toBeDefined();
    expect(res.body.breakpoint.name).toBe('Test Keyword Breakpoint');
    expect(res.body.breakpoint.type).toBe('keyword');
    expect(res.body.breakpoint.condition).toBe('error, fail');
    expect(!!res.body.breakpoint.enabled).toBe(true);
    expect(res.body.breakpoint.hit_threshold).toBe(0);
    expect(res.body.breakpoint.hit_count).toBe(0);
  });

  it('POST /api/breakpoints - should create a breakpoint with hit_threshold', async () => {
    const res = await request(app.server)
      .post('/api/breakpoints')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        projectId,
        name: 'Hit Count Breakpoint',
        type: 'keyword',
        condition: 'trigger',
        enabled: true,
        hit_threshold: 3,
      });

    expect(res.status).toBe(201);
    expect(res.body.breakpoint.hit_threshold).toBe(3);
    expect(res.body.breakpoint.hit_count).toBe(0);
  });

  it('GET /api/breakpoints - should list breakpoints', async () => {
    const res = await request(app.server)
      .get(`/api/breakpoints?projectId=${projectId}`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.breakpoints)).toBe(true);
    expect(res.body.breakpoints.length).toBeGreaterThanOrEqual(2);
  });

  it('PUT /api/breakpoints/:id - should update hit_threshold', async () => {
    // Create a breakpoint first
    const createRes = await request(app.server)
      .post('/api/breakpoints')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        projectId,
        name: 'Updatable Breakpoint',
        type: 'latency',
        condition: '1000',
        enabled: true,
      });

    const bpId = createRes.body.breakpoint.id;

    const updateRes = await request(app.server)
      .put(`/api/breakpoints/${bpId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ hit_threshold: 5 });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.breakpoint.hit_threshold).toBe(5);
  });

  it('POST /api/breakpoints/check - keyword breakpoint without hit_threshold triggers immediately', async () => {
    const createRes = await request(app.server)
      .post('/api/breakpoints')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        projectId,
        name: 'Immediate Trigger',
        type: 'keyword',
        condition: 'error',
        enabled: true,
      });

    const bpId = createRes.body.breakpoint.id;

    const checkRes = await request(app.server)
      .post('/api/breakpoints/check')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        projectId,
        context: { content: 'This is an error message' },
      });

    expect(checkRes.status).toBe(200);
    expect(checkRes.body.count).toBeGreaterThanOrEqual(1);
    expect(checkRes.body.triggered.some((bp: any) => bp.id === bpId)).toBe(true);
  });

  it('POST /api/breakpoints/check - hit_threshold breakpoint does not trigger before N hits', async () => {
    const createRes = await request(app.server)
      .post('/api/breakpoints')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        projectId,
        name: '3-Hit Breakpoint',
        type: 'keyword',
        condition: 'trigger',
        enabled: true,
        hit_threshold: 3,
      });

    const bpId = createRes.body.breakpoint.id;

    // First check - should not trigger
    const check1 = await request(app.server)
      .post('/api/breakpoints/check')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        projectId,
        context: { content: 'trigger word' },
      });
    expect(check1.body.triggered.some((bp: any) => bp.id === bpId)).toBe(false);

    // Second check - should not trigger
    const check2 = await request(app.server)
      .post('/api/breakpoints/check')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        projectId,
        context: { content: 'trigger word' },
      });
    expect(check2.body.triggered.some((bp: any) => bp.id === bpId)).toBe(false);

    // Third check - should trigger
    const check3 = await request(app.server)
      .post('/api/breakpoints/check')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        projectId,
        context: { content: 'trigger word' },
      });
    expect(check3.body.triggered.some((bp: any) => bp.id === bpId)).toBe(true);
  });

  it('POST /api/breakpoints/check - hit_threshold resets after trigger', async () => {
    const createRes = await request(app.server)
      .post('/api/breakpoints')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        projectId,
        name: 'Reset After Trigger',
        type: 'keyword',
        condition: 'reset',
        enabled: true,
        hit_threshold: 2,
      });

    const bpId = createRes.body.breakpoint.id;

    // Hit 1 - no trigger
    await request(app.server)
      .post('/api/breakpoints/check')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ projectId, context: { content: 'reset test' } });

    // Hit 2 - triggers
    const check2 = await request(app.server)
      .post('/api/breakpoints/check')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ projectId, context: { content: 'reset test' } });
    expect(check2.body.triggered.some((bp: any) => bp.id === bpId)).toBe(true);

    // Hit 3 (after reset) - should NOT trigger again because count reset
    const check3 = await request(app.server)
      .post('/api/breakpoints/check')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ projectId, context: { content: 'reset test' } });
    expect(check3.body.triggered.some((bp: any) => bp.id === bpId)).toBe(false);
  });

  it('DELETE /api/breakpoints/:id - should delete breakpoint', async () => {
    const createRes = await request(app.server)
      .post('/api/breakpoints')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        projectId,
        name: 'Deletable Breakpoint',
        type: 'error',
        condition: 'timeout',
        enabled: true,
      });

    const bpId = createRes.body.breakpoint.id;

    const deleteRes = await request(app.server)
      .delete(`/api/breakpoints/${bpId}`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(deleteRes.status).toBe(204);

    const getRes = await request(app.server)
      .get(`/api/breakpoints/${bpId}`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(getRes.status).toBe(404);
  });

  it('POST /api/breakpoints/:id/toggle - should toggle enabled state', async () => {
    const createRes = await request(app.server)
      .post('/api/breakpoints')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        projectId,
        name: 'Toggle Breakpoint',
        type: 'latency',
        condition: '500',
        enabled: true,
      });

    const bpId = createRes.body.breakpoint.id;
    expect(!!createRes.body.breakpoint.enabled).toBe(true);

    const toggleRes = await request(app.server)
      .post(`/api/breakpoints/${bpId}/toggle`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(toggleRes.status).toBe(200);
    expect(!!toggleRes.body.breakpoint.enabled).toBe(false);
  });
});
