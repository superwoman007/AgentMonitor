import { FastifyInstance } from 'fastify';
import { 
  createAlert, 
  getAlertsByProject, 
  getAlertById, 
  updateAlert, 
  deleteAlert,
  getAlertHistory,
  checkAlerts
} from '../services/alert.js';
import { authMiddleware } from '../middleware/auth.js';
import { getProjectById } from '../services/project.js';
import { getProjectStats } from '../services/stats.js';
import { getCostByProject } from '../services/cost.js';

export async function alertsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: authMiddleware }, async (request, reply) => {
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

    const alerts = getAlertsByProject(query.projectId);
    const history = getAlertHistory(query.projectId, 50);
    reply.send({ alerts, history });
  });

  app.post('/', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const body = request.body as {
      projectId: string;
      name: string;
      type: 'latency' | 'error_rate' | 'cost' | 'custom';
      condition: string;
      threshold: number;
      enabled?: boolean;
    };
    
    const project = await getProjectById(body.projectId);
    if (!project || project.user_id !== request.userId) {
      reply.code(404).send({ error: 'Project not found' });
      return;
    }

    const alert = createAlert(body);
    reply.code(201).send({ alert });
  });

  app.put('/:id', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const params = request.params as { id: string };
    const body = request.body as Partial<{
      name: string;
      type: 'latency' | 'error_rate' | 'cost' | 'custom';
      condition: string;
      threshold: number;
      enabled: boolean;
    }>;

    const alert = getAlertById(params.id);
    if (!alert) {
      reply.code(404).send({ error: 'Alert not found' });
      return;
    }

    const project = await getProjectById(alert.projectId);
    if (!project || project.user_id !== request.userId) {
      reply.code(404).send({ error: 'Alert not found' });
      return;
    }

    const updated = updateAlert(params.id, body);
    reply.send({ alert: updated });
  });

  app.delete('/:id', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const params = request.params as { id: string };

    const alert = getAlertById(params.id);
    if (!alert) {
      reply.code(404).send({ error: 'Alert not found' });
      return;
    }

    const project = await getProjectById(alert.projectId);
    if (!project || project.user_id !== request.userId) {
      reply.code(404).send({ error: 'Alert not found' });
      return;
    }

    deleteAlert(params.id);
    reply.code(204).send();
  });

  app.post('/check', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const body = request.body as { projectId: string };
    
    const project = await getProjectById(body.projectId);
    if (!project || project.user_id !== request.userId) {
      reply.code(404).send({ error: 'Project not found' });
      return;
    }

    const [stats, costSummary] = await Promise.all([
      getProjectStats(body.projectId),
      getCostByProject(body.projectId, 1),
    ]);

    const triggered = checkAlerts(body.projectId, {
      avgLatency: stats.avgLatencyMs || undefined,
      errorRate: stats.errorRate,
      dailyCost: costSummary.today,
    });

    reply.send({ triggered });
  });
}
