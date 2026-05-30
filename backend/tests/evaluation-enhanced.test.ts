import request from 'supertest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';

describe('Evaluation Center Enhanced API', () => {
  let app: FastifyInstance;
  let authToken: string;
  let apiKey: string;
  let projectId: string;
  let datasetId: string;
  let evaluatorId: string;
  let experimentId: string;
  let sessionId: string;
  const testEmail = `test-eval-enh-${Date.now()}@example.com`;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const registerResponse = await request(app.server)
      .post('/api/auth/register')
      .send({ email: testEmail, password: 'Test12345678!', name: 'Eval Enhanced Test User' });
    authToken = registerResponse.body.token;

    const projectResponse = await request(app.server)
      .post('/api/projects')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'Eval Enhanced Test Project', description: 'For enhanced evaluation testing' });
    projectId = projectResponse.body.id;

    const keyResponse = await request(app.server)
      .post('/api/apikeys')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ project_id: projectId, name: 'Eval Enhanced Test Key' });
    apiKey = keyResponse.body.key;

    // Create session for reflow testing
    const sessionResponse = await request(app.server)
      .post('/api/sessions')
      .set('X-API-Key', apiKey)
      .send({ session_id: `session-${Date.now()}`, metadata: { agent: 'test' } });
    sessionId = sessionResponse.body.id;

    // Create base dataset
    const datasetResponse = await request(app.server)
      .post('/api/evaluation/datasets')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ project_id: projectId, name: 'Test Dataset', description: 'Base dataset', type: 'qa' })
      .expect(201);
    datasetId = datasetResponse.body.id;

    // Add items
    await request(app.server)
      .post(`/api/evaluation/datasets/${datasetId}/items`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ items: [
        { input: 'What is AI?', expected_output: 'Artificial Intelligence' },
        { input: 'What is ML?', expected_output: 'Machine Learning' }
      ]})
      .expect(201);

    // Create evaluator
    const evaluatorResponse = await request(app.server)
      .post('/api/evaluation/evaluators')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ project_id: projectId, name: 'Exact Match Evaluator', type: 'exact_match', description: 'Tests exact match', config: { case_sensitive: false } })
      .expect(201);
    evaluatorId = evaluatorResponse.body.id;

    // Create experiment
    const experimentResponse = await request(app.server)
      .post('/api/evaluation/experiments')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ project_id: projectId, name: 'Test Experiment', dataset_id: datasetId, description: 'First experiment' })
      .expect(201);
    experimentId = experimentResponse.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  // ==================== Dataset Dynamic Columns ====================
  describe('Dataset Dynamic Columns', () => {
    it('should create dataset with column schema', async () => {
      const response = await request(app.server)
        .post('/api/evaluation/datasets')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          project_id: projectId,
          name: 'Dynamic Column Dataset',
          description: 'With custom columns',
          type: 'custom',
          column_schema: JSON.stringify([
            { name: 'input', type: 'text', required: true },
            { name: 'expected_output', type: 'text', required: true },
            { name: 'scenario', type: 'text', required: false },
            { name: 'difficulty', type: 'select', options: ['easy', 'medium', 'hard'] }
          ])
        })
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body.column_schema).toBeInstanceOf(Array);
      expect(response.body.column_schema.length).toBe(4);
    });

    it('should add dataset items with dynamic fields', async () => {
      const dsResponse = await request(app.server)
        .post('/api/evaluation/datasets')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ project_id: projectId, name: 'Dynamic DS', type: 'custom' })
        .expect(201);
      const dsId = dsResponse.body.id;

      const response = await request(app.server)
        .post(`/api/evaluation/datasets/${dsId}/items`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ items: [
          { input: 'Hello', expected_output: 'Hi', fields: { scenario: 'greeting', difficulty: 'easy' } },
          { input: 'Complex', expected_output: 'Answer', fields: { scenario: 'math', difficulty: 'hard' } }
        ]})
        .expect(201);

      expect(response.body).toBeInstanceOf(Array);
      expect(response.body[0].fields).toEqual({ scenario: 'greeting', difficulty: 'easy' });
    });

    it('should update dataset column schema', async () => {
      const response = await request(app.server)
        .put(`/api/evaluation/datasets/${datasetId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          column_schema: JSON.stringify([
            { name: 'input', type: 'text' },
            { name: 'expected_output', type: 'text' },
            { name: 'category', type: 'text' }
          ])
        })
        .expect(200);

      expect(response.body.column_schema).toBeInstanceOf(Array);
      expect(response.body.column_schema.some((c: any) => c.name === 'category')).toBe(true);
    });
  });

  // ==================== Dataset Version Management ====================
  describe('Dataset Version Management', () => {
    it('should commit a dataset version', async () => {
      const response = await request(app.server)
        .post(`/api/evaluation/datasets/${datasetId}/versions`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ description: 'Initial version with 2 items' })
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body).toHaveProperty('version_number');
      expect(response.body.version_number).toBe(1);
      expect(response.body.dataset_id).toBe(datasetId);
    });

    it('should list dataset versions', async () => {
      // Commit another version
      await request(app.server)
        .post(`/api/evaluation/datasets/${datasetId}/versions`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ description: 'Second version' })
        .expect(201);

      const response = await request(app.server)
        .get(`/api/evaluation/datasets/${datasetId}/versions`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.versions).toBeInstanceOf(Array);
      expect(response.body.versions.length).toBeGreaterThanOrEqual(2);
    });

    it('should rollback to a previous version', async () => {
      const versionsResponse = await request(app.server)
        .get(`/api/evaluation/datasets/${datasetId}/versions`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      const firstVersion = versionsResponse.body.versions[versionsResponse.body.versions.length - 1];

      const response = await request(app.server)
        .post(`/api/evaluation/datasets/${datasetId}/rollback/${firstVersion.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.message).toContain('rolled back');
    });
  });

  // ==================== Data Reflow (Trace → Dataset) ====================
  describe('Data Reflow', () => {
    beforeAll(async () => {
      // Create traces and messages in session for reflow
      await request(app.server)
        .post('/api/traces')
        .set('X-API-Key', apiKey)
        .send({
          sessionId: sessionId,
          traceType: 'message',
          name: 'User Question',
          input: { role: 'user' },
          output: { content: 'What is React?' },
          status: 'success'
        })
        .expect(201);

      await request(app.server)
        .post('/api/traces')
        .set('X-API-Key', apiKey)
        .send({
          sessionId: sessionId,
          traceType: 'message',
          name: 'AI Answer',
          input: { role: 'assistant' },
          output: { content: 'React is a JS library' },
          status: 'success'
        })
        .expect(201);

      await request(app.server)
        .post(`/api/sessions/${sessionId}/messages`)
        .set('X-API-Key', apiKey)
        .send({ role: 'user', content: 'What is React?', timestamp: new Date().toISOString() })
        .expect(201);

      await request(app.server)
        .post(`/api/sessions/${sessionId}/messages`)
        .set('X-API-Key', apiKey)
        .send({ role: 'assistant', content: 'React is a JS library', timestamp: new Date().toISOString() })
        .expect(201);
    });

    it('should reflow session messages into dataset', async () => {
      const newDsResponse = await request(app.server)
        .post('/api/evaluation/datasets')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ project_id: projectId, name: 'Reflowed Dataset', type: 'chat' })
        .expect(201);
      const newDsId = newDsResponse.body.id;

      const response = await request(app.server)
        .post('/api/evaluation/datasets/reflow')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          target_dataset_id: newDsId,
          source_type: 'session',
          source_id: sessionId,
          mapping: { input_field: 'user_messages', output_field: 'assistant_messages' }
        })
        .expect(201);

      expect(response.body).toHaveProperty('added_count');
      expect(response.body.added_count).toBeGreaterThanOrEqual(1);
      expect(response.body).toHaveProperty('dataset_id', newDsId);
    });

    it('should reflow traces into dataset', async () => {
      const newDsResponse = await request(app.server)
        .post('/api/evaluation/datasets')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ project_id: projectId, name: 'Trace Reflow Dataset', type: 'custom' })
        .expect(201);
      const newDsId = newDsResponse.body.id;

      const response = await request(app.server)
        .post('/api/evaluation/datasets/reflow')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          target_dataset_id: newDsId,
          source_type: 'traces',
          source_session_id: sessionId,
          trace_type_filter: 'message'
        })
        .expect(201);

      expect(response.body.added_count).toBeGreaterThanOrEqual(1);
    });
  });

  // ==================== Evaluator Version Management ====================
  describe('Evaluator Version Management', () => {
    it('should create evaluator version on update', async () => {
      const response = await request(app.server)
        .put(`/api/evaluation/evaluators/${evaluatorId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'Updated Exact Match', config: { case_sensitive: true, threshold: 0.9 } })
        .expect(200);

      expect(response.body.name).toBe('Updated Exact Match');
    });

    it('should list evaluator versions', async () => {
      const response = await request(app.server)
        .get(`/api/evaluation/evaluators/${evaluatorId}/versions`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.versions).toBeInstanceOf(Array);
    });

    it('should rollback evaluator to previous version', async () => {
      const versionsResponse = await request(app.server)
        .get(`/api/evaluation/evaluators/${evaluatorId}/versions`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      const versions = versionsResponse.body.versions;
      expect(versions.length).toBeGreaterThanOrEqual(1);

      const response = await request(app.server)
        .post(`/api/evaluation/evaluators/${evaluatorId}/rollback/${versions[0].id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('id', evaluatorId);
    });
  });

  // ==================== Experiment Report ====================
  describe('Experiment Report', () => {
    beforeAll(async () => {
      // Start and complete experiment with results
      await request(app.server)
        .post(`/api/evaluation/experiments/${experimentId}/start`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      const itemsResponse = await request(app.server)
        .get(`/api/evaluation/datasets/${datasetId}/items`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);
      const items = itemsResponse.body;

      for (const item of items) {
        await request(app.server)
          .post('/api/evaluation/results')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            experiment_id: experimentId,
            dataset_item_id: item.id,
            evaluator_id: evaluatorId,
            output: item.expected_output,
            score: Math.random() > 0.3 ? 1 : 0,
            passed: Math.random() > 0.3 ? 1 : 0,
            latency_ms: Math.floor(Math.random() * 2000)
          })
          .expect(201);
      }

      await request(app.server)
        .post(`/api/evaluation/experiments/${experimentId}/complete`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ results_summary: { total: items.length, passed: Math.floor(items.length * 0.7) } })
        .expect(200);
    });

    it('should get experiment report with statistics', async () => {
      const response = await request(app.server)
        .get(`/api/evaluation/experiments/${experimentId}/report`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('totalItems');
      expect(response.body).toHaveProperty('passedCount');
      expect(response.body).toHaveProperty('failedCount');
      expect(response.body).toHaveProperty('passRate');
      expect(response.body).toHaveProperty('avgScore');
      expect(response.body).toHaveProperty('avgLatency');
      expect(response.body).toHaveProperty('scoreDistribution');
      expect(response.body.scoreDistribution).toBeInstanceOf(Array);
    });

    it('should get bad cases from experiment', async () => {
      const response = await request(app.server)
        .get(`/api/evaluation/experiments/${experimentId}/badcases`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('badcases');
      expect(response.body.badcases).toBeInstanceOf(Array);
    });
  });

  // ==================== Experiment Comparison ====================
  describe('Experiment Comparison', () => {
    it('should compare multiple experiments', async () => {
      // Create second experiment
      const exp2Response = await request(app.server)
        .post('/api/evaluation/experiments')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ project_id: projectId, name: 'Second Experiment', dataset_id: datasetId })
        .expect(201);
      const exp2Id = exp2Response.body.id;

      await request(app.server)
        .post(`/api/evaluation/experiments/${exp2Id}/start`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      await request(app.server)
        .post(`/api/evaluation/experiments/${exp2Id}/complete`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ results_summary: { total: 2, passed: 1 } })
        .expect(200);

      const response = await request(app.server)
        .post('/api/evaluation/experiments/compare')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ experiment_ids: [experimentId, exp2Id] })
        .expect(200);

      expect(response.body).toHaveProperty('comparisons');
      expect(response.body.comparisons).toBeInstanceOf(Array);
      expect(response.body.comparisons.length).toBe(2);
    });
  });
});
