import { FastifyInstance } from 'fastify';
import { authMiddleware } from '../middleware/auth.js';
import { getRunById, getRunsByProject } from '../services/prompts.js';
import { compareModels, runPlaygroundModel } from '../services/playground.js';

export async function playgroundRoutes(app: FastifyInstance): Promise<void> {
  app.post('/run', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const body = request.body as {
      project_id: string;
      prompt_id?: string;
      prompt_version_id?: string;
      model_config_id?: string;
      model?: string;
      target_version_id?: string;
      input: string;
    };

    if (!body.project_id) {
      reply.code(400).send({ error: 'project_id is required' });
      return;
    }
    if (!body.model_config_id && !body.model && !body.target_version_id) {
      reply.code(400).send({ error: 'model_config_id, model or target_version_id is required' });
      return;
    }
    if (!body.input) {
      reply.code(400).send({ error: 'input is required' });
      return;
    }

    try {
      const run = await runPlaygroundModel({
        projectId: body.project_id,
        input: body.input,
        promptId: body.prompt_id,
        promptVersionId: body.prompt_version_id,
        modelConfigId: body.model_config_id,
        model: body.model,
        targetVersionId: body.target_version_id,
      });
      reply.code(201).send(run);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Playground run failed';
      reply.code(400).send({ error: message });
    }
  });

  app.get('/runs', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const query = request.query as { project_id?: string; prompt_id?: string };
    if (!query.project_id) {
      reply.code(400).send({ error: 'project_id is required' });
      return;
    }

    const runs = await getRunsByProject(query.project_id, query.prompt_id);
    reply.send(runs);
  });

  app.get('/runs/:id', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const params = request.params as { id: string };
    const run = await getRunById(params.id);

    if (!run) {
      reply.code(404).send({ error: 'Run not found' });
      return;
    }

    reply.send(run);
  });

  // POST /api/playground/compare - 多模型对比运行
  app.post('/compare', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const body = request.body as {
      project_id: string;
      prompt_id?: string;
      prompt_version_id?: string;
      input: string;
      model_config_ids: string[];
    };

    if (!body.project_id) {
      reply.code(400).send({ error: 'project_id is required' });
      return;
    }

    if (!body.input || body.input.trim().length === 0) {
      reply.code(400).send({ error: 'input is required' });
      return;
    }

    if (!body.model_config_ids || !Array.isArray(body.model_config_ids)) {
      reply.code(400).send({ error: 'model_config_ids is required and must be an array' });
      return;
    }

    if (body.model_config_ids.length < 2) {
      reply.code(400).send({ error: '至少需要选择 2 个模型进行对比' });
      return;
    }

    try {
      const result = await compareModels({
        projectId: body.project_id,
        input: body.input,
        modelConfigIds: body.model_config_ids,
        promptId: body.prompt_id,
        promptVersionId: body.prompt_version_id,
      });

      reply.send(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Compare failed';
      reply.code(400).send({ error: message });
    }
  });
}
