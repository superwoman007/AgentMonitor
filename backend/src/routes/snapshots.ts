import { FastifyInstance } from 'fastify';
import {
  getSnapshotById,
  getSnapshotsBySession,
  getSnapshotsByBreakpoint,
  getSnapshotCount,
  getSnapshotsByProject,
} from '../services/snapshot.js';
import { authMiddleware } from '../middleware/auth.js';
import { apikeyMiddleware } from '../middleware/apikey.js';
import { getProjectById } from '../services/project.js';
import { getSessionById } from '../services/session.js';
import { createSnapshot } from '../services/snapshot.js';

export async function snapshotsRoutes(app: FastifyInstance): Promise<void> {
  app.post('/', { preHandler: apikeyMiddleware }, async (request, reply) => {
    if (!request.projectId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const body = request.body as {
      sessionId: string;
      breakpointId?: string;
      triggerReason: string;
      state: Record<string, unknown>;
      timestamp?: string;
    };

    if (!body.sessionId || !body.triggerReason || !body.state) {
      reply.code(400).send({ error: 'sessionId, triggerReason, and state are required' });
      return;
    }

    const session = await getSessionById(body.sessionId);
    if (!session || session.project_id !== request.projectId) {
      reply.code(404).send({ error: 'Session not found' });
      return;
    }

    const snapshot = await createSnapshot({
      sessionId: body.sessionId,
      breakpointId: body.breakpointId,
      triggerReason: body.triggerReason,
      state: body.state,
      timestamp: body.timestamp ? new Date(body.timestamp) : undefined,
    });

    reply.code(201).send({ snapshot });
  });

  app.get('/', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    
    const query = request.query as {
      sessionId?: string;
      breakpointId?: string;
      projectId?: string;
    };
    
    if (!query.sessionId && !query.breakpointId && !query.projectId) {
      reply.code(400).send({ error: 'sessionId, breakpointId, or projectId is required' });
      return;
    }
    
    let snapshots;
    
    if (query.projectId) {
      const project = await getProjectById(query.projectId);
      if (!project || project.user_id !== request.userId) {
        reply.code(404).send({ error: 'Project not found' });
        return;
      }
      
      snapshots = await getSnapshotsByProject(query.projectId);
    } else if (query.sessionId) {
      const session = await getSessionById(query.sessionId);
      if (!session) {
        reply.code(404).send({ error: 'Session not found' });
        return;
      }
      
      const project = await getProjectById(session.project_id);
      if (!project || project.user_id !== request.userId) {
        reply.code(404).send({ error: 'Session not found' });
        return;
      }
      
      snapshots = await getSnapshotsBySession(query.sessionId);
    } else {
      snapshots = await getSnapshotsByBreakpoint(query.breakpointId!);
    }
    
    reply.send({ snapshots });
  });
  
  app.get('/:id', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    
    const params = request.params as { id: string };
    const snapshot = await getSnapshotById(params.id);
    
    if (!snapshot) {
      reply.code(404).send({ error: 'Snapshot not found' });
      return;
    }
    
    const session = await getSessionById(snapshot.session_id);
    if (!session) {
      reply.code(404).send({ error: 'Snapshot not found' });
      return;
    }
    
    const project = await getProjectById(session.project_id);
    if (!project || project.user_id !== request.userId) {
      reply.code(404).send({ error: 'Snapshot not found' });
      return;
    }
    
    reply.send({ snapshot });
  });
  
  app.get('/count/:sessionId', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    
    const params = request.params as { sessionId: string };
    
    const session = await getSessionById(params.sessionId);
    if (!session) {
      reply.code(404).send({ error: 'Session not found' });
      return;
    }
    
    const project = await getProjectById(session.project_id);
    if (!project || project.user_id !== request.userId) {
      reply.code(404).send({ error: 'Session not found' });
      return;
    }
    
    const count = await getSnapshotCount(params.sessionId);
    reply.send({ count });
  });
}
