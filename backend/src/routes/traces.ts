import { FastifyInstance } from 'fastify';
import { createTrace, getTracesByProject, getTraceById, updateTrace } from '../services/trace.js';
import { apikeyMiddleware } from '../middleware/apikey.js';
import { authMiddleware } from '../middleware/auth.js';
import { getProjectById } from '../services/project.js';

export async function tracesRoutes(app: FastifyInstance): Promise<void> {
  app.post('/', { preHandler: apikeyMiddleware }, async (request, reply) => {
    if (!request.projectId) {
      reply.code(401).send({ error: 'Project not identified' });
      return;
    }
    
    const body = request.body as {
      sessionId?: string;
      agentId?: string;
      traceType: string;
      name: string;
      input?: unknown;
      output?: unknown;
      metadata?: unknown;
      startedAt?: string;
      endedAt?: string;
      latencyMs?: number;
      status?: string;
      error?: string;
    };
    
    if (!body.traceType || !body.name) {
      reply.code(400).send({ error: 'traceType and name are required' });
      return;
    }
    
    const trace = await createTrace({
      projectId: request.projectId,
      sessionId: body.sessionId,
      agentId: body.agentId,
      traceType: body.traceType,
      name: body.name,
      input: body.input,
      output: body.output,
      metadata: body.metadata,
      startedAt: body.startedAt ? new Date(body.startedAt) : new Date(),
      endedAt: body.endedAt ? new Date(body.endedAt) : undefined,
      latencyMs: body.latencyMs,
      status: body.status,
      error: body.error,
    });
    
    app.log.info({ traceId: trace.id, projectId: request.projectId }, 'Trace created');
    
    reply.code(201).send({ trace });
  });
  
  app.get('/', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    
    const query = request.query as {
      projectId?: string;
      sessionId?: string;
      traceType?: string;
      status?: string;
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
    
    const traces = await getTracesByProject(query.projectId, {
      sessionId: query.sessionId,
      traceType: query.traceType,
      status: query.status,
      limit: query.limit ? parseInt(query.limit, 10) : 50,
      offset: query.offset ? parseInt(query.offset, 10) : 0,
    });
    
    reply.send({ traces });
  });
  
  app.get('/:id', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    
    const params = request.params as { id: string };
    const trace = await getTraceById(params.id);
    
    if (!trace) {
      reply.code(404).send({ error: 'Trace not found' });
      return;
    }
    
    const project = await getProjectById(trace.project_id);
    if (!project || project.user_id !== request.userId) {
      reply.code(404).send({ error: 'Trace not found' });
      return;
    }
    
    reply.send({ trace });
  });
  
  app.patch('/:id', { preHandler: apikeyMiddleware }, async (request, reply) => {
    if (!request.projectId) {
      reply.code(401).send({ error: 'Project not identified' });
      return;
    }
    
    const params = request.params as { id: string };
    const body = request.body as {
      output?: unknown;
      endedAt?: string;
      latencyMs?: number;
      status?: string;
      error?: string;
    };
    
    const existingTrace = await getTraceById(params.id);
    if (!existingTrace || existingTrace.project_id !== request.projectId) {
      reply.code(404).send({ error: 'Trace not found' });
      return;
    }
    
    const trace = await updateTrace(params.id, {
      output: body.output,
      endedAt: body.endedAt ? new Date(body.endedAt) : undefined,
      latencyMs: body.latencyMs,
      status: body.status,
      error: body.error,
    });
    
    reply.send({ trace });
  });
}
