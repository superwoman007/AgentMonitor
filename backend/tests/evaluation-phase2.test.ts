import { vi } from 'vitest';
import request from 'supertest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';

describe('Evaluation Center Phase 2 API', () => {
  let app: FastifyInstance;
  let authToken: string;
  let apiKey: string;
  let projectId: string;
  let datasetId: string;
  let evaluatorId: string;
  let modelConfigId: string;
  let experimentId: string;
  let resultId: string;
  const testEmail = `test-phase2-${Date.now()}@example.com`;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const registerResponse = await request(app.server)
      .post('/api/auth/register')
      .send({ email: testEmail, password: 'Test12345678!', name: 'Phase 2 Test User' });
    authToken = registerResponse.body.token;

    const projectResponse = await request(app.server)
      .post('/api/projects')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'Phase 2 Test Project', description: 'For phase 2 testing' });
    projectId = projectResponse.body.id;

    const keyResponse = await request(app.server)
      .post('/api/apikeys')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ project_id: projectId, name: 'Phase 2 Test Key' });
    apiKey = keyResponse.body.key;

    // Create dataset with items
    const dsResponse = await request(app.server)
      .post('/api/evaluation/datasets')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ project_id: projectId, name: 'Phase2 Dataset', type: 'qa' })
      .expect(201);
    datasetId = dsResponse.body.id;

    await request(app.server)
      .post(`/api/evaluation/datasets/${datasetId}/items`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ items: [
        { input: 'Q1', expected_output: 'A1' },
        { input: 'Q2', expected_output: 'A2' },
      ]})
      .expect(201);

    // Create evaluator
    const evalResponse = await request(app.server)
      .post('/api/evaluation/evaluators')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ project_id: projectId, name: 'Exact Match', type: 'exact_match' })
      .expect(201);
    evaluatorId = evalResponse.body.id;

    const modelConfigResponse = await request(app.server)
      .post('/api/model-configs')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        project_id: projectId,
        name: 'Phase 2 Target Model',
        provider: 'openai',
        model: 'gpt-4o-mini',
        api_key: 'sk-phase2-target-key',
      })
      .expect(201);
    modelConfigId = modelConfigResponse.body.id;

    // Create experiment
    const expResponse = await request(app.server)
      .post('/api/evaluation/experiments')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ project_id: projectId, name: 'Phase2 Experiment', dataset_id: datasetId })
      .expect(201);
    experimentId = expResponse.body.id;

    // Truth Repair-8: start 立即返回 202；等待后台 runner 结束（无 target 会 failed，随后手动上传结果）
    await request(app.server)
      .post(`/api/evaluation/experiments/${experimentId}/start`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(202);

    await vi.waitFor(
      async () => {
        const res = await request(app.server)
          .get(`/api/evaluation/experiments/${experimentId}`)
          .set('Authorization', `Bearer ${authToken}`);
        if (res.body.status === 'pending' || res.body.status === 'running') {
          throw new Error(`experiment still ${res.body.status}`);
        }
      },
      { timeout: 10000, interval: 100 }
    );

    const itemsRes = await request(app.server)
      .get(`/api/evaluation/datasets/${datasetId}/items`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    const items = itemsRes.body;

    const resultRes = await request(app.server)
      .post('/api/evaluation/results')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        experiment_id: experimentId,
        dataset_item_id: items[0].id,
        output: 'wrong output',
        score: 0,
        passed: false,
        latency_ms: 100,
      })
      .expect(201);
    resultId = resultRes.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  // ============================================================
  // Feature 1: Auto Evaluation Tasks
  // ============================================================
  describe('Auto Evaluation Tasks', () => {
    it('should create an auto eval task', async () => {
      const response = await request(app.server)
        .post('/api/evaluation/auto-eval-tasks')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          project_id: projectId,
          name: 'Daily Trace Eval',
          dataset_id: datasetId,
          evaluator_id: evaluatorId,
          interval_hours: 24,
          sample_count: 10,
          trace_type_filter: 'llm',
          enabled: true,
        })
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body.name).toBe('Daily Trace Eval');
      expect(response.body.interval_hours).toBe(24);
      expect(response.body.sample_count).toBe(10);
      expect(response.body.enabled).toBe(true);
    });

    it('should list auto eval tasks by project', async () => {
      const response = await request(app.server)
        .get(`/api/evaluation/auto-eval-tasks?project_id=${projectId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('tasks');
      expect(Array.isArray(response.body.tasks)).toBe(true);
      expect(response.body.tasks.length).toBeGreaterThan(0);
    });

    it('should update an auto eval task', async () => {
      const createRes = await request(app.server)
        .post('/api/evaluation/auto-eval-tasks')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          project_id: projectId,
          name: 'Task to Update',
          dataset_id: datasetId,
          evaluator_id: evaluatorId,
          interval_hours: 12,
          sample_count: 5,
          enabled: true,
        })
        .expect(201);

      const taskId = createRes.body.id;

      const response = await request(app.server)
        .put(`/api/evaluation/auto-eval-tasks/${taskId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'Updated Task Name', interval_hours: 6 })
        .expect(200);

      expect(response.body.name).toBe('Updated Task Name');
      expect(response.body.interval_hours).toBe(6);
    });

    it('should delete an auto eval task', async () => {
      const createRes = await request(app.server)
        .post('/api/evaluation/auto-eval-tasks')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          project_id: projectId,
          name: 'Task to Delete',
          dataset_id: datasetId,
          evaluator_id: evaluatorId,
          interval_hours: 12,
          sample_count: 5,
          enabled: true,
        })
        .expect(201);

      const taskId = createRes.body.id;

      await request(app.server)
        .delete(`/api/evaluation/auto-eval-tasks/${taskId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(204);
    });

    it('should manually trigger an auto eval task', async () => {
      const createRes = await request(app.server)
        .post('/api/evaluation/auto-eval-tasks')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          project_id: projectId,
          name: 'Manual Trigger Task',
          dataset_id: datasetId,
          evaluator_id: evaluatorId,
          interval_hours: 24,
          sample_count: 5,
          enabled: true,
        })
        .expect(201);

      const taskId = createRes.body.id;

      const response = await request(app.server)
        .post(`/api/evaluation/auto-eval-tasks/${taskId}/trigger`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('success');
      expect(response.body.success).toBe(true);
    });
  });

  // ============================================================
  // Feature 2: Manual Calibration
  // ============================================================
  describe('Manual Calibration', () => {
    it('should calibrate a result', async () => {
      const response = await request(app.server)
        .put(`/api/evaluation/results/${resultId}/calibrate`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          calibrated_score: 1,
          calibrated_passed: true,
          calibration_note: 'Actually correct',
        })
        .expect(200);

      expect(response.body).toHaveProperty('id');
      expect(response.body.calibrated_score).toBe(1);
      expect(response.body.calibrated_passed).toBe(true);
      expect(response.body.calibration_note).toBe('Actually correct');
    });

    it('should recalculate experiment report after calibration', async () => {
      const reportResponse = await request(app.server)
        .get(`/api/evaluation/experiments/${experimentId}/report`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // After calibration, the first item should be counted as passed
      expect(reportResponse.body.passedCount).toBeGreaterThan(0);
    });
  });

  // ============================================================
  // Feature 3: Prompt Auto Regression
  // ============================================================
  describe('Prompt Auto Regression', () => {
    it('should auto-create regression experiment when saving prompt version', async () => {
      // First create a prompt
      const promptRes = await request(app.server)
        .post('/api/prompts')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          project_id: projectId,
          name: 'Test Prompt',
          content: 'Original prompt',
          config: {},
        })
        .expect(201);

      const promptId = promptRes.body.id;

      // Save new version with auto_regression flag
      const versionRes = await request(app.server)
        .post(`/api/prompts/${promptId}/versions`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          content: 'Improved prompt',
          description: 'Better version',
          auto_regression: true,
          regression_dataset_id: datasetId,
          regression_model_config_id: modelConfigId,
          regression_evaluator_id: evaluatorId,
        })
        .expect(201);

      expect(versionRes.body).toHaveProperty('version');

      // Check that a regression experiment was created
      const experimentsRes = await request(app.server)
        .get(`/api/evaluation/experiments?project_id=${projectId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      const regressionExp = experimentsRes.body.find((e: any) =>
        e.name.includes('回归测试') || e.name.includes('regression')
      );
      expect(regressionExp).toBeDefined();
      expect(regressionExp.prompt_id).toBe(promptId);
      expect(regressionExp.prompt_version_id).toBe(versionRes.body.version.id);
      expect(regressionExp.target_model_config_id).toBe(modelConfigId);
      expect(regressionExp.evaluator_id).toBe(evaluatorId);
    });
  });
});
