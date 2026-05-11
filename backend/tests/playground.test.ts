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

describe('Playground API (PM-02)', () => {
  let app: FastifyInstance;
  let authToken: string;
  let projectId: string;
  let modelConfigId1: string;
  let modelConfigId2: string;
  let promptId: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const testEmail = `test-playground-${Date.now()}@example.com`;
    const registerResponse = await request(app.server)
      .post('/api/auth/register')
      .send({ email: testEmail, password: 'Test123456!', name: 'Playground Test User' });
    authToken = registerResponse.body.token;

    const projectResponse = await request(app.server)
      .post('/api/projects')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'Playground Test Project' });
    projectId = projectResponse.body.id;

    // Create two model configs
    const cfg1 = await request(app.server)
      .post('/api/model-configs')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        project_id: projectId,
        name: 'Model A',
        provider: 'openai',
        model: 'gpt-4',
        api_key: 'sk-test-key-a',
        base_url: 'https://api.openai.com/v1',
      })
      .expect(201);
    modelConfigId1 = cfg1.body.id;

    const cfg2 = await request(app.server)
      .post('/api/model-configs')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        project_id: projectId,
        name: 'Model B',
        provider: 'anthropic',
        model: 'claude-3-opus',
        api_key: 'sk-test-key-b',
        base_url: 'https://api.anthropic.com/v1',
      })
      .expect(201);
    modelConfigId2 = cfg2.body.id;

    // Create a prompt
    const promptRes = await request(app.server)
      .post('/api/prompts')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        project_id: projectId,
        name: 'Test Prompt',
        content: 'You are a helpful assistant.',
      })
      .expect(201);
    promptId = promptRes.body.id;
  }, 30000);

  afterAll(async () => {
    await app.close();
  }, 30000);

  describe('POST /api/playground/compare', () => {
    it('should compare multiple models with real LLM calls', async () => {
      const mockedCallLLM = vi.mocked(callLLM);
      mockedCallLLM
        .mockResolvedValueOnce({ content: 'Response from GPT-4', usage: { total_tokens: 15 } })
        .mockResolvedValueOnce({ content: 'Response from Claude', usage: { total_tokens: 12 } });

      const response = await request(app.server)
        .post('/api/playground/compare')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          project_id: projectId,
          prompt_id: promptId,
          input: 'What is AI?',
          model_config_ids: [modelConfigId1, modelConfigId2],
        })
        .expect(200);

      expect(response.body).toHaveProperty('results');
      expect(response.body).toHaveProperty('summary');
      expect(Array.isArray(response.body.results)).toBe(true);
      expect(response.body.results.length).toBe(2);

      const resultModels = response.body.results.map((r: any) => r.model);
      expect(resultModels).toContain('gpt-4');
      expect(resultModels).toContain('claude-3-opus');

      // Verify real outputs were recorded
      const gptResult = response.body.results.find((r: any) => r.model === 'gpt-4');
      const claudeResult = response.body.results.find((r: any) => r.model === 'claude-3-opus');

      expect(gptResult.output).toBe('Response from GPT-4');
      expect(claudeResult.output).toBe('Response from Claude');
      expect(gptResult.status).toBe('success');
      expect(claudeResult.status).toBe('success');

      // Summary stats
      expect(response.body.summary.totalModels).toBe(2);
      expect(response.body.summary).toHaveProperty('avgLatencyMs');
      expect(response.body.summary).toHaveProperty('fastestModel');
      expect(response.body.summary).toHaveProperty('slowestModel');

      // Verify callLLM was called twice (once per model)
      expect(mockedCallLLM).toHaveBeenCalledTimes(2);
    });

    it('should handle model errors gracefully', async () => {
      const mockedCallLLM = vi.mocked(callLLM);
      mockedCallLLM
        .mockResolvedValueOnce({ content: 'OK', usage: { total_tokens: 5 } })
        .mockRejectedValueOnce(new Error('Rate limit exceeded'));

      const response = await request(app.server)
        .post('/api/playground/compare')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          project_id: projectId,
          input: 'Test input',
          model_config_ids: [modelConfigId1, modelConfigId2],
        })
        .expect(200);

      expect(response.body.results.length).toBe(2);
      const errorResult = response.body.results.find((r: any) => r.model === 'claude-3-opus');
      expect(errorResult.status).toBe('error');
    });

    it('should reject less than 2 models', async () => {
      await request(app.server)
        .post('/api/playground/compare')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          project_id: projectId,
          input: 'Test',
          model_config_ids: [modelConfigId1],
        })
        .expect(400);
    });

    it('should reject unauthorized requests', async () => {
      await request(app.server)
        .post('/api/playground/compare')
        .send({
          project_id: projectId,
          input: 'Test',
          model_config_ids: [modelConfigId1, modelConfigId2],
        })
        .expect(401);
    });
  });
});
