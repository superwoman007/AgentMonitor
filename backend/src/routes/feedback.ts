import { FastifyInstance } from 'fastify';
import { createFeedback, getFeedbacksByProject, getFeedbackStats } from '../services/feedback.js';
import { authMiddleware } from '../middleware/auth.js';
import { apikeyMiddleware } from '../middleware/apikey.js';
import { getProjectById } from '../services/project.js';

export async function feedbackRoutes(app: FastifyInstance): Promise<void> {
  // POST /feedbacks - Create feedback (auth or API key)
  // We use a custom auth approach: try auth first, then API key
  app.post('/', async (request, reply) => {
    const authHeader = request.headers.authorization;
    const apiKeyHeader = request.headers['x-api-key'] as string | undefined;

    let resolvedProjectId: string | null = null;
    let authenticated = false;

    // Try auth token first
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const { verifyToken } = await import('../services/auth.js');
      const token = authHeader.slice(7);
      const payload = verifyToken(token);
      if (payload) {
        const body = request.body as { projectId?: string };
        if (!body.projectId) {
          reply.code(400).send({ error: 'projectId is required' });
          return;
        }
        const project = await getProjectById(body.projectId);
        if (!project || project.user_id !== payload.userId) {
          reply.code(404).send({ error: 'Project not found' });
          return;
        }
        resolvedProjectId = body.projectId;
        authenticated = true;
      }
    }

    // Try API key if not authenticated via token
    if (!authenticated && apiKeyHeader) {
      const { verifyApiKey } = await import('../services/apikey.js');
      const result = await verifyApiKey(apiKeyHeader);
      if (result.valid && result.projectId) {
        resolvedProjectId = result.projectId;
        authenticated = true;
      }
    }

    if (!authenticated || !resolvedProjectId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const body = request.body as {
      projectId?: string;
      sessionId?: string;
      messageId?: string;
      rating: number;
      reason?: string;
      comment?: string;
      dimensions?: Record<string, unknown>;
    };

    // Validate rating
    if (typeof body.rating !== 'number' || ![-1, 0, 1].includes(body.rating)) {
      reply.code(400).send({ error: 'rating must be -1, 0, or 1' });
      return;
    }

    const feedback = await createFeedback({
      projectId: resolvedProjectId,
      sessionId: body.sessionId,
      messageId: body.messageId,
      rating: body.rating,
      reason: body.reason,
      comment: body.comment,
      dimensions: body.dimensions,
    });

    reply.code(201).send({ feedback });
  });

  // GET /feedbacks - List feedbacks for project
  app.get('/', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const query = request.query as {
      projectId?: string;
      rating?: string;
      limit?: string;
      offset?: string;
    };

    if (!query.projectId) {
      reply.code(400).send({ error: 'projectId is required' });
      return;
    }

    const project = await getProjectById(query.projectId);
    if (!project || project.user_id !== request.userId) {
      reply.code(404).send({ error: 'Project not found' });
      return;
    }

    const feedbacks = await getFeedbacksByProject(query.projectId, {
      rating: query.rating ? parseInt(query.rating, 10) : undefined,
      limit: query.limit ? parseInt(query.limit, 10) : 50,
      offset: query.offset ? parseInt(query.offset, 10) : 0,
    });

    reply.send({ feedbacks });
  });

  // GET /feedbacks/stats - Feedback statistics
  app.get('/stats', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const query = request.query as { projectId?: string };

    if (!query.projectId) {
      reply.code(400).send({ error: 'projectId is required' });
      return;
    }

    const project = await getProjectById(query.projectId);
    if (!project || project.user_id !== request.userId) {
      reply.code(404).send({ error: 'Project not found' });
      return;
    }

    const stats = await getFeedbackStats(query.projectId);
    reply.send({ stats });
  });
}
