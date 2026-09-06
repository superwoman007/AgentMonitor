import { FastifyInstance } from 'fastify';
import { authMiddleware } from '../middleware/auth.js';
import { getProjectById } from '../services/project.js';
import {
  createEvaluatorSuite,
  createEvaluatorSuiteVersion,
  getEvaluatorSuiteById,
  getSuiteVersionById,
  listEvaluatorSuites,
  listSuiteMembers,
  listSuiteVersions,
} from '../services/evaluator-suite.js';

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
 * 注册 Evaluator Suite V2 路由。
 * @param app - Fastify 实例
 * @returns 无返回值
 */
export async function evaluatorSuiteRoutes(app: FastifyInstance): Promise<void> {
  app.get('/suites', { preHandler: authMiddleware }, async (request, reply) => {
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
    const suites = await listEvaluatorSuites(query.projectId);
    reply.send({ suites });
  });

  app.post('/suites', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    const body = request.body as {
      projectId: string;
      name: string;
      description?: string;
      members: Array<{
        evaluatorVersionId: string;
        alias: string;
        weight?: number;
        required?: boolean;
        passThreshold?: number;
        ordinal?: number;
      }>;
      aggregationConfig?: { strategy?: 'weighted_avg' | 'all_required' | 'any_pass'; passThreshold?: number };
    };

    if (!body.projectId || !body.name || !Array.isArray(body.members)) {
      reply.code(400).send({ error: 'projectId, name and members are required' });
      return;
    }
    if (!(await userOwnsProject(request.userId, body.projectId))) {
      reply.code(404).send({ error: 'Project not found' });
      return;
    }

    try {
      const result = await createEvaluatorSuite(body.projectId, body.name, body.members, {
        description: body.description,
        aggregationConfig: body.aggregationConfig,
        createdBy: request.userId,
      });
      reply.code(201).send(result);
    } catch (error) {
      reply.code(400).send({ error: error instanceof Error ? error.message : 'Failed to create suite' });
    }
  });

  app.get('/suites/:id', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    const params = request.params as { id: string };
    const suite = await getEvaluatorSuiteById(params.id);
    if (!suite || !(await userOwnsProject(request.userId, suite.project_id))) {
      reply.code(404).send({ error: 'Suite not found' });
      return;
    }
    const versions = await listSuiteVersions(suite.id);
    reply.send({ suite, versions });
  });

  app.get('/suites/:id/versions', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    const params = request.params as { id: string };
    const suite = await getEvaluatorSuiteById(params.id);
    if (!suite || !(await userOwnsProject(request.userId, suite.project_id))) {
      reply.code(404).send({ error: 'Suite not found' });
      return;
    }
    const versions = await listSuiteVersions(suite.id);
    reply.send({ versions });
  });

  app.post('/suites/:id/versions', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    const params = request.params as { id: string };
    const suite = await getEvaluatorSuiteById(params.id);
    if (!suite || !(await userOwnsProject(request.userId, suite.project_id))) {
      reply.code(404).send({ error: 'Suite not found' });
      return;
    }

    const body = request.body as {
      description?: string;
      members: Array<{
        evaluatorVersionId: string;
        alias: string;
        weight?: number;
        required?: boolean;
        passThreshold?: number;
        ordinal?: number;
      }>;
      aggregationConfig?: { strategy?: 'weighted_avg' | 'all_required' | 'any_pass'; passThreshold?: number };
    };
    if (!Array.isArray(body.members)) {
      reply.code(400).send({ error: 'members is required' });
      return;
    }

    try {
      const result = await createEvaluatorSuiteVersion(suite.id, body.members, {
        description: body.description,
        aggregationConfig: body.aggregationConfig,
        createdBy: request.userId,
      });
      reply.code(201).send(result);
    } catch (error) {
      reply.code(400).send({ error: error instanceof Error ? error.message : 'Failed to create suite version' });
    }
  });

  app.get('/suite-versions/:id', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    const params = request.params as { id: string };
    const version = await getSuiteVersionById(params.id);
    if (!version) {
      reply.code(404).send({ error: 'Suite version not found' });
      return;
    }
    const suite = await getEvaluatorSuiteById(version.suite_id);
    if (!suite || !(await userOwnsProject(request.userId, suite.project_id))) {
      reply.code(404).send({ error: 'Suite version not found' });
      return;
    }
    const members = await listSuiteMembers(version.id);
    reply.send({ suite, version, members });
  });

  app.get('/suite-versions/:id/members', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    const params = request.params as { id: string };
    const version = await getSuiteVersionById(params.id);
    if (!version) {
      reply.code(404).send({ error: 'Suite version not found' });
      return;
    }
    const suite = await getEvaluatorSuiteById(version.suite_id);
    if (!suite || !(await userOwnsProject(request.userId, suite.project_id))) {
      reply.code(404).send({ error: 'Suite version not found' });
      return;
    }
    const members = await listSuiteMembers(version.id);
    reply.send({ members });
  });
}
