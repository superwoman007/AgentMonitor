import { FastifyRequest, FastifyReply } from 'fastify';
import { verifyApiKey } from '../services/apikey.js';

declare module 'fastify' {
  interface FastifyRequest {
    projectId?: string;
  }
}

export async function apikeyMiddleware(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const apiKeyHeader = request.headers['x-api-key'] as string | undefined;
  const authHeader = request.headers.authorization;
  const bearerKey = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
  const apiKey = apiKeyHeader || bearerKey;
  
  if (!apiKey) {
    reply.code(401).send({ error: 'Missing API key' });
    return;
  }
  
  const result = await verifyApiKey(apiKey);
  
  if (!result.valid || !result.projectId) {
    reply.code(401).send({ error: 'Invalid or revoked API key' });
    return;
  }
  
  request.projectId = result.projectId;
}
