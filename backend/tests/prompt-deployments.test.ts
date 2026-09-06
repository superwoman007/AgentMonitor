import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';

describe('PR-12：Prompt Deployment 与 Runtime API', () => {
  let app: FastifyInstance;
  let authToken: string;
  let projectId: string;
  let promptId: string;
  let v1Id: string;
  let v2Id: string;

  const auth = (): Record<string, string> => ({ Authorization: `Bearer ${authToken}` });

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const email = `pr12-${Date.now()}@example.com`;
    const register = await request(app.server)
      .post('/api/auth/register')
      .send({ email, password: 'Test12345678!', name: 'PR12' })
      .expect(201);
    authToken = register.body.token;

    const project = await request(app.server)
      .post('/api/projects')
      .set(auth())
      .send({ name: 'PR12 Project' })
      .expect(201);
    projectId = project.body.id;

    const prompt = await request(app.server)
      .post('/api/prompts')
      .set(auth())
      .send({
        project_id: projectId,
        name: 'refund-agent',
        description: 'v1',
        content: 'You are a refund agent v1',
        config: { variablesSchema: { type: 'object', properties: { query: { type: 'string' } } }, modelDefaults: { temperature: 0.2 } },
      })
      .expect(201);
    promptId = prompt.body.id;
    const v1 = await request(app.server)
      .get(`/api/prompts/${promptId}/versions`)
      .set(auth());
    v1Id = v1.body[0].id;

    const v2 = await request(app.server)
      .post(`/api/prompts/${promptId}/versions`)
      .set(auth())
      .send({ content: 'You are a refund agent v2', description: 'candidate' })
      .expect(201);
    v2Id = v2.body.version.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /prompt-deployments/environments 返回合法环境列表', async () => {
    const res = await request(app.server)
      .get('/api/v2/prompt-deployments/environments')
      .set(auth())
      .expect(200);
    expect(res.body.environments).toEqual(expect.arrayContaining(['production', 'staging', 'development']));
  });

  it('PUT /prompt-deployments/:id 发布版本并可通过 GET 读取', async () => {
    const put = await request(app.server)
      .put(`/api/v2/prompt-deployments/${promptId}`)
      .set(auth())
      .send({ projectId, promptVersionId: v1Id, environment: 'production', note: '首发' })
      .expect(200);
    expect(put.body.deployment.prompt_version_id).toBe(v1Id);
    expect(put.body.deployment.environment).toBe('production');

    const get = await request(app.server)
      .get(`/api/v2/prompt-deployments/${promptId}?environment=production`)
      .set(auth())
      .expect(200);
    expect(get.body.deployment.prompt_version_id).toBe(v1Id);
  });

  it('GET /runtime/prompts/:name 返回发布版本内容、ETag 与 variablesSchema', async () => {
    const res = await request(app.server)
      .get('/api/v2/runtime/prompts/refund-agent?environment=production')
      .set('X-Project-Id', projectId)
      .set(auth())
      .expect(200);
    expect(res.body.promptId).toBe(promptId);
    expect(res.body.promptVersionId).toBe(v1Id);
    expect(res.body.content).toContain('v1');
    expect(res.body.variablesSchema).toBeTruthy();
    expect(res.body.modelDefaults).toEqual({ temperature: 0.2 });
    expect(res.headers.etag).toBeTruthy();

    // If-None-Match 命中返回 304
    await request(app.server)
      .get('/api/v2/runtime/prompts/refund-agent?environment=production')
      .set('X-Project-Id', projectId)
      .set(auth())
      .set('If-None-Match', res.headers.etag as string)
      .expect(304);
  });

  it('发布移动到 v2 后 Runtime 立即返回新内容与新 ETag', async () => {
    await request(app.server)
      .put(`/api/v2/prompt-deployments/${promptId}`)
      .set(auth())
      .send({ projectId, promptVersionId: v2Id, environment: 'production', note: '迭代' })
      .expect(200);

    const res = await request(app.server)
      .get('/api/v2/runtime/prompts/refund-agent?environment=production')
      .set('X-Project-Id', projectId)
      .set(auth())
      .expect(200);
    expect(res.body.promptVersionId).toBe(v2Id);
    expect(res.body.versionNumber).toBe(2);
    expect(res.body.content).toContain('v2');
  });

  it('未发布到 staging 时 Runtime 返回 404；非法 environment 返回 400', async () => {
    await request(app.server)
      .get('/api/v2/runtime/prompts/refund-agent?environment=staging')
      .set('X-Project-Id', projectId)
      .set(auth())
      .expect(404);

    await request(app.server)
      .put(`/api/v2/prompt-deployments/${promptId}`)
      .set(auth())
      .send({ projectId, promptVersionId: v1Id, environment: 'prod' })
      .expect(400);
  });

  it('DELETE /prompt-deployments/:id 下线环境后 Runtime 404', async () => {
    await request(app.server)
      .delete(`/api/v2/prompt-deployments/${promptId}?projectId=${projectId}&environment=production`)
      .set(auth())
      .expect(204);

    await request(app.server)
      .get('/api/v2/runtime/prompts/refund-agent?environment=production')
      .set('X-Project-Id', projectId)
      .set(auth())
      .expect(404);
  });
});
