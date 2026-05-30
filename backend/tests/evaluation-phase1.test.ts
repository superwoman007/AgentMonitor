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

describe('Evaluation Center Phase 1 API', () => {
  let app: FastifyInstance;
  let authToken: string;
  let apiKey: string;
  let projectId: string;
  let datasetId: string;
  let experimentId: string;
  let modelConfigId: string;
  const testEmail = `test-phase1-${Date.now()}@example.com`;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const registerResponse = await request(app.server)
      .post('/api/auth/register')
      .send({ email: testEmail, password: 'Test12345678!', name: 'Phase 1 Test User' });
    authToken = registerResponse.body.token;

    const projectResponse = await request(app.server)
      .post('/api/projects')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'Phase 1 Test Project', description: 'For phase 1 testing' });
    projectId = projectResponse.body.id;

    const keyResponse = await request(app.server)
      .post('/api/apikeys')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ project_id: projectId, name: 'Phase 1 Test Key' });
    apiKey = keyResponse.body.key;

    // Create a model config for experiment target
    const cfgResponse = await request(app.server)
      .post('/api/model-configs')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        project_id: projectId,
        name: 'Phase 1 Test Model Config',
        provider: 'openai',
        model: 'gpt-4',
        api_key: 'sk-test-key',
        base_url: 'https://api.openai.com/v1',
      })
      .expect(201);
    modelConfigId = cfgResponse.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  // ============================================================
  // Feature 1: 预置评估器模板
  // ============================================================
  describe('Preset Evaluator Templates', () => {
    it('should return preset evaluator templates list', async () => {
      const response = await request(app.server)
        .get('/api/evaluation/evaluator-templates')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('templates');
      expect(Array.isArray(response.body.templates)).toBe(true);
      expect(response.body.templates.length).toBeGreaterThan(0);

      const template = response.body.templates[0];
      expect(template).toHaveProperty('id');
      expect(template).toHaveProperty('name');
      expect(template).toHaveProperty('type');
      expect(template).toHaveProperty('default_config');
      expect(template).toHaveProperty('applicable_dataset_types');
    });

    it('should auto-create preset evaluators when creating a qa dataset with auto_create_evaluators', async () => {
      const response = await request(app.server)
        .post('/api/evaluation/datasets')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          project_id: projectId,
          name: 'QA Dataset with Preset Evaluators',
          description: 'Auto evaluators test',
          type: 'qa',
          auto_create_evaluators: true,
        })
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body).toHaveProperty('preset_evaluators');
      expect(Array.isArray(response.body.preset_evaluators)).toBe(true);
      expect(response.body.preset_evaluators.length).toBeGreaterThan(0);

      // QA type should have exact_match evaluator
      const exactMatchEvaluator = response.body.preset_evaluators.find(
        (e: any) => e.type === 'exact_match'
      );
      expect(exactMatchEvaluator).toBeDefined();

      datasetId = response.body.id;
    });

    it('should auto-create preset evaluators when creating a chat dataset', async () => {
      const response = await request(app.server)
        .post('/api/evaluation/datasets')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          project_id: projectId,
          name: 'Chat Dataset with Preset Evaluators',
          description: 'Auto evaluators test',
          type: 'chat',
          auto_create_evaluators: true,
        })
        .expect(201);

      expect(response.body.preset_evaluators.length).toBeGreaterThan(0);

      // Chat type should have similarity evaluator
      const similarityEvaluator = response.body.preset_evaluators.find(
        (e: any) => e.type === 'similarity'
      );
      expect(similarityEvaluator).toBeDefined();
    });

    it('should auto-create preset evaluators when creating a custom dataset', async () => {
      const response = await request(app.server)
        .post('/api/evaluation/datasets')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          project_id: projectId,
          name: 'Custom Dataset with Preset Evaluators',
          description: 'Auto evaluators test',
          type: 'custom',
          auto_create_evaluators: true,
        })
        .expect(201);

      expect(response.body.preset_evaluators.length).toBeGreaterThan(0);

      // Custom type should have exact_match + llm_judge
      const exactMatchEvaluator = response.body.preset_evaluators.find(
        (e: any) => e.type === 'exact_match'
      );
      expect(exactMatchEvaluator).toBeDefined();
    });

    it('should not auto-create evaluators when auto_create_evaluators is false', async () => {
      const response = await request(app.server)
        .post('/api/evaluation/datasets')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          project_id: projectId,
          name: 'Dataset without Preset Evaluators',
          description: 'No auto evaluators test',
          type: 'qa',
          auto_create_evaluators: false,
        })
        .expect(201);

      expect(response.body.preset_evaluators).toBeUndefined();
    });

    it('should not auto-create evaluators when auto_create_evaluators is omitted', async () => {
      const response = await request(app.server)
        .post('/api/evaluation/datasets')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          project_id: projectId,
          name: 'Dataset without Preset Evaluators 2',
          description: 'No auto evaluators test',
          type: 'qa',
        })
        .expect(201);

      expect(response.body.preset_evaluators).toBeUndefined();
    });

    it('should create preset evaluators via dedicated endpoint', async () => {
      const dsResponse = await request(app.server)
        .post('/api/evaluation/datasets')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          project_id: projectId,
          name: 'Dataset for Manual Preset',
          type: 'qa',
        })
        .expect(201);

      const dsId = dsResponse.body.id;

      const response = await request(app.server)
        .post(`/api/evaluation/datasets/${dsId}/preset-evaluators`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ project_id: projectId })
        .expect(201);

      expect(response.body).toHaveProperty('evaluators');
      expect(Array.isArray(response.body.evaluators)).toBe(true);
      expect(response.body.evaluators.length).toBeGreaterThan(0);
    });
  });

  // ============================================================
  // Feature 2: LLM Judge 预置 Criteria
  // ============================================================
  describe('LLM Judge Criteria Templates', () => {
    it('should return llm_judge criteria templates', async () => {
      const response = await request(app.server)
        .get('/api/evaluation/evaluator-templates?type=llm_judge')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('templates');

      const llmTemplates = response.body.templates.filter(
        (t: any) => t.type === 'llm_judge'
      );
      expect(llmTemplates.length).toBeGreaterThan(0);

      const template = llmTemplates[0];
      expect(template).toHaveProperty('criteria_options');
      expect(Array.isArray(template.criteria_options)).toBe(true);
      expect(template.criteria_options.length).toBeGreaterThan(0);
    });

    it('should create llm_judge evaluator with preset criteria', async () => {
      const response = await request(app.server)
        .post('/api/evaluation/evaluators')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          project_id: projectId,
          name: 'LLM Judge Accuracy',
          type: 'llm_judge',
          config: {
            criteria: '准确性',
            model: 'gpt-4',
            scoring: '1-5',
          },
        })
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body.type).toBe('llm_judge');
      expect(response.body.config).toHaveProperty('criteria');
    });
  });

  // ============================================================
  // Feature 3: 实验执行引导
  // ============================================================
  describe('Experiment Execution Guide', () => {
    let progressDatasetId: string;
    let progressExperimentId: string;

    beforeAll(async () => {
      // Mock LLM to return expected outputs for exact_match evaluator
      const mockedCallLLM = vi.mocked(callLLM);
      mockedCallLLM.mockResolvedValue({ content: 'A1', usage: { total_tokens: 10 } });

      // Create a dataset with items for progress testing
      const dsResponse = await request(app.server)
        .post('/api/evaluation/datasets')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          project_id: projectId,
          name: 'Progress Test Dataset',
          description: 'Dataset with items for progress test',
          type: 'qa',
        })
        .expect(201);
      progressDatasetId = dsResponse.body.id;

      // Add items to the dataset
      await request(app.server)
        .post(`/api/evaluation/datasets/${progressDatasetId}/items`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          items: [
            { input: 'Q1', expected_output: 'A1' },
            { input: 'Q2', expected_output: 'A2' },
            { input: 'Q3', expected_output: 'A3' },
          ],
        })
        .expect(201);

      // Create experiment for progress testing WITH target model config
      const expResponse = await request(app.server)
        .post('/api/evaluation/experiments')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          project_id: projectId,
          name: 'Progress Test Experiment',
          dataset_id: progressDatasetId,
          description: 'For progress testing',
          target_model_config_id: modelConfigId,
        })
        .expect(201);
      progressExperimentId = expResponse.body.id;

      // Start experiment
      await request(app.server)
        .post(`/api/evaluation/experiments/${progressExperimentId}/start`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);
    });

    it('should return experiment progress after auto-execution', async () => {
      const response = await request(app.server)
        .get(`/api/evaluation/experiments/${progressExperimentId}/progress`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('experiment_id');
      expect(response.body).toHaveProperty('total_items');
      expect(response.body).toHaveProperty('completed_items');
      expect(response.body).toHaveProperty('completion_rate');
      expect(response.body).toHaveProperty('status');

      expect(response.body.experiment_id).toBe(progressExperimentId);
      expect(response.body.total_items).toBe(3);
      // EV-01: startExperiment auto-runs all dataset items
      expect(response.body.completed_items).toBe(3);
      expect(response.body.completion_rate).toBe(100);
    });

    it('should allow manual result upload after auto-execution', async () => {
      // Get dataset items to know their IDs
      const itemsResponse = await request(app.server)
        .get(`/api/evaluation/datasets/${progressDatasetId}/items`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      const items = itemsResponse.body;
      expect(items.length).toBe(3);

      // Upload an additional/calibrated result for first item
      await request(app.server)
        .post('/api/evaluation/results')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          experiment_id: progressExperimentId,
          dataset_item_id: items[0].id,
          output: 'Test output',
          score: 0.8,
          passed: true,
          latency_ms: 500,
        })
        .expect(201);

      // Check progress — EV-01 auto-creates 3 results, plus 1 manual = 4
      const progressResponse = await request(app.server)
        .get(`/api/evaluation/experiments/${progressExperimentId}/progress`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(progressResponse.body.completed_items).toBe(4);
      expect(progressResponse.body.completion_rate).toBeGreaterThan(100);
    });

    it('should return experiment execution script template', async () => {
      const response = await request(app.server)
        .get(`/api/evaluation/experiments/${progressExperimentId}/script-template`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('typescript');
      expect(response.body).toHaveProperty('python');
      expect(typeof response.body.typescript).toBe('string');
      expect(typeof response.body.python).toBe('string');

      // Script should contain experiment_id placeholder
      expect(response.body.typescript).toContain(progressExperimentId);
      expect(response.body.python).toContain(progressExperimentId);

      // Script should contain dataset items iteration pattern
      expect(response.body.typescript).toContain('dataset_items');
      expect(response.body.python).toContain('dataset_items');
    });
  });
});
