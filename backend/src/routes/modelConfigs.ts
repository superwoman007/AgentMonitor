import { FastifyInstance } from 'fastify';
import { authMiddleware } from '../middleware/auth.js';
import { createModelConfig, getModelConfigById, getModelConfigsByProject, updateModelConfig, deleteModelConfig } from '../services/prompts.js';
import { callLLM } from '../services/llm-client.js';

function sanitizeConfig(cfg: Record<string, unknown>): Record<string, unknown> {
  if (typeof cfg.api_key === 'string' && cfg.api_key.length > 8) {
    cfg.api_key = `${cfg.api_key.slice(0, 4)}...${cfg.api_key.slice(-4)}`;
  }
  return cfg;
}

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
    reply.code(201).send(sanitizeConfig(cfg as unknown as Record<string, unknown>));
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
    reply.send(configs.map(c => sanitizeConfig(c as unknown as Record<string, unknown>)));
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

    reply.send(sanitizeConfig(cfg as unknown as Record<string, unknown>));
  });

  app.put('/:id', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const params = request.params as { id: string };
    const body = request.body as {
      name?: string; provider?: string; model?: string;
      config?: Record<string, unknown>; api_key?: string; base_url?: string;
    };

    const cfg = await updateModelConfig(params.id, body);
    if (!cfg) {
      reply.code(404).send({ error: 'Model config not found' });
      return;
    }

    reply.send(sanitizeConfig(cfg as unknown as Record<string, unknown>));
  });

  app.post('/:id/test', { preHandler: authMiddleware }, async (request, reply) => {
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
    if (!cfg.api_key) {
      reply.code(400).send({ error: 'No API key configured' });
      return;
    }

    const startTime = Date.now();
    try {
      const response = await callLLM({
        model: cfg.model,
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: 'Say "pong" only.' },
        ],
        apiKey: cfg.api_key,
        baseUrl: cfg.base_url,
        maxTokens: 10,
        timeoutMs: 5000,
      });

      const latencyMs = Date.now() - startTime;
      reply.send({
        success: true,
        latency_ms: latencyMs,
        model: cfg.model,
        response_preview: response.content.slice(0, 100),
        token_usage: response.usage,
      });
    } catch (error) {
      reply.send({
        success: false,
        latency_ms: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      });
    }
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
