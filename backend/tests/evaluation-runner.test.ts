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

describe('Evaluation Runner with Real Target (EV-03)', () => {
  let app: FastifyInstance;
  let authToken: string;
  let projectId: string;
  let datasetId: string;
  let evaluatorId: string;
  let modelConfigId: string;
  let promptId: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const testEmail = `test-eval-runner-${Date.now()}@example.com`;
    const registerResponse = await request(app.server)
      .post('/api/auth/register')
      .send({ email: testEmail, password: 'Test123456!', name: 'Eval Runner Test User' });
    authToken = registerResponse.body.token;

    const projectResponse = await request(app.server)
      .post('/api/projects')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'Eval Runner Test Project' });
    projectId = projectResponse.body.id;

    // Create a prompt
    const promptResponse = await request(app.server)
      .post('/api/prompts')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        project_id: projectId,
        name: 'Math Prompt',
        content: 'You are a math assistant. Answer the question briefly.',
      })
      .expect(201);
    promptId = promptResponse.body.id;

    // Create a model config
    const modelConfigResponse = await request(app.server)
      .post('/api/model-configs')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        project_id: projectId,
        name: 'Test Model',
        provider: 'openai',
        model: 'gpt-4o-mini',
        api_key: 'sk-test-runner-key',
      })
      .expect(201);
    modelConfigId = modelConfigResponse.body.id;

    // Create dataset
    const datasetResponse = await request(app.server)
      .post('/api/evaluation/datasets')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ project_id: projectId, name: 'Runner Dataset', type: 'qa' })
      .expect(201);
    datasetId = datasetResponse.body.id;

    await request(app.server)
      .post(`/api/evaluation/datasets/${datasetId}/items`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        items: [
          { input: 'What is 2+2?', expected_output: '4' },
          { input: 'What is 3+3?', expected_output: '6' },
        ],
      })
      .expect(201);

    // Create evaluator
    const evaluatorResponse = await request(app.server)
      .post('/api/evaluation/evaluators')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        project_id: projectId,
        name: 'Exact Match Runner',
        type: 'exact_match',
        config: { case_sensitive: false },
      })
      .expect(201);
    evaluatorId = evaluatorResponse.body.id;

    // Setup mock callLLM
    const mockedCallLLM = vi.mocked(callLLM);
    mockedCallLLM.mockImplementation(async (options) => {
      const input = options.messages.find(m => m.role === 'user')?.content || '';
      return {
        content: `Real response for: ${input}`,
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      };
    });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Experiment with target_model_config_id', () => {
    it('should run experiment with real model calls and produce actual outputs', async () => {
      const experimentResponse = await request(app.server)
        .post('/api/evaluation/experiments')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          project_id: projectId,
          name: 'Real Target Experiment',
          dataset_id: datasetId,
          target_model_config_id: modelConfigId,
          prompt_id: promptId,
        })
        .expect(201);

      const expId = experimentResponse.body.id;

      const startResponse = await request(app.server)
        .post(`/api/evaluation/experiments/${expId}/start`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(startResponse.body.status).toBe('completed');

      // Verify results
      const resultsResponse = await request(app.server)
        .get(`/api/evaluation/experiments/${expId}/results`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(Array.isArray(resultsResponse.body)).toBe(true);
      expect(resultsResponse.body.length).toBe(2);

      for (const result of resultsResponse.body) {
        // output should be from real model call, not simulated
        expect(result.output).not.toContain('(with some noise)');
        expect(result.output).toMatch(/^Real response for:/);
        expect(result).toHaveProperty('latency_ms');
        expect(result.details).toHaveProperty('target_latency_ms');
        expect(result.details).toHaveProperty('target_tokens');
      }
    });

    it('should run experiment with prompt as system message', async () => {
      const experimentResponse = await request(app.server)
        .post('/api/evaluation/experiments')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          project_id: projectId,
          name: 'Prompt Target Experiment',
          dataset_id: datasetId,
          target_model_config_id: modelConfigId,
          prompt_id: promptId,
        })
        .expect(201);

      const expId = experimentResponse.body.id;

      await request(app.server)
        .post(`/api/evaluation/experiments/${expId}/start`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      const mockedCallLLM = vi.mocked(callLLM);
      const lastCall = mockedCallLLM.mock.calls[mockedCallLLM.mock.calls.length - 1];
      const messages = lastCall[0].messages;
      expect(messages.some((m: any) => m.role === 'system' && m.content.includes('math assistant'))).toBe(true);
    });
  });

  describe('Experiment without target (legacy)', () => {
    it('should fail with clear error for legacy experiments without target', async () => {
      const experimentResponse = await request(app.server)
        .post('/api/evaluation/experiments')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          project_id: projectId,
          name: 'Legacy Experiment',
          dataset_id: datasetId,
        })
        .expect(201);

      const expId = experimentResponse.body.id;

      const startResponse = await request(app.server)
        .post(`/api/evaluation/experiments/${expId}/start`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(startResponse.body.status).toBe('failed');
      expect(startResponse.body.results_summary?.error || startResponse.body.error).toContain('target');
    });
  });

  describe('Experiment report with real outputs', () => {
    it('should generate accurate report based on real model outputs', async () => {
      const experimentResponse = await request(app.server)
        .post('/api/evaluation/experiments')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          project_id: projectId,
          name: 'Report Experiment',
          dataset_id: datasetId,
          target_model_config_id: modelConfigId,
        })
        .expect(201);

      const expId = experimentResponse.body.id;

      await request(app.server)
        .post(`/api/evaluation/experiments/${expId}/start`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      const reportResponse = await request(app.server)
        .get(`/api/evaluation/experiments/${expId}/report`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(reportResponse.body.totalItems).toBe(2);
      expect(reportResponse.body.passedCount + reportResponse.body.failedCount).toBe(2);
    });
  });
});
