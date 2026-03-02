import { FastifyInstance } from 'fastify';
import { getQualityScore, getQualityTrend } from '../services/quality.js';
import { authMiddleware } from '../middleware/auth.js';
import { getProjectById } from '../services/project.js';

export async function qualityRoutes(app: FastifyInstance): Promise<void> {
  app.get('/score', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const query = request.query as { projectId: string };
    
    const project = await getProjectById(query.projectId);
    if (!project || project.user_id !== request.userId) {
      reply.code(404).send({ error: 'Project not found' });
      return;
    }

    const score = await getQualityScore(query.projectId);
    reply.send({ score });
  });

  app.get('/trend', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const query = request.query as { projectId: string; days?: string };
    
    const project = await getProjectById(query.projectId);
    if (!project || project.user_id !== request.userId) {
      reply.code(404).send({ error: 'Project not found' });
      return;
    }

    const days = parseInt(query.days || '7', 10);
    const trend = await getQualityTrend(query.projectId, days);
    reply.send({ trend });
  });
}
