import { FastifyInstance } from 'fastify';
import { authMiddleware } from '../middleware/auth.js';
import {
  createPrompt,
  getPromptById,
  getPromptsByProject,
  updatePrompt,
  deletePrompt,
  getVersionsByPrompt,
  getVersionById,
  rollbackPrompt,
  createPromptVersion,
} from '../services/prompts.js';
import { getTracesByPrompt } from '../services/trace.js';
import { createExperiment } from '../services/evaluation.js';
import { optimizePrompt, applyOptimization } from '../services/prompt-optimizer.js';

export async function promptsRoutes(app: FastifyInstance): Promise<void> {
  // ==================== Prompts ====================

  app.post('/', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const body = request.body as {
      project_id: string;
      name: string;
      description?: string;
      content: string;
      config?: Record<string, unknown>;
    };

    if (!body.project_id) {
      reply.code(400).send({ error: 'project_id is required' });
      return;
    }
    if (!body.name) {
      reply.code(400).send({ error: 'name is required' });
      return;
    }
    if (!body.content) {
      reply.code(400).send({ error: 'content is required' });
      return;
    }

    const prompt = await createPrompt(body.project_id, body.name, body.content, body.description, body.config);
    reply.code(201).send(prompt);
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

    const prompts = await getPromptsByProject(query.project_id);
    reply.send(prompts);
  });

  app.get('/:id', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const params = request.params as { id: string };
    const prompt = await getPromptById(params.id);

    if (!prompt) {
      reply.code(404).send({ error: 'Prompt not found' });
      return;
    }

    reply.send(prompt);
  });

  app.put('/:id', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const params = request.params as { id: string };
    const body = request.body as {
      content?: string;
      config?: Record<string, unknown>;
      description?: string;
    };

    const prompt = await updatePrompt(params.id, body);

    if (!prompt) {
      reply.code(404).send({ error: 'Prompt not found' });
      return;
    }

    reply.send(prompt);
  });

  app.delete('/:id', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const params = request.params as { id: string };
    const deleted = await deletePrompt(params.id);

    if (!deleted) {
      reply.code(404).send({ error: 'Prompt not found' });
      return;
    }

    reply.code(204).send();
  });

  // ==================== Prompt Versions ====================

  app.post('/:id/versions', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const params = request.params as { id: string };
    const body = request.body as {
      content?: string;
      config?: Record<string, unknown>;
      description?: string;
      auto_regression?: boolean;
      regression_dataset_id?: string;
      regression_model_config_id?: string;
      regression_evaluator_id?: string;
    };

    try {
      const { version, prompt } = await createPromptVersion(params.id, {
        content: body.content,
        config: body.config,
        description: body.description,
      });

      // Auto regression: create an experiment if requested
      let regressionExperiment = null;
      if (body.auto_regression && body.regression_dataset_id && prompt) {
        if (!body.regression_model_config_id || !body.regression_evaluator_id) {
          throw new Error('Auto regression requires regression_model_config_id and regression_evaluator_id');
        }
        regressionExperiment = await createExperiment(
          prompt.project_id,
          `${prompt.name} 回归测试 v${version.version_number}`,
          body.regression_dataset_id,
          `Auto-created regression test for prompt version ${version.version_number}`,
          undefined,
          prompt.id,
          version.id,
          body.regression_model_config_id,
          version.config || undefined,
          body.regression_evaluator_id
        );
      }

      reply.code(201).send({
        version,
        prompt,
        regression_experiment: regressionExperiment,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create version';
      reply.code(400).send({ error: message });
    }
  });

  app.get('/:id/versions', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const params = request.params as { id: string };
    const versions = await getVersionsByPrompt(params.id);
    reply.send(versions);
  });

  app.get('/versions/:versionId', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const params = request.params as { versionId: string };
    const version = await getVersionById(params.versionId);

    if (!version) {
      reply.code(404).send({ error: 'Version not found' });
      return;
    }

    reply.send(version);
  });

  app.post('/:id/rollback/:versionId', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const params = request.params as { id: string; versionId: string };
    const prompt = await rollbackPrompt(params.id, params.versionId);

    if (!prompt) {
      reply.code(404).send({ error: 'Prompt or version not found' });
      return;
    }

    reply.send(prompt);
  });

  // GET /prompts/:id/traces - 获取关联某 Prompt 的 Traces
  app.get('/:id/traces', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const params = request.params as { id: string };
    const prompt = await getPromptById(params.id);

    if (!prompt) {
      reply.code(404).send({ error: 'Prompt not found' });
      return;
    }

    const traces = await getTracesByPrompt(params.id);
    reply.send({ traces });
  });

  // POST /prompts/:id/optimize - AI 辅助 Prompt 调优
  app.post('/:id/optimize', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const params = request.params as { id: string };
    const body = request.body as {
      experiment_id: string;
      model_config_id?: string;
    };

    if (!body.experiment_id) {
      reply.code(400).send({ error: 'experiment_id is required' });
      return;
    }

    const prompt = await getPromptById(params.id);
    if (!prompt) {
      reply.code(404).send({ error: 'Prompt not found' });
      return;
    }

    try {
      const result = await optimizePrompt(params.id, body.experiment_id, body.model_config_id);
      reply.send(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to optimize prompt';
      if (message.includes('not found')) {
        reply.code(404).send({ error: message });
      } else {
        reply.code(400).send({ error: message });
      }
    }
  });

  // POST /prompts/:id/optimize/apply - 应用优化建议
  app.post('/:id/optimize/apply', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const params = request.params as { id: string };
    const body = request.body as {
      optimized_prompt: string;
      description?: string;
    };

    if (!body.optimized_prompt) {
      reply.code(400).send({ error: 'optimized_prompt is required' });
      return;
    }

    const prompt = await getPromptById(params.id);
    if (!prompt) {
      reply.code(404).send({ error: 'Prompt not found' });
      return;
    }

    try {
      const result = await applyOptimization(params.id, body.optimized_prompt, body.description);
      reply.code(201).send(result.version);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to apply optimization';
      reply.code(400).send({ error: message });
    }
  });
}
