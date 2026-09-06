import { FastifyInstance } from 'fastify';
import { authMiddleware } from '../middleware/auth.js';
import { getProjectById } from '../services/project.js';
import { getIntegrationStatus } from '../services/integration-status.js';

/**
 * 注册接入诊断相关路由。
 * @param app - Fastify 应用实例
 * @returns 无返回值
 */
export async function integrationStatusRoutes(app: FastifyInstance): Promise<void> {
  app.get('/:projectId/integration-status', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const params = request.params as { projectId: string };
    const project = await getProjectById(params.projectId);
    if (!project || project.user_id !== request.userId) {
      reply.code(404).send({ error: 'Project not found' });
      return;
    }

    const status = await getIntegrationStatus(params.projectId);
    reply.send(status);
  });
}
