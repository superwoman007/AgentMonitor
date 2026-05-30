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

describe('LLM Judge Evaluator', () => {
  let app: FastifyInstance;
  let authToken: string;
  let projectId: string;
  let datasetId: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const testEmail = `test-llm-judge-${Date.now()}@example.com`;
    const registerResponse = await request(app.server)
      .post('/api/auth/register')
      .send({
        email: testEmail,
        password: 'Test12345678!',
        name: 'LLM Judge Test User'
      });

    authToken = registerResponse.body.token;

    const projectResponse = await request(app.server)
      .post('/api/projects')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'LLM Judge Test Project' });

    projectId = projectResponse.body.id;

    // Create a dataset
    const dsResponse = await request(app.server)
      .post('/api/evaluation/datasets')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        project_id: projectId,
        name: 'Judge Test Dataset',
        type: 'qa',
      })
      .expect(201);

    datasetId = dsResponse.body.id;

    // Add items
    await request(app.server)
      .post(`/api/evaluation/datasets/${datasetId}/items`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        items: [
          { input: 'What is 2+2?', expected_output: '4' },
          { input: 'Capital of France?', expected_output: 'Paris' },
        ],
      })
      .expect(201);
  }, 30000);

  afterAll(async () => {
    await app.close();
  }, 30000);

  describe('Evaluator with model_config_id', () => {
    it('should create llm_judge evaluator with model_config_id', async () => {
      // First create a model config
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

      const modelConfigId = cfgRes.body.id;

      // Create llm_judge evaluator referencing the model config
      const response = await request(app.server)
        .post('/api/evaluation/evaluators')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          project_id: projectId,
          name: 'LLM Judge Evaluator',
          type: 'llm_judge',
          description: 'Uses GPT-4 to judge quality',
          config: { criteria: 'accuracy', threshold: 0.7 },
          model_config_id: modelConfigId,
        })
        .expect(201);

      expect(response.body.type).toBe('llm_judge');
      expect(response.body.model_config_id).toBe(modelConfigId);
    });

    it('should fallback to heuristic when no model_config_id is set', async () => {
      const response = await request(app.server)
        .post('/api/evaluation/evaluators')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          project_id: projectId,
          name: 'Heuristic Judge',
          type: 'llm_judge',
          config: { criteria: 'general' },
        })
        .expect(201);

      expect(response.body.model_config_id).toBeNull();
    });
  });

  describe('LLM Judge experiment execution', () => {
    it('should run experiment with llm_judge and fallback to heuristic', async () => {
      // Create a model config to serve as target
      const cfgRes = await request(app.server)
        .post('/api/model-configs')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          project_id: projectId,
          name: 'Target Model',
          provider: 'openai',
          model: 'gpt-4',
          api_key: 'sk-test-key',
          base_url: 'https://api.openai.com/v1',
        })
        .expect(201);
      const targetModelConfigId = cfgRes.body.id;

      // Create evaluator without model_config (will fallback to heuristic)
      await request(app.server)
        .post('/api/evaluation/evaluators')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          project_id: projectId,
          name: 'Fallback Judge',
          type: 'llm_judge',
          config: { criteria: 'general', threshold: 0.5 },
        })
        .expect(201);

      // Mock LLM response for target model
      const mockedCallLLM = vi.mocked(callLLM);
      mockedCallLLM.mockResolvedValue({ content: 'test output', usage: { total_tokens: 10 } });

      // Create experiment WITH target model config
      const expRes = await request(app.server)
        .post('/api/evaluation/experiments')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          project_id: projectId,
          name: 'LLM Judge Experiment',
          dataset_id: datasetId,
          target_model_config_id: targetModelConfigId,
        })
        .expect(201);

      const experimentId = expRes.body.id;

      // Start experiment (auto-runs evaluation)
      const startRes = await request(app.server)
        .post(`/api/evaluation/experiments/${experimentId}/start`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(startRes.body).toHaveProperty('status');
      expect(startRes.body.status).toBe('completed');

      // Check results
      const resultsRes = await request(app.server)
        .get(`/api/evaluation/experiments/${experimentId}/results`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(Array.isArray(resultsRes.body)).toBe(true);
      expect(resultsRes.body.length).toBe(2);

      // Verify heuristic fallback was used
      const firstResult = resultsRes.body[0];
      expect(firstResult).toHaveProperty('score');
      expect(firstResult).toHaveProperty('passed');
      expect(firstResult.details).toHaveProperty('method');
      expect(firstResult.details.method).toBe('heuristic_fallback');
    }, 30000);
  });

  describe('LLM Client utilities', () => {
    it('extractJsonFromLLMResponse should parse JSON from markdown code blocks', async () => {
      const { extractJsonFromLLMResponse } = await import('../src/services/llm-client.js');

      const text = '```json\n{"score": 0.85, "passed": true}\n```';
      const parsed = extractJsonFromLLMResponse(text);

      expect(parsed).not.toBeNull();
      expect(parsed!.score).toBe(0.85);
      expect(parsed!.passed).toBe(true);
    });

    it('extractJsonFromLLMResponse should parse plain JSON', async () => {
      const { extractJsonFromLLMResponse } = await import('../src/services/llm-client.js');

      const text = '{"score": 0.6, "reasoning": "acceptable"}';
      const parsed = extractJsonFromLLMResponse(text);

      expect(parsed).not.toBeNull();
      expect(parsed!.score).toBe(0.6);
    });

    it('buildJudgePrompt should return system and user messages', async () => {
      const { buildJudgePrompt } = await import('../src/services/llm-client.js');

      const messages = buildJudgePrompt('output text', 'expected text', 'accuracy');

      expect(messages.length).toBe(2);
      expect(messages[0].role).toBe('system');
      expect(messages[1].role).toBe('user');
      expect(messages[1].content).toContain('output text');
      expect(messages[1].content).toContain('expected text');
      expect(messages[1].content).toContain('accuracy');
    });
  });
});
