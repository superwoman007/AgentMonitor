import { FastifyRequest, FastifyReply } from 'fastify';
import { verifyToken, getUserById } from '../services/auth.js';
import {
  verifyServiceToken,
  tokenHasScope,
  type ServiceToken,
  type ServiceTokenScope,
} from '../services/service-token.js';

declare module 'fastify' {
  interface FastifyRequest {
    userId?: string;
    serviceToken?: ServiceToken;
    /** 已鉴权主体所属项目 ID（Service Token 推断；JWT 仍需从 body/query 显式传入） */
    authProjectId?: string;
    /** 鉴权方式：用户 JWT 或 Service Token */
    authType?: 'user' | 'service_token';
  }
}

/**
 * 统一鉴权中间件：同时支持用户 JWT 与 Service Token。
 *
 * - `Authorization: Bearer <jwt>` → 用户鉴权
 * - `Authorization: Bearer amt_xxx` → Service Token 鉴权，并把 projectId 写入 request.authProjectId
 *
 * @param requiredScopes - 若提供，则 Service Token 必须包含这些 scope 之一；
 *                        JWT 用户不受 scope 限制（视为完全权限）。
 * @returns Fastify preHandler 中间件
 */
export function authWithScopes(...requiredScopes: ServiceTokenScope[]) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      reply.code(401).send({ error: 'Missing or invalid authorization header' });
      return;
    }
    const token = authHeader.slice(7);

    // Service Token 前缀判定
    if (token.startsWith('amt_')) {
      const result = await verifyServiceToken(token);
      if (!result.valid || !result.token) {
        reply.code(401).send({
          error: result.expired ? 'Service token expired' : 'Invalid or revoked service token',
        });
        return;
      }
      if (requiredScopes.length > 0) {
        const ok = requiredScopes.some((s) => tokenHasScope(result.token!, s));
        if (!ok) {
          reply.code(403).send({
            error: 'INSUFFICIENT_SCOPE',
            requiredScopes,
            tokenScopes: result.token.scopes,
          });
          return;
        }
      }
      request.serviceToken = result.token;
      request.authProjectId = result.projectId;
      request.authType = 'service_token';
      return;
    }

    // 默认走用户 JWT
    const payload = verifyToken(token);
    if (!payload) {
      reply.code(401).send({ error: 'Invalid or expired token' });
      return;
    }
    const user = await getUserById(payload.userId);
    if (!user) {
      reply.code(401).send({ error: 'User not found' });
      return;
    }
    request.userId = payload.userId;
    request.authType = 'user';
  };
}

/**
 * 标准用户 JWT 鉴权（保留原行为，Service Token 也被允许）。
 */
export async function authMiddleware(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  return authWithScopes()(request, reply);
}
