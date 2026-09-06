import type { FastifyInstance } from 'fastify';
import { queryOne } from '../db/index.js';
import { authMiddleware } from '../middleware/auth.js';
import {
  ROOT_CAUSES,
  VERDICTS,
  deleteAnnotation,
  getAnnotation,
  getRootCauseStats,
  listAnnotations,
  upsertTraceAnnotation,
} from '../services/trace-annotation.js';

/**
 * 校验用户是否为项目所有者。
 * @param userId - 当前登录用户 ID
 * @param projectId - 项目 ID
 * @returns 是否有访问权限
 */
async function userOwnsProject(userId: string, projectId: string): Promise<boolean> {
  const project = await queryOne<{ id: string }>(
    'SELECT id FROM projects WHERE id = $1 AND user_id = $2',
    [projectId, userId]
  );
  return project !== null;
}

/**
 * 校验 Trace 存在且归属该项目。
 * @param traceId - Trace 行 ID
 * @param projectId - 项目 ID
 * @returns 是否合法
 */
async function traceBelongsToProject(traceId: string, projectId: string): Promise<boolean> {
  const trace = await queryOne<{ id: string }>(
    'SELECT id FROM traces WHERE id = $1 AND project_id = $2',
    [traceId, projectId]
  );
  return trace !== null;
}

/**
 * 注册 Trace 人工标注路由（/api/v2 前缀下）：
 * - GET    /trace-annotations/enums
 * - GET    /trace-annotations?projectId=&rootCause=&verdict=
 * - GET    /trace-annotations/:traceId?projectId=
 * - PUT    /trace-annotations/:traceId
 * - DELETE /trace-annotations/:traceId?projectId=
 * - GET    /trace-annotations-stats?projectId=
 * @param app - Fastify 实例
 */
export async function traceAnnotationRoutes(app: FastifyInstance): Promise<void> {
  app.get('/trace-annotations/enums', { preHandler: authMiddleware }, async (_request, reply) => {
    reply.send({ rootCauses: [...ROOT_CAUSES], verdicts: [...VERDICTS] });
  });

  app.get('/trace-annotations-stats', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    const q = request.query as { projectId?: string };
    if (!q.projectId) {
      reply.code(400).send({ error: 'projectId is required' });
      return;
    }
    if (!(await userOwnsProject(request.userId, q.projectId))) {
      reply.code(404).send({ error: 'Project not found' });
      return;
    }
    const stats = await getRootCauseStats(q.projectId);
    reply.send({ stats });
  });

  app.get('/trace-annotations', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    const q = request.query as { projectId?: string; rootCause?: string; verdict?: string; limit?: string };
    if (!q.projectId) {
      reply.code(400).send({ error: 'projectId is required' });
      return;
    }
    if (!(await userOwnsProject(request.userId, q.projectId))) {
      reply.code(404).send({ error: 'Project not found' });
      return;
    }
    const annotations = await listAnnotations(q.projectId, {
      rootCause: q.rootCause,
      verdict: q.verdict,
      limit: q.limit ? Number(q.limit) : undefined,
    });
    reply.send({ annotations });
  });

  app.get('/trace-annotations/:traceId', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    const params = request.params as { traceId: string };
    const q = request.query as { projectId?: string };
    if (!q.projectId) {
      reply.code(400).send({ error: 'projectId is required' });
      return;
    }
    if (!(await userOwnsProject(request.userId, q.projectId))) {
      reply.code(404).send({ error: 'Project not found' });
      return;
    }
    const annotation = await getAnnotation(q.projectId, params.traceId);
    if (!annotation) {
      reply.code(404).send({ error: 'Annotation not found' });
      return;
    }
    reply.send({ annotation });
  });

  app.put('/trace-annotations/:traceId', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    const params = request.params as { traceId: string };
    const body = request.body as {
      projectId: string;
      rootCause?: string | null;
      verdict?: string | null;
      note?: string | null;
      tags?: string[];
      runItemId?: string | null;
    };
    if (!body.projectId) {
      reply.code(400).send({ error: 'projectId is required' });
      return;
    }
    if (!(await userOwnsProject(request.userId, body.projectId))) {
      reply.code(404).send({ error: 'Project not found' });
      return;
    }
    if (!(await traceBelongsToProject(params.traceId, body.projectId))) {
      reply.code(404).send({ error: 'Trace not found' });
      return;
    }
    try {
      const annotation = await upsertTraceAnnotation({
        projectId: body.projectId,
        traceId: params.traceId,
        rootCause: body.rootCause as never,
        verdict: body.verdict as never,
        note: body.note,
        tags: body.tags,
        runItemId: body.runItemId,
        createdBy: request.userId,
      });
      reply.send({ annotation });
    } catch (error) {
      reply.code(400).send({ error: error instanceof Error ? error.message : 'Failed to save annotation' });
    }
  });

  app.delete('/trace-annotations/:traceId', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    const params = request.params as { traceId: string };
    const q = request.query as { projectId?: string };
    if (!q.projectId) {
      reply.code(400).send({ error: 'projectId is required' });
      return;
    }
    if (!(await userOwnsProject(request.userId, q.projectId))) {
      reply.code(404).send({ error: 'Project not found' });
      return;
    }
    const ok = await deleteAnnotation(q.projectId, params.traceId);
    if (!ok) {
      reply.code(404).send({ error: 'Annotation not found' });
      return;
    }
    reply.code(204).send();
  });
}
