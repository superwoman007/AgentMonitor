import { FastifyInstance } from 'fastify';
import { authMiddleware } from '../middleware/auth.js';
import { getProjectById } from '../services/project.js';
import {
  createServiceToken,
  listServiceTokens,
  revokeServiceToken,
  SERVICE_TOKEN_SCOPES,
} from '../services/service-token.js';

/**
 * 校验当前用户拥有项目。
 */
async function ensureProjectOwner(userId: string | undefined, projectId: string): Promise<boolean> {
  if (!userId) return false;
  const project = await getProjectById(projectId);
  return !!project && project.user_id === userId;
}

/**
 * PR-10 Service Token 管理路由（仅项目所有者可管理）。
 * @param app - Fastify 实例
 */
export async function serviceTokenRoutes(app: FastifyInstance): Promise<void> {
  /** 列出所有合法 scope（供 UI/CLI 展示） */
  app.get('/service-tokens/scopes', { preHandler: authMiddleware }, async (_request, reply) => {
    reply.send({ scopes: SERVICE_TOKEN_SCOPES });
  });

  /** 创建 Service Token（明文只返回一次） */
  app.post('/service-tokens', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    const body = (request.body ?? {}) as {
      projectId: string;
      name: string;
      scopes?: string[];
      expiresInDays?: number | null;
    };
    if (!body.projectId || !body.name) {
      reply.code(400).send({ error: 'projectId and name are required' });
      return;
    }
    if (!(await ensureProjectOwner(request.userId, body.projectId))) {
      reply.code(404).send({ error: 'Project not found' });
      return;
    }

    const expiresAt =
      typeof body.expiresInDays === 'number' && body.expiresInDays > 0
        ? new Date(Date.now() + body.expiresInDays * 86_400_000)
        : null;

    const created = await createServiceToken(body.projectId, body.name, {
      scopes: body.scopes,
      expiresAt,
      createdBy: request.userId,
    });
    reply.code(201).send({ token: created });
  });

  /** 列出项目的所有 Service Token */
  app.get('/service-tokens', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    const query = request.query as { projectId?: string };
    if (!query.projectId) {
      reply.code(400).send({ error: 'projectId query is required' });
      return;
    }
    if (!(await ensureProjectOwner(request.userId, query.projectId))) {
      reply.code(404).send({ error: 'Project not found' });
      return;
    }
    const tokens = await listServiceTokens(query.projectId);
    // 不返回 hash 给前端
    const safe = tokens.map(({ token_hash: _hash, ...rest }) => rest);
    reply.send({ tokens: safe });
  });

  /** 撤销 Service Token */
  app.delete('/service-tokens/:id', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    const params = request.params as { id: string };
    const ok = await revokeServiceToken(params.id);
    if (!ok) {
      reply.code(404).send({ error: 'Token not found or already revoked' });
      return;
    }
    reply.send({ revoked: true });
  });
}
