import { FastifyInstance } from 'fastify';
import { 
  getCostByProject, 
  getCostByModel, 
  getMostExpensive, 
  getCostOptimizationSuggestions,
  getCostTrend 
} from '../services/cost.js';
import { authMiddleware } from '../middleware/auth.js';
import { getProjectById } from '../services/project.js';

export async function costRoutes(app: FastifyInstance): Promise<void> {
  app.get('/summary', { preHandler: authMiddleware }, async (request, reply) => {
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
    const [summary, trend] = await Promise.all([
      getCostByProject(query.projectId, days),
      getCostTrend(query.projectId, days),
    ]);
    
    reply.send({ summary, trend });
  });

  app.get('/by-model', { preHandler: authMiddleware }, async (request, reply) => {
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

    const byModel = await getCostByModel(query.projectId);
    reply.send({ byModel });
  });

  app.get('/top', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const query = request.query as { projectId: string; limit?: string };
    
    const project = await getProjectById(query.projectId);
    if (!project || project.user_id !== request.userId) {
      reply.code(404).send({ error: 'Project not found' });
      return;
    }

    const limit = parseInt(query.limit || '10', 10);
    const top = await getMostExpensive(query.projectId, limit);
    reply.send({ top });
  });

  app.get('/suggestions', { preHandler: authMiddleware }, async (request, reply) => {
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

    const suggestions = await getCostOptimizationSuggestions(query.projectId);
    reply.send({ suggestions });
  });
}
