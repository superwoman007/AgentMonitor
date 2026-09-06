import { vi, beforeAll, afterAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { callLLM } from '../src/services/llm-client.js';

vi.mock('../src/services/llm-client.js', async () => {
  const actual = await vi.importActual<typeof import('../src/services/llm-client.js')>('../src/services/llm-client.js');
  return {
    ...actual,
    callLLM: vi.fn(),
  };
});

describe('Prompt Engineering API', () => {
  let app: FastifyInstance;
  let authToken: string;
  let projectId: string;
  let promptId: string;
  let versionId: string;
  let runId: string;
  let modelConfigId: string;
  const testEmail = `test-prompts-${Date.now()}@example.com`;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const registerResponse = await request(app.server)
      .post('/api/auth/register')
      .send({
        email: testEmail,
        password: 'Test12345678!',
        name: 'Prompt Test User'
      });

    authToken = registerResponse.body.token;

    const projectResponse = await request(app.server)
      .post('/api/projects')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        name: 'Prompt Test Project',
        description: 'For prompt engineering testing'
      });

    projectId = projectResponse.body.id;

    const mockedCallLLM = vi.mocked(callLLM);
    mockedCallLLM.mockImplementation(async (options) => {
      const input = options.messages.find((message) => message.role === 'user')?.content || '';
      return {
        content: `Playground response for: ${input}`,
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      };
    });

    const modelConfigResponse = await request(app.server)
      .post('/api/model-configs')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        project_id: projectId,
        name: 'Playground Test Model',
        provider: 'openai',
        model: 'gpt-4',
        api_key: 'sk-test-prompt-key',
      })
      .expect(201);
    modelConfigId = modelConfigResponse.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  // ==================== Prompts ====================
  describe('Prompts', () => {
    describe('POST /api/prompts', () => {
      it('should create a prompt', async () => {
        const response = await request(app.server)
          .post('/api/prompts')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            project_id: projectId,
            name: 'Customer Support Prompt',
            description: 'Handles customer inquiries',
            content: 'You are a helpful support agent. User: {{input}}',
            config: { temperature: 0.7 }
          })
          .expect(201);

        expect(response.body).toHaveProperty('id');
        expect(response.body.name).toBe('Customer Support Prompt');
        expect(response.body.content).toBe('You are a helpful support agent. User: {{input}}');
        expect(response.body).toHaveProperty('current_version_id');
        promptId = response.body.id;
      });

      it('should reject missing project_id', async () => {
        await request(app.server)
          .post('/api/prompts')
          .set('Authorization', `Bearer ${authToken}`)
          .send({ name: 'No Project Prompt', content: 'test' })
          .expect(400);
      });

      it('should reject missing name', async () => {
        await request(app.server)
          .post('/api/prompts')
          .set('Authorization', `Bearer ${authToken}`)
          .send({ project_id: projectId, content: 'test' })
          .expect(400);
      });

      it('should reject missing content', async () => {
        await request(app.server)
          .post('/api/prompts')
          .set('Authorization', `Bearer ${authToken}`)
          .send({ project_id: projectId, name: 'No Content' })
          .expect(400);
      });
    });

    describe('GET /api/prompts', () => {
      it('should list prompts for project', async () => {
        const response = await request(app.server)
          .get(`/api/prompts?project_id=${projectId}`)
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        expect(Array.isArray(response.body)).toBe(true);
        expect(response.body.length).toBeGreaterThan(0);
        expect(response.body[0]).toHaveProperty('id');
        expect(response.body[0]).toHaveProperty('name');
      });

      it('should reject missing project_id', async () => {
        await request(app.server)
          .get('/api/prompts')
          .set('Authorization', `Bearer ${authToken}`)
          .expect(400);
      });
    });

    describe('GET /api/prompts/:id', () => {
      it('should get prompt by id', async () => {
        const response = await request(app.server)
          .get(`/api/prompts/${promptId}`)
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        expect(response.body.id).toBe(promptId);
        expect(response.body.name).toBe('Customer Support Prompt');
      });

      it('should return 404 for non-existent prompt', async () => {
        await request(app.server)
          .get('/api/prompts/non-existent-id')
          .set('Authorization', `Bearer ${authToken}`)
          .expect(404);
      });
    });

    describe('PUT /api/prompts/:id', () => {
      it('should update prompt and create a new version', async () => {
        const response = await request(app.server)
          .put(`/api/prompts/${promptId}`)
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            content: 'Updated prompt content: {{input}}',
            config: { temperature: 0.5 },
            description: 'Updated version'
          })
          .expect(200);

        expect(response.body.content).toBe('Updated prompt content: {{input}}');
        expect(response.body).toHaveProperty('current_version_id');

        // Verify a new version was created
        const versionsRes = await request(app.server)
          .get(`/api/prompts/${promptId}/versions`)
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        expect(Array.isArray(versionsRes.body)).toBe(true);
        expect(versionsRes.body.length).toBe(2); // initial + updated
      });
    });

    describe('DELETE /api/prompts/:id', () => {
      it('should create then delete a prompt', async () => {
        const createRes = await request(app.server)
          .post('/api/prompts')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            project_id: projectId,
            name: 'Prompt To Delete',
            content: 'delete me'
          })
          .expect(201);

        const deleteId = createRes.body.id;

        await request(app.server)
          .delete(`/api/prompts/${deleteId}`)
          .set('Authorization', `Bearer ${authToken}`)
          .expect(204);

        await request(app.server)
          .get(`/api/prompts/${deleteId}`)
          .set('Authorization', `Bearer ${authToken}`)
          .expect(404);
      });
    });
  });

  // ==================== Prompt Versions ====================
  describe('Prompt Versions', () => {
    describe('GET /api/prompts/:id/versions', () => {
      it('should list versions for prompt', async () => {
        const response = await request(app.server)
          .get(`/api/prompts/${promptId}/versions`)
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        expect(Array.isArray(response.body)).toBe(true);
        expect(response.body.length).toBeGreaterThan(0);
        expect(response.body[0]).toHaveProperty('version_number');
        versionId = response.body[0].id;
      });
    });

    describe('GET /api/prompts/versions/:versionId', () => {
      it('should get version by id', async () => {
        const response = await request(app.server)
          .get(`/api/prompts/versions/${versionId}`)
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        expect(response.body.id).toBe(versionId);
        expect(response.body).toHaveProperty('content');
        expect(response.body).toHaveProperty('version_number');
      });
    });

    describe('POST /api/prompts/:id/rollback/:versionId', () => {
      it('should rollback prompt to a specific version', async () => {
        const response = await request(app.server)
          .post(`/api/prompts/${promptId}/rollback/${versionId}`)
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        expect(response.body.id).toBe(promptId);
        expect(response.body.current_version_id).toBe(versionId);

        // Verify a new version was created for the rollback
        const versionsRes = await request(app.server)
          .get(`/api/prompts/${promptId}/versions`)
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        expect(versionsRes.body.length).toBe(2); // initial + update (rollback reuses existing version)
      });
    });
  });

  // ==================== Playground Runs ====================
  describe('Playground Runs', () => {
    describe('POST /api/playground/run', () => {
      it('should create a playground run record', async () => {
        const response = await request(app.server)
          .post('/api/playground/run')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            project_id: projectId,
            prompt_id: promptId,
            prompt_version_id: versionId,
            model_config_id: modelConfigId,
            input: 'Hello, how do I reset my password?',
          })
          .expect(201);

        expect(response.body).toHaveProperty('id');
        expect(response.body.model).toBe('gpt-4');
        expect(response.body.status).toBe('success');
        expect(response.body.output).toContain('Playground response for: Hello, how do I reset my password?');
        runId = response.body.id;
      });

      it('should reject missing project_id', async () => {
        await request(app.server)
          .post('/api/playground/run')
          .set('Authorization', `Bearer ${authToken}`)
          .send({ model: 'gpt-4', input: 'test' })
          .expect(400);
      });

      it('should reject missing input', async () => {
        await request(app.server)
          .post('/api/playground/run')
          .set('Authorization', `Bearer ${authToken}`)
          .send({ project_id: projectId, model: 'gpt-4' })
          .expect(400);
      });
    });

    describe('GET /api/playground/runs', () => {
      it('should list runs for project', async () => {
        const response = await request(app.server)
          .get(`/api/playground/runs?project_id=${projectId}`)
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        expect(Array.isArray(response.body)).toBe(true);
        expect(response.body.length).toBeGreaterThan(0);
      });
    });

    describe('GET /api/playground/runs/:id', () => {
      it('should get run by id', async () => {
        const response = await request(app.server)
          .get(`/api/playground/runs/${runId}`)
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        expect(response.body.id).toBe(runId);
        expect(response.body.input).toBe('Hello, how do I reset my password?');
      });
    });
  });

  // ==================== Model Configs ====================
  describe('Model Configs', () => {
    describe('POST /api/model-configs', () => {
      it('should create a model config', async () => {
        const response = await request(app.server)
          .post('/api/model-configs')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            project_id: projectId,
            name: 'GPT-4 Config',
            provider: 'openai',
            model: 'gpt-4',
            config: { temperature: 0.7, max_tokens: 2048 }
          })
          .expect(201);

        expect(response.body).toHaveProperty('id');
        expect(response.body.name).toBe('GPT-4 Config');
        expect(response.body.provider).toBe('openai');
        expect(response.body.model).toBe('gpt-4');
        modelConfigId = response.body.id;
      });

      it('should reject missing project_id', async () => {
        await request(app.server)
          .post('/api/model-configs')
          .set('Authorization', `Bearer ${authToken}`)
          .send({ name: 'No Project', provider: 'openai', model: 'gpt-4' })
          .expect(400);
      });

      it('should reject missing provider', async () => {
        await request(app.server)
          .post('/api/model-configs')
          .set('Authorization', `Bearer ${authToken}`)
          .send({ project_id: projectId, name: 'No Provider', model: 'gpt-4' })
          .expect(400);
      });
    });

    describe('GET /api/model-configs', () => {
      it('should list model configs for project', async () => {
        const response = await request(app.server)
          .get(`/api/model-configs?project_id=${projectId}`)
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        expect(Array.isArray(response.body)).toBe(true);
        expect(response.body.length).toBeGreaterThan(0);
      });

      it('should reject missing project_id', async () => {
        await request(app.server)
          .get('/api/model-configs')
          .set('Authorization', `Bearer ${authToken}`)
          .expect(400);
      });
    });

    describe('GET /api/model-configs/:id', () => {
      it('should get model config by id', async () => {
        const response = await request(app.server)
          .get(`/api/model-configs/${modelConfigId}`)
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        expect(response.body.id).toBe(modelConfigId);
        expect(response.body.config).toEqual({ temperature: 0.7, max_tokens: 2048 });
      });
    });

    describe('DELETE /api/model-configs/:id', () => {
      it('should create then delete a model config', async () => {
        const createRes = await request(app.server)
          .post('/api/model-configs')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            project_id: projectId,
            name: 'Config To Delete',
            provider: 'anthropic',
            model: 'claude-3'
          })
          .expect(201);

        const deleteId = createRes.body.id;

        await request(app.server)
          .delete(`/api/model-configs/${deleteId}`)
          .set('Authorization', `Bearer ${authToken}`)
          .expect(204);

        await request(app.server)
          .get(`/api/model-configs/${deleteId}`)
          .set('Authorization', `Bearer ${authToken}`)
          .expect(404);
      });
    });
  });

  // ==================== Prompt ↔ Trace Linkage ====================
  describe('Prompt ↔ Trace Linkage', () => {
    it('GET /api/prompts/:id/traces 应返回关联的 traces', async () => {
      // Create a prompt
      const promptRes = await request(app.server)
        .post('/api/prompts')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          project_id: projectId,
          name: 'Linked Prompt',
          content: 'Linked {{input}}',
        })
        .expect(201);

      const linkedPromptId = promptRes.body.id;
      const versionId = promptRes.body.current_version_id;

      // Create an API key for the project to create traces
      const keyRes = await request(app.server)
        .post('/api/apikeys')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          project_id: projectId,
          name: 'Linkage Test Key'
        })
        .expect(201);

      const linkedApiKey = keyRes.body.key;

      // Create traces linked to this prompt
      await request(app.server)
        .post('/api/traces')
        .set('X-API-Key', linkedApiKey)
        .send({
          traceType: 'llm',
          name: 'trace-1',
          promptId: linkedPromptId,
          promptVersionId: versionId,
          status: 'success',
        })
        .expect(201);

      await request(app.server)
        .post('/api/traces')
        .set('X-API-Key', linkedApiKey)
        .send({
          traceType: 'llm',
          name: 'trace-2',
          promptId: linkedPromptId,
          promptVersionId: versionId,
          status: 'error',
        })
        .expect(201);

      // Query linked traces
      const response = await request(app.server)
        .get(`/api/prompts/${linkedPromptId}/traces`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('traces');
      expect(Array.isArray(response.body.traces)).toBe(true);
      expect(response.body.traces.length).toBe(2);
      expect(response.body.traces[0].name).toBe('trace-2'); // DESC order
      expect(response.body.traces[1].name).toBe('trace-1');
    });

    it('GET /api/prompts/:id/traces 对不存在的 prompt 返回 404', async () => {
      await request(app.server)
        .get('/api/prompts/non-existent-id/traces')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });
  });

  // ==================== Multi-Model Comparison ====================
  describe('Multi-Model Comparison', () => {
    it('should run the same prompt across multiple models', async () => {
      // Create two model configs
      const config1Res = await request(app.server)
        .post('/api/model-configs')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          project_id: projectId,
          name: 'GPT-4',
          provider: 'openai',
          model: 'gpt-4',
          api_key: 'sk-test-gpt4-key',
        })
        .expect(201);

      const config2Res = await request(app.server)
        .post('/api/model-configs')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          project_id: projectId,
          name: 'Claude 3',
          provider: 'anthropic',
          model: 'claude-3-opus',
          api_key: 'sk-test-claude-key',
        })
        .expect(201);

      // Run with model 1
      const run1 = await request(app.server)
        .post('/api/playground/run')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          project_id: projectId,
          prompt_id: promptId,
          prompt_version_id: versionId,
          model: 'gpt-4',
          input: 'Compare test',
        })
        .expect(201);

      // Run with model 2
      const run2 = await request(app.server)
        .post('/api/playground/run')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          project_id: projectId,
          prompt_id: promptId,
          prompt_version_id: versionId,
          model: 'claude-3-opus',
          input: 'Compare test',
        })
        .expect(201);

      // Verify both runs exist
      const runsRes = await request(app.server)
        .get(`/api/playground/runs?project_id=${projectId}&prompt_id=${promptId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      const runs = runsRes.body;
      expect(runs.length).toBeGreaterThanOrEqual(2);
      const models = runs.map((r: any) => r.model);
      expect(models).toContain('gpt-4');
      expect(models).toContain('claude-3-opus');
    });
  });
});
