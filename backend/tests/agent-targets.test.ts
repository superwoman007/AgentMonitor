import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';

// Mock callLLM 以避免真实网络调用，专注验证 Target 领域行为
vi.mock('../src/services/llm-client.js', () => ({
  callLLM: vi.fn(async () => ({
    content: 'target model output',
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  })),
}));

describe('Agent Target API (PR-05)', () => {
  let app: FastifyInstance;
  let authToken: string;
  let projectId: string;
  let modelConfigId: string;
  let promptId: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const testEmail = `test-target-${Date.now()}@example.com`;
    const register = await request(app.server)
      .post('/api/auth/register')
      .send({ email: testEmail, password: 'Test12345678!', name: 'Target User' })
      .expect(201);
    authToken = register.body.token;

    const project = await request(app.server)
      .post('/api/projects')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'Target Project' })
      .expect(201);
    projectId = project.body.id;

    const modelConfig = await request(app.server)
      .post('/api/model-configs')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        project_id: projectId,
        name: 'Target Model',
        provider: 'openai',
        model: 'gpt-4o-mini',
        api_key: 'sk-test-target-key-1234567890',
      })
      .expect(201);
    modelConfigId = modelConfig.body.id;

    const prompt = await request(app.server)
      .post('/api/prompts')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ project_id: projectId, name: 'Target Prompt', content: 'You are a helpful assistant.' })
      .expect(201);
    promptId = prompt.body.id ?? prompt.body.prompt?.id;
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  it('prompt_model Target 创建时自动生成 v1 并作为 current_version_id', async () => {
    const response = await request(app.server)
      .post('/api/v2/evaluation/targets')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        projectId,
        name: `Prompt Target ${Date.now()}`,
        type: 'prompt_model',
        description: '用于单元测试',
        invocationConfig: {
          promptId,
          modelConfigId,
          runConfig: { temperature: 0.2, max_tokens: 128 },
        },
        sourceRevision: { framework: 'langchain', agentVersion: '1.0.0' },
      })
      .expect(201);

    expect(response.body.target).toBeTruthy();
    expect(response.body.target.id).toBeTruthy();
    expect(response.body.target.target_type).toBe('prompt_model');
    expect(response.body.target.current_version_id).toBe(response.body.version.id);
    expect(response.body.version.version_number).toBe(1);
    expect(response.body.version.invocation_config.modelConfigId).toBe(modelConfigId);
  });

  it('缺少 modelConfigId 的 prompt_model Target 被拒绝', async () => {
    await request(app.server)
      .post('/api/v2/evaluation/targets')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        projectId,
        name: `Bad Target ${Date.now()}`,
        type: 'prompt_model',
        invocationConfig: { promptId },
      })
      .expect(400);
  });

  it('为已有 Target 创建新版本后 current_version_id 指向新版本，历史版本不可变', async () => {
    const created = await request(app.server)
      .post('/api/v2/evaluation/targets')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        projectId,
        name: `Versioned Target ${Date.now()}`,
        type: 'prompt_model',
        invocationConfig: { promptId, modelConfigId },
      })
      .expect(201);

    const targetId = created.body.target.id;
    const v1Id = created.body.version.id;

    const newVersion = await request(app.server)
      .post(`/api/v2/evaluation/targets/${targetId}/versions`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        invocationConfig: {
          promptId,
          modelConfigId,
          runConfig: { temperature: 0.9 },
        },
        sourceRevision: { agentVersion: '1.1.0' },
      })
      .expect(201);

    expect(newVersion.body.version.version_number).toBe(2);
    expect(newVersion.body.target.current_version_id).toBe(newVersion.body.version.id);
    expect(newVersion.body.target.current_version_id).not.toBe(v1Id);

    const versions = await request(app.server)
      .get(`/api/v2/evaluation/targets/${targetId}/versions`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    const versionNumbers = versions.body.versions.map((v: { version_number: number }) => v.version_number).sort();
    expect(versionNumbers).toEqual([1, 2]);
  });

  it('prompt_model TargetVersion test-invoke 走真实 callTargetModel，返回模型输出与 token 用量', async () => {
    const created = await request(app.server)
      .post('/api/v2/evaluation/targets')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        projectId,
        name: `Invokable Target ${Date.now()}`,
        type: 'prompt_model',
        invocationConfig: { promptId, modelConfigId },
      })
      .expect(201);

    const versionId = created.body.version.id;
    const result = await request(app.server)
      .post(`/api/v2/evaluation/target-versions/${versionId}/test-invoke`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ input: '你好，请介绍一下退款流程' })
      .expect(200);

    expect(result.body.result.output).toBe('target model output');
    expect(result.body.result.tokenUsage).toEqual({
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    });
    expect(result.body.result.error).toBeUndefined();
  });

  it('无权访问其他用户项目的 Target', async () => {
    const other = await request(app.server)
      .post('/api/auth/register')
      .send({ email: `target-other-${Date.now()}@example.com`, password: 'Test12345678!', name: 'Other' })
      .expect(201);

    const list = await request(app.server)
      .get('/api/v2/evaluation/targets')
      .set('Authorization', `Bearer ${other.body.token}`)
      .query({ projectId })
      .expect(404);
    expect(list.body.error).toBeTruthy();
  });
});
