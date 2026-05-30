import request from 'supertest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

describe('Playground Compare API', () => {
  let app: FastifyInstance;
  let projectId: string;
  let authToken: string;
  let modelConfigIds: string[] = [];

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const testEmail = `test-compare-${Date.now()}@example.com`;
    const registerResponse = await request(app.server)
      .post('/api/auth/register')
      .send({
        email: testEmail,
        password: 'Test12345678!',
        name: 'Compare Test User',
      });

    authToken = registerResponse.body.token;

    const projectResponse = await request(app.server)
      .post('/api/projects')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'Compare Test Project' });

    projectId = projectResponse.body.id;

    // 创建两个模型配置用于对比
    const cfg1 = await request(app.server)
      .post('/api/model-configs')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        project_id: projectId,
        name: 'GPT-4 Config',
        provider: 'openai',
        model: 'gpt-4',
      });

    const cfg2 = await request(app.server)
      .post('/api/model-configs')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        project_id: projectId,
        name: 'Claude Config',
        provider: 'anthropic',
        model: 'claude-3-opus',
      });

    modelConfigIds = [cfg1.body.id, cfg2.body.id];
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/playground/compare', () => {
    it('应该成功对多个模型进行对比运行', async () => {
      const response = await request(app.server)
        .post('/api/playground/compare')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          project_id: projectId,
          input: 'What is the capital of France?',
          model_config_ids: modelConfigIds,
        })
        .expect(200);

      expect(response.body).toHaveProperty('results');
      expect(Array.isArray(response.body.results)).toBe(true);
      expect(response.body.results.length).toBe(2);

      // 每个结果应包含关键字段
      response.body.results.forEach((result: any) => {
        expect(result).toHaveProperty('id');
        expect(result).toHaveProperty('model');
        expect(result).toHaveProperty('output');
        expect(result).toHaveProperty('latency_ms');
        expect(result).toHaveProperty('status');
        expect(result.project_id).toBe(projectId);
      });

      // 汇总信息
      expect(response.body).toHaveProperty('summary');
      expect(response.body.summary).toHaveProperty('totalModels');
      expect(response.body.summary).toHaveProperty('avgLatencyMs');
      expect(response.body.summary).toHaveProperty('fastestModel');
      expect(response.body.summary).toHaveProperty('slowestModel');
    });

    it('应该支持关联 prompt_id 进行对比', async () => {
      // 先创建一个 prompt
      const promptRes = await request(app.server)
        .post('/api/prompts')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          project_id: projectId,
          name: 'Capital Question',
          content: 'What is the capital of {{country}}?',
        });

      const promptId = promptRes.body.id;

      const response = await request(app.server)
        .post('/api/playground/compare')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          project_id: projectId,
          prompt_id: promptId,
          input: 'France',
          model_config_ids: modelConfigIds,
        })
        .expect(200);

      expect(response.body.results.length).toBe(2);
      response.body.results.forEach((result: any) => {
        expect(result.prompt_id).toBe(promptId);
      });
    });

    it('应该要求 project_id', async () => {
      const response = await request(app.server)
        .post('/api/playground/compare')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          input: 'test',
          model_config_ids: modelConfigIds,
        })
        .expect(400);

      expect(response.body.error).toContain('project_id');
    });

    it('应该要求 input', async () => {
      const response = await request(app.server)
        .post('/api/playground/compare')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          project_id: projectId,
          model_config_ids: modelConfigIds,
        })
        .expect(400);

      expect(response.body.error).toContain('input');
    });

    it('应该要求至少两个 model_config_ids', async () => {
      const response = await request(app.server)
        .post('/api/playground/compare')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          project_id: projectId,
          input: 'test',
          model_config_ids: [modelConfigIds[0]],
        })
        .expect(400);

      expect(response.body.error).toContain('至少');
    });

    it('应该拒绝无效的 model_config_ids', async () => {
      const response = await request(app.server)
        .post('/api/playground/compare')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          project_id: projectId,
          input: 'test',
          model_config_ids: ['invalid-id-1', 'invalid-id-2'],
        })
        .expect(400);

      expect(response.body.error).toContain('Model config');
    });

    it('应该拒绝未认证请求', async () => {
      await request(app.server)
        .post('/api/playground/compare')
        .send({
          project_id: projectId,
          input: 'test',
          model_config_ids: modelConfigIds,
        })
        .expect(401);
    });

    it('空 model_config_ids 应该返回 400', async () => {
      const response = await request(app.server)
        .post('/api/playground/compare')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          project_id: projectId,
          input: 'test',
          model_config_ids: [],
        })
        .expect(400);

      expect(response.body.error).toContain('至少');
    });
  });
});
