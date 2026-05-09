import { FastifyInstance } from 'fastify';
import { authMiddleware } from '../middleware/auth.js';
import { createModelConfig, getModelConfigById, getModelConfigsByProject, deleteModelConfig } from '../services/prompts.js';

export async function modelConfigRoutes(app: FastifyInstance): Promise<void> {
  app.post('/', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const body = request.body as {
      project_id: string;
      name: string;
      provider: string;
      model: string;
      config?: Record<string, unknown>;
      api_key?: string;
      base_url?: string;
    };

    if (!body.project_id) {
      reply.code(400).send({ error: 'project_id is required' });
      return;
    }
    if (!body.name) {
      reply.code(400).send({ error: 'name is required' });
      return;
    }
    if (!body.provider) {
      reply.code(400).send({ error: 'provider is required' });
      return;
    }
    if (!body.model) {
      reply.code(400).send({ error: 'model is required' });
      return;
    }

    const cfg = await createModelConfig(body.project_id, body.name, body.provider, body.model, body.config, body.api_key, body.base_url);
    reply.code(201).send(cfg);
  });

  app.get('/', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const query = request.query as { project_id?: string };
    if (!query.project_id) {
      reply.code(400).send({ error: 'project_id is required' });
      return;
    }

    const configs = await getModelConfigsByProject(query.project_id);
    reply.send(configs);
  });

  app.get('/:id', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const params = request.params as { id: string };
    const cfg = await getModelConfigById(params.id);

    if (!cfg) {
      reply.code(404).send({ error: 'Model config not found' });
      return;
    }

    reply.send(cfg);
  });

  app.delete('/:id', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const params = request.params as { id: string };
    const deleted = await deleteModelConfig(params.id);

    if (!deleted) {
      reply.code(404).send({ error: 'Model config not found' });
      return;
    }

    reply.code(204).send();
  });
}
