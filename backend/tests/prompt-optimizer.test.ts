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

describe('Prompt Optimizer API (PM-04)', () => {
  let app: FastifyInstance;
  let authToken: string;
  let projectId: string;
  let promptId: string;
  let datasetId: string;
  let experimentId: string;
  let modelConfigId: string;
  let itemIds: string[];

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const testEmail = `test-prompt-optimizer-${Date.now()}@example.com`;
    const registerResponse = await request(app.server)
      .post('/api/auth/register')
      .send({ email: testEmail, password: 'Test123456!', name: 'Prompt Optimizer Test User' });
    authToken = registerResponse.body.token;

    const projectResponse = await request(app.server)
      .post('/api/projects')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'Prompt Optimizer Test Project' });
    projectId = projectResponse.body.id;

    // Create a prompt
    const promptResponse = await request(app.server)
      .post('/api/prompts')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        project_id: projectId,
        name: 'Test Prompt',
        content: 'You are an assistant. Answer the question.',
      })
      .expect(201);
    promptId = promptResponse.body.id;

    // Create a model config for optimization
    const cfgResponse = await request(app.server)
      .post('/api/model-configs')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        project_id: projectId,
        name: 'Optimizer Model',
        provider: 'openai',
        model: 'gpt-4',
        api_key: 'sk-test-key',
      })
      .expect(201);
    modelConfigId = cfgResponse.body.id;

    // Create a dataset with items
    const dsResponse = await request(app.server)
      .post('/api/evaluation/datasets')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        project_id: projectId,
        name: 'Optimizer Test Dataset',
        type: 'qa',
      })
      .expect(201);
    datasetId = dsResponse.body.id;

    const itemsResponse = await request(app.server)
      .post(`/api/evaluation/datasets/${datasetId}/items`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        items: [
          { input: 'What is 2+2?', expected_output: '4' },
          { input: 'Capital of France?', expected_output: 'Paris' },
          { input: 'Largest planet?', expected_output: 'Jupiter' },
        ],
      })
      .expect(201);
    itemIds = itemsResponse.body.map((i: any) => i.id);

    // Create experiment
    const expResponse = await request(app.server)
      .post('/api/evaluation/experiments')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        project_id: projectId,
        name: 'Optimizer Test Experiment',
        dataset_id: datasetId,
      })
      .expect(201);
    experimentId = expResponse.body.id;
  }, 30000);

  afterAll(async () => {
    await app.close();
  }, 30000);

  describe('POST /api/prompts/:id/optimize', () => {
    it('应该基于评测实验生成 Prompt 优化建议', async () => {
      // Complete the experiment
      await request(app.server)
        .post(`/api/evaluation/experiments/${experimentId}/start`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Add results: 2 low-score, 1 high-score
      await request(app.server)
        .post('/api/evaluation/results')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          experiment_id: experimentId,
          dataset_item_id: itemIds[0],
          output: '5',
          score: 0.2,
          passed: false,
          details: { reasoning: 'Wrong answer' },
        })
        .expect(201);

      await request(app.server)
        .post('/api/evaluation/results')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          experiment_id: experimentId,
          dataset_item_id: itemIds[1],
          output: 'London',
          score: 0.3,
          passed: false,
          details: { reasoning: 'Wrong city' },
        })
        .expect(201);

      await request(app.server)
        .post('/api/evaluation/results')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          experiment_id: experimentId,
          dataset_item_id: itemIds[2],
          output: 'Jupiter',
          score: 0.95,
          passed: true,
          details: { reasoning: 'Correct' },
        })
        .expect(201);

      // Mock LLM response
      const mockedCallLLM = vi.mocked(callLLM);
      mockedCallLLM.mockResolvedValueOnce({
        content: JSON.stringify({
          optimized_prompt: 'You are a precise assistant. Provide accurate and concise answers to questions.',
          changes: ['Added precision instruction', 'Added conciseness requirement'],
          reasoning: 'The original prompt was too vague, causing factual errors. Adding precision and conciseness instructions should improve accuracy.',
        }),
      });

      const response = await request(app.server)
        .post(`/api/prompts/${promptId}/optimize`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          experiment_id: experimentId,
          model_config_id: modelConfigId,
        })
        .expect(200);

      expect(response.body).toHaveProperty('original_prompt');
      expect(response.body).toHaveProperty('optimized_prompt');
      expect(response.body).toHaveProperty('changes');
      expect(response.body).toHaveProperty('reasoning');
      expect(response.body).toHaveProperty('low_score_samples');

      expect(response.body.original_prompt).toBe('You are an assistant. Answer the question.');
      expect(response.body.optimized_prompt).toBe('You are a precise assistant. Provide accurate and concise answers to questions.');
      expect(Array.isArray(response.body.changes)).toBe(true);
      expect(response.body.changes.length).toBe(2);
      expect(Array.isArray(response.body.low_score_samples)).toBe(true);
      // Auto-execution may create additional low-score results, so just ensure our manual ones are included
      expect(response.body.low_score_samples.length).toBeGreaterThanOrEqual(2);
      const sampleInputs = response.body.low_score_samples.map((s: any) => s.input);
      expect(sampleInputs).toContain('What is 2+2?');
      expect(sampleInputs).toContain('Capital of France?');
      expect(response.body.low_score_samples[0]).toHaveProperty('input');
      expect(response.body.low_score_samples[0]).toHaveProperty('output');
      expect(response.body.low_score_samples[0]).toHaveProperty('expected_output');
      expect(response.body.low_score_samples[0]).toHaveProperty('score');

      // Verify callLLM was called with optimization prompt
      expect(mockedCallLLM).toHaveBeenCalledTimes(1);
      const callArgs = mockedCallLLM.mock.calls[0][0];
      expect(callArgs.messages.length).toBeGreaterThanOrEqual(2);
      expect(callArgs.messages[0].role).toBe('system');
      expect(callArgs.messages[1].role).toBe('user');
      expect(callArgs.messages[1].content).toContain('You are an assistant. Answer the question.');
    });

    it('应该当实验未完成时返回 400', async () => {
      // Create a new pending experiment
      const pendingExpResponse = await request(app.server)
        .post('/api/evaluation/experiments')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          project_id: projectId,
          name: 'Pending Experiment',
          dataset_id: datasetId,
        })
        .expect(201);
      const pendingExpId = pendingExpResponse.body.id;

      const response = await request(app.server)
        .post(`/api/prompts/${promptId}/optimize`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          experiment_id: pendingExpId,
          model_config_id: modelConfigId,
        })
        .expect(400);

      expect(response.body.error).toContain('completed');
    });

    it('应该当实验没有低分样本时返回 400', async () => {
      // Create a new dataset with all-passing items
      const dsResponse = await request(app.server)
        .post('/api/evaluation/datasets')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          project_id: projectId,
          name: 'All Pass Dataset',
          type: 'qa',
        })
        .expect(201);
      const allPassDsId = dsResponse.body.id;

      const itemsResponse = await request(app.server)
        .post(`/api/evaluation/datasets/${allPassDsId}/items`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          items: [{ input: 'Test', expected_output: 'Test' }],
        })
        .expect(201);
      const allPassItemId = itemsResponse.body[0].id;

      const expResponse = await request(app.server)
        .post('/api/evaluation/experiments')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          project_id: projectId,
          name: 'All Pass Experiment',
          dataset_id: allPassDsId,
        })
        .expect(201);
      const allPassExpId = expResponse.body.id;

      // Directly complete the experiment without auto-execution (to avoid random low scores)
      await request(app.server)
        .post(`/api/evaluation/experiments/${allPassExpId}/complete`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ results_summary: { total_items: 1, passed: 1, failed: 0, avg_score: 0.95 } })
        .expect(200);

      // Add a high-score result manually
      await request(app.server)
        .post('/api/evaluation/results')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          experiment_id: allPassExpId,
          dataset_item_id: allPassItemId,
          output: 'Test',
          score: 0.95,
          passed: true,
        })
        .expect(201);

      const response = await request(app.server)
        .post(`/api/prompts/${promptId}/optimize`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          experiment_id: allPassExpId,
          model_config_id: modelConfigId,
        })
        .expect(400);

      expect(response.body.error).toContain('low score');
    });

    it('应该当 prompt 不存在时返回 404', async () => {
      const response = await request(app.server)
        .post('/api/prompts/nonexistent-prompt-id/optimize')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          experiment_id: experimentId,
          model_config_id: modelConfigId,
        })
        .expect(404);

      expect(response.body.error).toContain('not found');
    });

    it('应该拒绝未认证请求', async () => {
      await request(app.server)
        .post(`/api/prompts/${promptId}/optimize`)
        .send({
          experiment_id: experimentId,
          model_config_id: modelConfigId,
        })
        .expect(401);
    });
  });

  describe('POST /api/prompts/:id/optimize/apply', () => {
    it('应该应用优化建议并创建新版本', async () => {
      const response = await request(app.server)
        .post(`/api/prompts/${promptId}/optimize/apply`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          optimized_prompt: 'You are an optimized assistant.',
          description: 'AI optimized based on experiment results',
        })
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body).toHaveProperty('prompt_id');
      expect(response.body.prompt_id).toBe(promptId);
      expect(response.body.content).toBe('You are an optimized assistant.');
      expect(response.body.description).toBe('AI optimized based on experiment results');
      expect(response.body.version_number).toBeGreaterThanOrEqual(2);

      // Verify prompt was updated
      const promptResponse = await request(app.server)
        .get(`/api/prompts/${promptId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(promptResponse.body.content).toBe('You are an optimized assistant.');
    });

    it('应该要求 optimized_prompt', async () => {
      const response = await request(app.server)
        .post(`/api/prompts/${promptId}/optimize/apply`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({})
        .expect(400);

      expect(response.body.error).toContain('optimized_prompt');
    });

    it('应该当 prompt 不存在时返回 404', async () => {
      const response = await request(app.server)
        .post('/api/prompts/nonexistent-prompt-id/optimize/apply')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          optimized_prompt: 'Test',
        })
        .expect(404);

      expect(response.body.error).toContain('not found');
    });
  });
});
