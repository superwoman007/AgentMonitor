import { FastifyInstance } from 'fastify';
import {
  createBreakpoint,
  getBreakpointById,
  getBreakpointsByProject,
  updateBreakpoint,
  deleteBreakpoint,
  toggleBreakpoint,
  checkBreakpoints,
  BreakpointCreateData,
  BreakpointUpdateData,
  CheckContext,
} from '../services/breakpoint.js';
import { createSnapshot } from '../services/snapshot.js';
import { authMiddleware } from '../middleware/auth.js';
import { apikeyMiddleware } from '../middleware/apikey.js';
import { getProjectById } from '../services/project.js';

export async function breakpointsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/public', { preHandler: apikeyMiddleware }, async (request, reply) => {
    if (!request.projectId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const breakpoints = await getBreakpointsByProject(request.projectId);
    reply.send({ breakpoints });
  });

  app.get('/', { preHandler: authMiddleware }, async (request, reply) => {
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
    
    const breakpoints = await getBreakpointsByProject(query.projectId);
    reply.send({ breakpoints });
  });
  
  app.post('/', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    
    const body = request.body as BreakpointCreateData;
    
    if (!body.projectId || !body.name || !body.type || !body.condition) {
      reply.code(400).send({ error: 'projectId, name, type, and condition are required' });
      return;
    }
    
    const project = await getProjectById(body.projectId);
    if (!project || project.user_id !== request.userId) {
      reply.code(404).send({ error: 'Project not found' });
      return;
    }
    
    const breakpoint = await createBreakpoint(body);
    reply.code(201).send({ breakpoint });
  });
  
  app.get('/:id', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    
    const params = request.params as { id: string };
    const breakpoint = await getBreakpointById(params.id);
    
    if (!breakpoint) {
      reply.code(404).send({ error: 'Breakpoint not found' });
      return;
    }
    
    const project = await getProjectById(breakpoint.project_id);
    if (!project || project.user_id !== request.userId) {
      reply.code(404).send({ error: 'Breakpoint not found' });
      return;
    }
    
    reply.send({ breakpoint });
  });
  
  app.put('/:id', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    
    const params = request.params as { id: string };
    const body = request.body as BreakpointUpdateData;
    
    const breakpoint = await getBreakpointById(params.id);
    if (!breakpoint) {
      reply.code(404).send({ error: 'Breakpoint not found' });
      return;
    }
    
    const project = await getProjectById(breakpoint.project_id);
    if (!project || project.user_id !== request.userId) {
      reply.code(404).send({ error: 'Breakpoint not found' });
      return;
    }
    
    const updated = await updateBreakpoint(params.id, body);
    reply.send({ breakpoint: updated });
  });
  
  app.delete('/:id', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    
    const params = request.params as { id: string };
    
    const breakpoint = await getBreakpointById(params.id);
    if (!breakpoint) {
      reply.code(404).send({ error: 'Breakpoint not found' });
      return;
    }
    
    const project = await getProjectById(breakpoint.project_id);
    if (!project || project.user_id !== request.userId) {
      reply.code(404).send({ error: 'Breakpoint not found' });
      return;
    }
    
    await deleteBreakpoint(params.id);
    reply.code(204).send();
  });
  
  app.post('/:id/toggle', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    
    const params = request.params as { id: string };
    
    const breakpoint = await getBreakpointById(params.id);
    if (!breakpoint) {
      reply.code(404).send({ error: 'Breakpoint not found' });
      return;
    }
    
    const project = await getProjectById(breakpoint.project_id);
    if (!project || project.user_id !== request.userId) {
      reply.code(404).send({ error: 'Breakpoint not found' });
      return;
    }
    
    const updated = await toggleBreakpoint(params.id);
    reply.send({ breakpoint: updated });
  });
  
  app.post('/check', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    
    const body = request.body as {
      projectId: string;
      context: CheckContext;
    };
    
    if (!body.projectId) {
      reply.code(400).send({ error: 'projectId is required' });
      return;
    }
    
    const project = await getProjectById(body.projectId);
    if (!project || project.user_id !== request.userId) {
      reply.code(404).send({ error: 'Project not found' });
      return;
    }
    
    const triggeredBreakpoints = await checkBreakpoints(body.projectId, body.context);
    
    reply.send({
      triggered: triggeredBreakpoints,
      count: triggeredBreakpoints.length,
    });
  });
}
