import type { FastifyInstance } from 'fastify';
import { queryOne } from '../db/index.js';
import { authMiddleware } from '../middleware/auth.js';
import {
  createAlertRule,
  deleteAlertRule,
  getAlertRule,
  listAlertEvents,
  listAlertRules,
  updateAlertRule,
} from '../services/alert-rule.js';

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
 * 注册持久化告警规则路由（/api/v2/evaluation 前缀下）：
 * - GET    /alert-rules?projectId=
 * - POST   /alert-rules
 * - GET    /alert-rules/:ruleId?projectId=
 * - PATCH  /alert-rules/:ruleId
 * - DELETE /alert-rules/:ruleId?projectId=
 * - GET    /alert-events?projectId=
 * @param app - Fastify 实例
 */
export async function alertRuleRoutes(app: FastifyInstance): Promise<void> {
  app.get('/alert-rules', { preHandler: authMiddleware }, async (request, reply) => {
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
    const rules = await listAlertRules(q.projectId);
    reply.send({ rules });
  });

  app.post('/alert-rules', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    const body = request.body as {
      projectId: string;
      name: string;
      eventType: 'run_failed' | 'run_regression' | 'run_completed';
      threshold?: number;
      webhookUrl?: string;
      channels?: string[];
      enabled?: boolean;
      cooldownMinutes?: number;
    };
    if (!body.projectId || !body.name || !body.eventType) {
      reply.code(400).send({ error: 'projectId, name and eventType are required' });
      return;
    }
    if (!(await userOwnsProject(request.userId, body.projectId))) {
      reply.code(404).send({ error: 'Project not found' });
      return;
    }
    if (body.eventType === 'run_regression' && body.threshold === undefined) {
      reply.code(400).send({ error: 'threshold (0~1 pass rate) is required for run_regression' });
      return;
    }
    try {
      const rule = await createAlertRule({
        projectId: body.projectId,
        name: body.name,
        eventType: body.eventType,
        threshold: body.threshold,
        webhookUrl: body.webhookUrl,
        channels: body.channels,
        enabled: body.enabled,
        cooldownMinutes: body.cooldownMinutes,
        createdBy: request.userId,
      });
      reply.code(201).send({ rule });
    } catch (error) {
      reply.code(400).send({ error: error instanceof Error ? error.message : 'Failed to create alert rule' });
    }
  });

  app.get('/alert-rules/:ruleId', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    const params = request.params as { ruleId: string };
    const q = request.query as { projectId?: string };
    if (!q.projectId) {
      reply.code(400).send({ error: 'projectId is required' });
      return;
    }
    if (!(await userOwnsProject(request.userId, q.projectId))) {
      reply.code(404).send({ error: 'Project not found' });
      return;
    }
    const rule = await getAlertRule(q.projectId, params.ruleId);
    if (!rule) {
      reply.code(404).send({ error: 'Alert rule not found' });
      return;
    }
    reply.send({ rule });
  });

  app.patch('/alert-rules/:ruleId', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    const params = request.params as { ruleId: string };
    const body = request.body as {
      projectId: string;
      name?: string;
      threshold?: number | null;
      webhookUrl?: string | null;
      channels?: string[];
      enabled?: boolean;
      cooldownMinutes?: number;
    };
    if (!body.projectId) {
      reply.code(400).send({ error: 'projectId is required' });
      return;
    }
    if (!(await userOwnsProject(request.userId, body.projectId))) {
      reply.code(404).send({ error: 'Project not found' });
      return;
    }
    const rule = await updateAlertRule(body.projectId, params.ruleId, {
      name: body.name,
      threshold: body.threshold,
      webhookUrl: body.webhookUrl,
      channels: body.channels,
      enabled: body.enabled,
      cooldownMinutes: body.cooldownMinutes,
    });
    if (!rule) {
      reply.code(404).send({ error: 'Alert rule not found' });
      return;
    }
    reply.send({ rule });
  });

  app.delete('/alert-rules/:ruleId', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    const params = request.params as { ruleId: string };
    const q = request.query as { projectId?: string };
    if (!q.projectId) {
      reply.code(400).send({ error: 'projectId is required' });
      return;
    }
    if (!(await userOwnsProject(request.userId, q.projectId))) {
      reply.code(404).send({ error: 'Project not found' });
      return;
    }
    const ok = await deleteAlertRule(q.projectId, params.ruleId);
    if (!ok) {
      reply.code(404).send({ error: 'Alert rule not found' });
      return;
    }
    reply.code(204).send();
  });

  app.get('/alert-events', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    const q = request.query as { projectId?: string; limit?: string };
    if (!q.projectId) {
      reply.code(400).send({ error: 'projectId is required' });
      return;
    }
    if (!(await userOwnsProject(request.userId, q.projectId))) {
      reply.code(404).send({ error: 'Project not found' });
      return;
    }
    const limit = q.limit ? Math.min(Number(q.limit) || 50, 200) : 50;
    const events = await listAlertEvents(q.projectId, limit);
    reply.send({ events });
  });
}
