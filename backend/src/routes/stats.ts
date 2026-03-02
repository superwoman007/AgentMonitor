import { FastifyInstance } from 'fastify';
import { getProjectStats, getUserStats } from '../services/stats.js';
import { authMiddleware } from '../middleware/auth.js';
import { getProjectById } from '../services/project.js';

export async function statsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    
    const query = request.query as {
      projectId?: string;
    };
    
    if (query.projectId) {
      const project = await getProjectById(query.projectId);
      if (!project || project.user_id !== request.userId) {
        reply.code(404).send({ error: 'Project not found' });
        return;
      }
      
      const stats = await getProjectStats(query.projectId);
      reply.send({ stats });
    } else {
      const stats = await getUserStats(request.userId);
      reply.send({ stats });
    }
  });
}
