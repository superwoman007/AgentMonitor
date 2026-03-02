import { FastifyRequest, FastifyReply } from 'fastify';
import { verifyApiKey } from '../services/apikey.js';

declare module 'fastify' {
  interface FastifyRequest {
    projectId?: string;
  }
}

export async function apikeyMiddleware(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const apiKey = request.headers['x-api-key'] as string;
  
  if (!apiKey) {
    reply.code(401).send({ error: 'Missing X-API-Key header' });
    return;
  }
  
  const result = await verifyApiKey(apiKey);
  
  if (!result.valid || !result.projectId) {
    reply.code(401).send({ error: 'Invalid or revoked API key' });
    return;
  }
  
  request.projectId = result.projectId;
}
