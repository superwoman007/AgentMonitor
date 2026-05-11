import { FastifyRequest, FastifyReply } from 'fastify';
import { verifyToken, getUserById } from '../services/auth.js';

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

  // 验证 user 是否存在于数据库（防止数据库重置后旧 token 仍有效）
  const user = await getUserById(payload.userId);
  if (!user) {
    reply.code(401).send({ error: 'User not found' });
    return;
  }
  
  request.userId = payload.userId;
}
