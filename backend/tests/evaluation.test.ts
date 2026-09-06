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

describe('Evaluation Center API', () => {
  let app: FastifyInstance;
  let authToken: string;
  let projectId: string;
  let datasetId: string;
  let evaluatorId: string;
  let experimentId: string;
  let modelConfigId: string;
  const testEmail = `test-evaluation-${Date.now()}@example.com`;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    // 注册并登录测试用户
    const registerResponse = await request(app.server)
      .post('/api/auth/register')
      .send({
        email: testEmail,
        password: 'Test12345678!',
        name: 'Evaluation Test User'
      });

    authToken = registerResponse.body.token;

    // 创建测试项目
    const projectResponse = await request(app.server)
      .post('/api/projects')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        name: 'Evaluation Test Project',
        description: 'For evaluation center testing'
      });

    projectId = projectResponse.body.id;

    // Create a model config for experiment target
    const cfgResponse = await request(app.server)
      .post('/api/model-configs')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        project_id: projectId,
        name: 'Test Model Config',
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

  // ==================== Datasets ====================
  describe('Datasets', () => {
    describe('POST /api/evaluation/datasets', () => {
      it('should create a dataset', async () => {
        const response = await request(app.server)
          .post('/api/evaluation/datasets')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            project_id: projectId,
            name: 'Test QA Dataset',
            description: 'A dataset for testing',
            type: 'qa'
          })
          .expect(201);

        expect(response.body).toHaveProperty('id');
        expect(response.body.name).toBe('Test QA Dataset');
        expect(response.body.type).toBe('qa');
        expect(response.body.item_count).toBe(0);
        datasetId = response.body.id;
      });

      it('should reject missing name', async () => {
        await request(app.server)
          .post('/api/evaluation/datasets')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            project_id: projectId,
            type: 'qa'
          })
          .expect(400);
      });

      it('should reject missing project_id', async () => {
        await request(app.server)
          .post('/api/evaluation/datasets')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            name: 'No Project Dataset'
          })
          .expect(400);
      });

      it('should reject unauthenticated request', async () => {
        await request(app.server)
          .post('/api/evaluation/datasets')
          .send({
            project_id: projectId,
            name: 'Unauthorized Dataset'
          })
          .expect(401);
      });
    });

    describe('GET /api/evaluation/datasets', () => {
      it('should list datasets for project', async () => {
        const response = await request(app.server)
          .get(`/api/evaluation/datasets?project_id=${projectId}`)
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        expect(Array.isArray(response.body)).toBe(true);
        expect(response.body.length).toBeGreaterThan(0);
        expect(response.body[0]).toHaveProperty('id');
        expect(response.body[0]).toHaveProperty('name');
      });

      it('should reject missing project_id', async () => {
        await request(app.server)
          .get('/api/evaluation/datasets')
          .set('Authorization', `Bearer ${authToken}`)
          .expect(400);
      });
    });

    describe('GET /api/evaluation/datasets/:id', () => {
      it('should get dataset by id', async () => {
        const response = await request(app.server)
          .get(`/api/evaluation/datasets/${datasetId}`)
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        expect(response.body.id).toBe(datasetId);
        expect(response.body.name).toBe('Test QA Dataset');
      });

      it('should return 404 for non-existent dataset', async () => {
        await request(app.server)
          .get('/api/evaluation/datasets/non-existent-id')
          .set('Authorization', `Bearer ${authToken}`)
          .expect(404);
      });
    });

    describe('PUT /api/evaluation/datasets/:id', () => {
      it('should update dataset', async () => {
        const response = await request(app.server)
          .put(`/api/evaluation/datasets/${datasetId}`)
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            name: 'Updated Dataset Name',
            description: 'Updated description'
          })
          .expect(200);

        expect(response.body.name).toBe('Updated Dataset Name');
        expect(response.body.description).toBe('Updated description');
      });
    });

    describe('DELETE /api/evaluation/datasets/:id', () => {
      it('should create then delete a dataset', async () => {
        const createRes = await request(app.server)
          .post('/api/evaluation/datasets')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            project_id: projectId,
            name: 'Dataset To Delete'
          })
          .expect(201);

        const deleteId = createRes.body.id;

        await request(app.server)
          .delete(`/api/evaluation/datasets/${deleteId}`)
          .set('Authorization', `Bearer ${authToken}`)
          .expect(204);

        await request(app.server)
          .get(`/api/evaluation/datasets/${deleteId}`)
          .set('Authorization', `Bearer ${authToken}`)
          .expect(404);
      });
    });
  });

  // ==================== Dataset Items ====================
  describe('Dataset Items', () => {
    let itemId1: string;
    let itemId2: string;

    describe('POST /api/evaluation/datasets/:id/items', () => {
      it('should add items to dataset', async () => {
        const response = await request(app.server)
          .post(`/api/evaluation/datasets/${datasetId}/items`)
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            items: [
              { input: 'What is AI?', expected_output: 'AI stands for Artificial Intelligence.' },
              { input: 'What is ML?', expected_output: 'ML stands for Machine Learning.' }
            ]
          })
          .expect(201);

        expect(Array.isArray(response.body)).toBe(true);
        expect(response.body.length).toBe(2);
        expect(response.body[0]).toHaveProperty('id');
        expect(response.body[0].input).toBe('What is AI?');
        itemId1 = response.body[0].id;
        itemId2 = response.body[1].id;
      });

      it('should reject empty items array', async () => {
        await request(app.server)
          .post(`/api/evaluation/datasets/${datasetId}/items`)
          .set('Authorization', `Bearer ${authToken}`)
          .send({ items: [] })
          .expect(400);
      });

      it('should update dataset item_count after adding items', async () => {
        const response = await request(app.server)
          .get(`/api/evaluation/datasets/${datasetId}`)
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        expect(response.body.item_count).toBe(2);
      });
    });

    describe('GET /api/evaluation/datasets/:id/items', () => {
      it('should list items for dataset', async () => {
        const response = await request(app.server)
          .get(`/api/evaluation/datasets/${datasetId}/items`)
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        expect(Array.isArray(response.body)).toBe(true);
        expect(response.body.length).toBe(2);
        expect(response.body[0]).toHaveProperty('input');
        expect(response.body[0]).toHaveProperty('expected_output');
      });
    });

    describe('PUT /api/evaluation/datasets/items/:itemId', () => {
      it('should update a dataset item', async () => {
        const response = await request(app.server)
          .put(`/api/evaluation/datasets/items/${itemId1}`)
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            input: 'Updated question?',
            expected_output: 'Updated answer.'
          })
          .expect(200);

        expect(response.body.input).toBe('Updated question?');
        expect(response.body.expected_output).toBe('Updated answer.');
      });
    });

    describe('DELETE /api/evaluation/datasets/items/:itemId', () => {
      it('should delete a dataset item', async () => {
        await request(app.server)
          .delete(`/api/evaluation/datasets/items/${itemId2}`)
          .set('Authorization', `Bearer ${authToken}`)
          .expect(204);

        const listResponse = await request(app.server)
          .get(`/api/evaluation/datasets/${datasetId}/items`)
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        expect(listResponse.body.length).toBe(1);
      });
    });
  });

  // ==================== Evaluators ====================
  describe('Evaluators', () => {
    describe('POST /api/evaluation/evaluators', () => {
      it('should create an evaluator', async () => {
        const response = await request(app.server)
          .post('/api/evaluation/evaluators')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            project_id: projectId,
            name: 'Exact Match Evaluator',
            description: 'Checks exact string match',
            type: 'exact_match',
            config: { case_sensitive: false }
          })
          .expect(201);

        expect(response.body).toHaveProperty('id');
        expect(response.body.name).toBe('Exact Match Evaluator');
        expect(response.body.type).toBe('exact_match');
        expect(response.body.config).toEqual({ case_sensitive: false });
        evaluatorId = response.body.id;
      });

      it('should reject invalid evaluator type', async () => {
        await request(app.server)
          .post('/api/evaluation/evaluators')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            project_id: projectId,
            name: 'Invalid Evaluator',
            type: 'invalid_type'
          })
          .expect(400);
      });

      it('should reject missing name', async () => {
        await request(app.server)
          .post('/api/evaluation/evaluators')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            project_id: projectId,
            type: 'exact_match'
          })
          .expect(400);
      });
    });

    describe('GET /api/evaluation/evaluators', () => {
      it('should list evaluators for project', async () => {
        const response = await request(app.server)
          .get(`/api/evaluation/evaluators?project_id=${projectId}`)
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        expect(Array.isArray(response.body)).toBe(true);
        expect(response.body.length).toBeGreaterThan(0);
      });
    });

    describe('GET /api/evaluation/evaluators/:id', () => {
      it('should get evaluator by id', async () => {
        const response = await request(app.server)
          .get(`/api/evaluation/evaluators/${evaluatorId}`)
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        expect(response.body.id).toBe(evaluatorId);
        expect(response.body.type).toBe('exact_match');
      });
    });

    describe('PUT /api/evaluation/evaluators/:id', () => {
      it('should update evaluator', async () => {
        const response = await request(app.server)
          .put(`/api/evaluation/evaluators/${evaluatorId}`)
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            name: 'Updated Evaluator Name',
            config: { case_sensitive: true }
          })
          .expect(200);

        expect(response.body.name).toBe('Updated Evaluator Name');
        expect(response.body.config).toEqual({ case_sensitive: true });
      });
    });

    describe('DELETE /api/evaluation/evaluators/:id', () => {
      it('should create then delete an evaluator', async () => {
        const createRes = await request(app.server)
          .post('/api/evaluation/evaluators')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            project_id: projectId,
            name: 'Evaluator To Delete',
            type: 'contains',
            config: { keywords: ['test'] }
          })
          .expect(201);

        const deleteId = createRes.body.id;

        await request(app.server)
          .delete(`/api/evaluation/evaluators/${deleteId}`)
          .set('Authorization', `Bearer ${authToken}`)
          .expect(204);
      });
    });
  });

  // ==================== Evaluation Experiments ====================
  describe('Evaluation Experiments', () => {
    describe('POST /api/evaluation/experiments', () => {
      it('should create an experiment', async () => {
        // Mock LLM to return the expected output for exact_match evaluator
        const mockedCallLLM = vi.mocked(callLLM);
        mockedCallLLM.mockResolvedValue({ content: 'Updated answer.', usage: { total_tokens: 10 } });

        const response = await request(app.server)
          .post('/api/evaluation/experiments')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            project_id: projectId,
            name: 'Test Experiment',
            description: 'First evaluation experiment',
            dataset_id: datasetId,
            target_model_config_id: modelConfigId,
            evaluator_id: evaluatorId,
            model_config: {
              model: 'gpt-4',
              temperature: 0.7
            }
          })
          .expect(201);

        expect(response.body).toHaveProperty('id');
        expect(response.body.name).toBe('Test Experiment');
        expect(response.body.status).toBe('pending');
        expect(response.body.dataset_id).toBe(datasetId);
        experimentId = response.body.id;
      });

      it('should reject missing dataset_id', async () => {
        await request(app.server)
          .post('/api/evaluation/experiments')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            project_id: projectId,
            name: 'No Dataset Experiment'
          })
          .expect(400);
      });

      it('should create a V2-ready experiment with dataset/target/suite versions', async () => {
        const datasetVersionRes = await request(app.server)
          .post(`/api/evaluation/datasets/${datasetId}/versions`)
          .set('Authorization', `Bearer ${authToken}`)
          .send({ description: 'wizard snapshot' })
          .expect(201);

        const evaluatorVersionsRes = await request(app.server)
          .get(`/api/evaluation/evaluators/${evaluatorId}/versions`)
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);
        const evaluatorVersionId = evaluatorVersionsRes.body.versions[0].id;

        const targetRes = await request(app.server)
          .post('/api/v2/evaluation/targets')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            projectId,
            name: 'Wizard Prompt Target',
            type: 'prompt_model',
            invocationConfig: {
              modelConfigId,
            },
          })
          .expect(201);

        const suiteRes = await request(app.server)
          .post('/api/v2/evaluation/suites')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            projectId,
            name: 'Wizard Suite',
            members: [
              {
                evaluatorVersionId,
                alias: 'primary',
                required: true,
                ordinal: 1,
              },
            ],
            aggregationConfig: {
              strategy: 'all_required',
            },
          })
          .expect(201);

        const response = await request(app.server)
          .post('/api/evaluation/experiments')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            project_id: projectId,
            name: 'V2 Ready Experiment',
            dataset_id: datasetId,
            evaluator_id: evaluatorId,
            dataset_version_id: datasetVersionRes.body.id,
            target_version_id: targetRes.body.version.id,
            evaluator_suite_version_id: suiteRes.body.version.id,
            default_run_config: {
              temperature: 0.2,
            },
          })
          .expect(201);

        expect(response.body.lifecycle_status).toBe('ready');
        expect(response.body.dataset_version_id).toBe(datasetVersionRes.body.id);
        expect(response.body.target_version_id).toBe(targetRes.body.version.id);
        expect(response.body.evaluator_suite_version_id).toBe(suiteRes.body.version.id);
      });
    });

    describe('GET /api/evaluation/experiments', () => {
      it('should list experiments for project', async () => {
        const response = await request(app.server)
          .get(`/api/evaluation/experiments?project_id=${projectId}`)
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        expect(Array.isArray(response.body)).toBe(true);
        expect(response.body.length).toBeGreaterThan(0);
      });
    });

    describe('GET /api/evaluation/experiments/:id', () => {
      it('should get experiment by id', async () => {
        const response = await request(app.server)
          .get(`/api/evaluation/experiments/${experimentId}`)
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        expect(response.body.id).toBe(experimentId);
        expect(response.body.status).toBe('pending');
      });
    });

    describe('POST /api/evaluation/experiments/:id/start', () => {
      it('should start an experiment and auto-run to completion', async () => {
        // Truth Repair-8: start 立即返回 202 + running，评测在后台异步执行
        const response = await request(app.server)
          .post(`/api/evaluation/experiments/${experimentId}/start`)
          .set('Authorization', `Bearer ${authToken}`)
          .expect(202);

        expect(response.body.status).toBe('running');
        expect(response.body).toHaveProperty('started_at');

        // 轮询等待后台异步评测完成
        const completedExperiment = await vi.waitFor(
          async () => {
            const res = await request(app.server)
              .get(`/api/evaluation/experiments/${experimentId}`)
              .set('Authorization', `Bearer ${authToken}`);
            if (res.body.status !== 'completed') {
              throw new Error(`experiment still ${res.body.status}`);
            }
            return res.body;
          },
          { timeout: 10000, interval: 100 }
        );

        expect(completedExperiment.status).toBe('completed');
        expect(completedExperiment).toHaveProperty('completed_at');
      });

      it('should return 404 for non-existent experiment', async () => {
        await request(app.server)
          .post('/api/evaluation/experiments/non-existent-id/start')
          .set('Authorization', `Bearer ${authToken}`)
          .expect(404);
      });
    });

    describe('POST /api/evaluation/experiments/:id/complete', () => {
      it('should complete an experiment', async () => {
        const response = await request(app.server)
          .post(`/api/evaluation/experiments/${experimentId}/complete`)
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            results_summary: {
              total_items: 1,
              passed: 1,
              failed: 0,
              avg_score: 1.0
            }
          })
          .expect(200);

        expect(response.body.status).toBe('completed');
        expect(response.body).toHaveProperty('completed_at');
        expect(response.body.results_summary).toEqual({
          total_items: 1,
          passed: 1,
          failed: 0,
          avg_score: 1.0
        });
      });
    });

    describe('GET /api/evaluation/experiments/:id/results', () => {
      it('should get experiment results', async () => {
        const response = await request(app.server)
          .get(`/api/evaluation/experiments/${experimentId}/results`)
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        expect(Array.isArray(response.body)).toBe(true);
      });
    });

    describe('DELETE /api/evaluation/experiments/:id', () => {
      it('should create then delete an experiment', async () => {
        const createRes = await request(app.server)
          .post('/api/evaluation/experiments')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            project_id: projectId,
            name: 'Experiment To Delete',
            dataset_id: datasetId
          })
          .expect(201);

        const deleteId = createRes.body.id;

        await request(app.server)
          .delete(`/api/evaluation/experiments/${deleteId}`)
          .set('Authorization', `Bearer ${authToken}`)
          .expect(204);
      });
    });
  });

  // ==================== Evaluation Results ====================
  describe('Evaluation Results', () => {
    let resultId: string;

    describe('POST /api/evaluation/results', () => {
      it('should create a result record', async () => {
        const itemsResponse = await request(app.server)
          .get(`/api/evaluation/datasets/${datasetId}/items`)
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        const datasetItemId = itemsResponse.body[0].id;

        const response = await request(app.server)
          .post('/api/evaluation/results')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            experiment_id: experimentId,
            dataset_item_id: datasetItemId,
            evaluator_id: evaluatorId,
            output: 'AI stands for Artificial Intelligence.',
            score: 1.0,
            passed: 1,
            details: { matched: true },
            latency_ms: 500
          })
          .expect(201);

        expect(response.body).toHaveProperty('id');
        expect(response.body.score).toBe(1.0);
        expect(response.body.passed).toBe(1);
        resultId = response.body.id;
      });

      it('should reject missing experiment_id', async () => {
        await request(app.server)
          .post('/api/evaluation/results')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            dataset_item_id: 'some-id',
            score: 0.5
          })
          .expect(400);
      });
    });

    describe('GET /api/evaluation/results/:id', () => {
      it('should get result by id', async () => {
        const response = await request(app.server)
          .get(`/api/evaluation/results/${resultId}`)
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        expect(response.body.id).toBe(resultId);
        expect(response.body.score).toBe(1.0);
      });
    });

    describe('GET /api/evaluation/experiments/:id/results', () => {
      it('should list results for experiment', async () => {
        const response = await request(app.server)
          .get(`/api/evaluation/experiments/${experimentId}/results`)
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        expect(Array.isArray(response.body)).toBe(true);
        expect(response.body.length).toBeGreaterThan(0);
      });
    });
  });
});
