import { FastifyInstance } from 'fastify';
import { authMiddleware } from '../middleware/auth.js';
import { getProjectById } from '../services/project.js';
import {
  createTarget,
  createTargetVersion,
  getTargetById,
  getTargetVersionById,
  invokePromptModelTarget,
  listTargetVersions,
  listTargets,
} from '../services/agent-target.js';

/**
 * 校验当前用户是否拥有指定项目。
 * @param userId - 用户 ID
 * @param projectId - 项目 ID
 * @returns 项目存在且属于该用户返回 true
 */
async function userOwnsProject(userId: string, projectId: string): Promise<boolean> {
  const project = await getProjectById(projectId);
  return !!project && project.user_id === userId;
}

/**
 * 注册 Agent Target 相关路由。
 * @param app - Fastify 应用实例
 * @returns 无返回值
 */
export async function agentTargetRoutes(app: FastifyInstance): Promise<void> {
  app.get('/targets', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const query = request.query as { projectId?: string };
    if (!query.projectId) {
      reply.code(400).send({ error: 'projectId is required' });
      return;
    }

    if (!(await userOwnsProject(request.userId, query.projectId))) {
      reply.code(404).send({ error: 'Project not found' });
      return;
    }

    const targets = await listTargets(query.projectId);
    reply.send({ targets });
  });

  app.post('/targets', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const body = request.body as {
      projectId: string;
      name: string;
      description?: string;
      type: 'prompt_model' | 'http_agent' | 'external_runner' | 'trace_replay';
      invocationConfig: Record<string, unknown>;
      inputMapping?: Record<string, string>;
      outputMapping?: Record<string, string>;
      sourceRevision?: Record<string, unknown>;
      enabled?: boolean;
    };

    if (!body.projectId || !body.name || !body.type || !body.invocationConfig) {
      reply.code(400).send({ error: 'projectId, name, type and invocationConfig are required' });
      return;
    }

    if (!(await userOwnsProject(request.userId, body.projectId))) {
      reply.code(404).send({ error: 'Project not found' });
      return;
    }

    try {
      const result = await createTarget({
        projectId: body.projectId,
        name: body.name,
        description: body.description,
        type: body.type,
        invocationConfig: body.invocationConfig,
        inputMapping: body.inputMapping,
        outputMapping: body.outputMapping,
        sourceRevision: body.sourceRevision,
        enabled: body.enabled,
        createdBy: request.userId,
      });
      reply.code(201).send(result);
    } catch (error) {
      reply.code(400).send({ error: error instanceof Error ? error.message : 'Failed to create target' });
    }
  });

  app.get('/targets/:id', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const params = request.params as { id: string };
    const target = await getTargetById(params.id);
    if (!target || !(await userOwnsProject(request.userId, target.project_id))) {
      reply.code(404).send({ error: 'Target not found' });
      return;
    }

    const versions = await listTargetVersions(target.id);
    reply.send({ target, versions });
  });

  app.get('/targets/:id/versions', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const params = request.params as { id: string };
    const target = await getTargetById(params.id);
    if (!target || !(await userOwnsProject(request.userId, target.project_id))) {
      reply.code(404).send({ error: 'Target not found' });
      return;
    }

    const versions = await listTargetVersions(target.id);
    reply.send({ versions });
  });

  app.post('/targets/:id/versions', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const params = request.params as { id: string };
    const target = await getTargetById(params.id);
    if (!target || !(await userOwnsProject(request.userId, target.project_id))) {
      reply.code(404).send({ error: 'Target not found' });
      return;
    }

    const body = request.body as {
      invocationConfig: Record<string, unknown>;
      inputMapping?: Record<string, string>;
      outputMapping?: Record<string, string>;
      sourceRevision?: Record<string, unknown>;
    };

    if (!body.invocationConfig) {
      reply.code(400).send({ error: 'invocationConfig is required' });
      return;
    }

    try {
      const result = await createTargetVersion(target.id, {
        invocationConfig: body.invocationConfig,
        inputMapping: body.inputMapping,
        outputMapping: body.outputMapping,
        sourceRevision: body.sourceRevision,
        createdBy: request.userId,
      });
      reply.code(201).send(result);
    } catch (error) {
      reply.code(400).send({ error: error instanceof Error ? error.message : 'Failed to create version' });
    }
  });

  app.get('/target-versions/:id', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const params = request.params as { id: string };
    const version = await getTargetVersionById(params.id);
    if (!version) {
      reply.code(404).send({ error: 'Target version not found' });
      return;
    }

    const target = await getTargetById(version.target_id);
    if (!target || !(await userOwnsProject(request.userId, target.project_id))) {
      reply.code(404).send({ error: 'Target version not found' });
      return;
    }

    reply.send({ target, version });
  });

  app.post('/target-versions/:id/test-invoke', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const params = request.params as { id: string };
    const body = request.body as { input?: string };
    const version = await getTargetVersionById(params.id);
    if (!version) {
      reply.code(404).send({ error: 'Target version not found' });
      return;
    }

    const target = await getTargetById(version.target_id);
    if (!target || !(await userOwnsProject(request.userId, target.project_id))) {
      reply.code(404).send({ error: 'Target version not found' });
      return;
    }

    if (version.target_type !== 'prompt_model') {
      reply.code(400).send({ error: `test-invoke is not implemented for ${version.target_type}` });
      return;
    }

    const result = await invokePromptModelTarget(version, body.input || '');
    reply.send({ result });
  });
}
