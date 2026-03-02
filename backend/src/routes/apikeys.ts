import { FastifyInstance } from 'fastify';
import { createApiKey, getApiKeysByProject, revokeApiKey, getDecryptedApiKey } from '../services/apikey.js';
import { authMiddleware } from '../middleware/auth.js';
import { getProjectById } from '../services/project.js';

export async function apikeysRoutes(app: FastifyInstance): Promise<void> {
  app.post('/', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    
    const body = request.body as {
      project_id: string;
      name: string;
    };
    
    if (!body.project_id || !body.name) {
      reply.code(400).send({ error: 'project_id and name are required' });
      return;
    }
    
    const project = await getProjectById(body.project_id);
    if (!project || project.user_id !== request.userId) {
      reply.code(404).send({ error: 'Project not found' });
      return;
    }
    
    const apiKey = await createApiKey(body.project_id, body.name);
    reply.code(201).send(apiKey);
  });
  
  app.get('/', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    
    const query = request.query as {
      project_id: string;
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
    
    const apiKeys = await getApiKeysByProject(query.project_id);
    console.log('API Keys response:', JSON.stringify(apiKeys, null, 2));
    reply.send(apiKeys);
  });
  
  // GET /:id/secret - 返回解密后的完整 API Key（必须在 DELETE /:id 之前）
  app.get('/:id/secret', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    
    const params = request.params as { id: string };
    
    // 不需要 projectId，直接通过 id 查询
    const secret = await getDecryptedApiKey(params.id, request.userId);
    
    if (!secret) {
      reply.code(404).send({ error: 'API key not found or cannot be decrypted' });
      return;
    }
    
    reply.send({ key: secret });
  });
  
  app.delete('/:id', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    
    const params = request.params as { id: string };
    
    // 不需要 projectId，直接通过 id 吊销
    const result = await revokeApiKey(params.id, request.userId);
    
    if (!result.success) {
      if (result.alreadyRevoked) {
        reply.code(400).send({ error: 'API key already revoked' });
      } else {
        reply.code(404).send({ error: 'API key not found' });
      }
      return;
    }
    
    reply.code(204).send();
  });
}
