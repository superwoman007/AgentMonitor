import { FastifyInstance } from 'fastify';
import { getProjectStats, getUserStats, getObservationStats, getTrendStats } from '../services/stats.js';
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

  app.get('/observation', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    
    const query = request.query as {
      project_id?: string;
    };
    
    if (!query.project_id) {
      reply.code(400).send({ error: 'project_id is required' });
      return;
    }
    
    const project = await getProjectById(query.project_id);
    if (!project || project.user_id !== request.userId) {
      reply.code(404).send({ error: 'Project not found' });
      return;
    }
    
    const stats = await getObservationStats(query.project_id);
    reply.send(stats);
  });

  app.get('/trend', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const query = request.query as {
      project_id?: string;
      days?: string;
    };

    if (!query.project_id) {
      reply.code(400).send({ error: 'project_id is required' });
      return;
    }

    const project = await getProjectById(query.project_id);
    if (!project || project.user_id !== request.userId) {
      reply.code(404).send({ error: 'Project not found' });
      return;
    }

    const days = query.days ? parseInt(query.days, 10) : 7;
    const trend = await getTrendStats(query.project_id, days);
    reply.send({ trend });
  });
}
