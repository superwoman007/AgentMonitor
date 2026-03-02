import { FastifyInstance } from 'fastify';
import {
  createProject,
  getProjectById,
  getProjectsByUser,
  updateProject,
  deleteProject,
} from '../services/project.js';
import { authMiddleware } from '../middleware/auth.js';

export async function projectsRoutes(app: FastifyInstance): Promise<void> {
  app.post('/', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    
    const body = request.body as {
      name: string;
      description?: string;
    };
    
    if (!body.name) {
      reply.code(400).send({ error: 'name is required' });
      return;
    }
    
    const project = await createProject(request.userId, body.name, body.description);
    reply.code(201).send(project);
  });
  
  app.get('/', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    
    const query = request.query as {
      limit?: string;
      offset?: string;
    };
    
    const projects = await getProjectsByUser(request.userId, {
      limit: query.limit ? parseInt(query.limit, 10) : 50,
      offset: query.offset ? parseInt(query.offset, 10) : 0,
    });
    
    reply.send(projects);
  });
  
  app.get('/:id', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    
    const params = request.params as { id: string };
    const project = await getProjectById(params.id);
    
    if (!project || project.user_id !== request.userId) {
      reply.code(404).send({ error: 'Project not found' });
      return;
    }
    
    reply.send(project);
  });
  
  app.put('/:id', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    
    const params = request.params as { id: string };
    const body = request.body as {
      name?: string;
      description?: string;
    };
    
    const project = await updateProject(params.id, request.userId, body);
    
    if (!project) {
      reply.code(404).send({ error: 'Project not found' });
      return;
    }
    
    reply.send(project);
  });
  
  app.delete('/:id', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    
    const params = request.params as { id: string };
    const deleted = await deleteProject(params.id, request.userId);
    
    if (!deleted) {
      reply.code(404).send({ error: 'Project not found' });
      return;
    }
    
    reply.code(204).send();
  });
}
