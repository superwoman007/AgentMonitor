import { FastifyRequest, FastifyReply } from 'fastify';
import { verifyToken } from '../services/auth.js';

declare module 'fastify' {
  interface FastifyRequest {
    userId?: string;
  }
}

export async function authMiddleware(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const authHeader = request.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    reply.code(401).send({ error: 'Missing or invalid authorization header' });
    return;
  }
  
  const token = authHeader.slice(7);
  const payload = verifyToken(token);
  
  if (!payload) {
    reply.code(401).send({ error: 'Invalid or expired token' });
    return;
  }
  
  request.userId = payload.userId;
}
