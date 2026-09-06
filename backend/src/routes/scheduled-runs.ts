import type { FastifyInstance } from 'fastify';
import { queryOne } from '../db/index.js';
import { authMiddleware } from '../middleware/auth.js';
import {
  createScheduledRun,
  deleteScheduledRun,
  getScheduledRun,
  listScheduledRuns,
  listScheduledRunExecutions,
  listScheduledRunsByExperiment,
  updateScheduledRun,
  triggerScheduledRun,
  type ScheduledRun,
  type ScheduledRunExecution,
} from '../services/scheduled-run.js';

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
 * 将 ScheduledRun 以布尔 enabled 输出（SQLite 存 0/1，PG 存 boolean）。
 * @param row - 数据库行
 * @returns 前端响应体
 */
function serialize(row: ScheduledRun) {
  return { ...row, enabled: Boolean(row.enabled) };
}

/**
 * 将 ScheduledRunExecution 统一为前端可消费结构。
 * @param row - 数据库行
 * @returns 序列化结果
 */
function serializeExecution(row: ScheduledRunExecution) {
  return row;
}

/**
 * 注册 Scheduled Run 管理路由（/api/v2/evaluation 前缀下）：
 * - GET    /schedules?projectId=&experimentId=
 * - POST   /schedules
 * - GET    /schedules/:scheduleId?projectId=
 * - PATCH  /schedules/:scheduleId
 * - DELETE /schedules/:scheduleId?projectId=
 * - POST   /schedules/:scheduleId/run-now?projectId=
 * - GET    /schedules/:scheduleId/executions?projectId=&limit=
 * @param app - Fastify 实例
 */
export async function scheduledRunRoutes(app: FastifyInstance): Promise<void> {
  app.get('/schedules', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    const q = request.query as { projectId?: string; experimentId?: string };
    if (!q.projectId) {
      reply.code(400).send({ error: 'projectId is required' });
      return;
    }
    if (!(await userOwnsProject(request.userId, q.projectId))) {
      reply.code(404).send({ error: 'Project not found' });
      return;
    }
    const schedules = q.experimentId
      ? await listScheduledRunsByExperiment(q.projectId, q.experimentId)
      : await listScheduledRuns(q.projectId);
    reply.send({ schedules: schedules.map(serialize) });
  });

  app.post('/schedules', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    const body = request.body as {
      projectId: string;
      experimentId: string;
      name: string;
      scheduleType?: 'interval' | 'cron';
      intervalMinutes?: number;
      cronExpr?: string;
      enabled?: boolean;
    };
    if (!body.projectId || !body.experimentId || !body.name) {
      reply.code(400).send({ error: 'projectId, experimentId and name are required' });
      return;
    }
    if (!(await userOwnsProject(request.userId, body.projectId))) {
      reply.code(404).send({ error: 'Project not found' });
      return;
    }
    try {
      const schedule = await createScheduledRun({
        projectId: body.projectId,
        experimentId: body.experimentId,
        name: body.name,
        scheduleType: body.scheduleType ?? 'interval',
        intervalMinutes: body.intervalMinutes,
        cronExpr: body.cronExpr,
        enabled: body.enabled,
        createdBy: request.userId,
      });
      reply.code(201).send({ schedule: serialize(schedule) });
    } catch (error) {
      reply.code(400).send({ error: error instanceof Error ? error.message : 'Failed to create schedule' });
    }
  });

  app.get('/schedules/:scheduleId', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    const params = request.params as { scheduleId: string };
    const q = request.query as { projectId?: string };
    if (!q.projectId) {
      reply.code(400).send({ error: 'projectId is required' });
      return;
    }
    if (!(await userOwnsProject(request.userId, q.projectId))) {
      reply.code(404).send({ error: 'Project not found' });
      return;
    }
    const schedule = await getScheduledRun(q.projectId, params.scheduleId);
    if (!schedule) {
      reply.code(404).send({ error: 'Schedule not found' });
      return;
    }
    reply.send({ schedule: serialize(schedule) });
  });

  app.patch('/schedules/:scheduleId', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    const params = request.params as { scheduleId: string };
    const body = request.body as {
      projectId: string;
      name?: string;
      scheduleType?: 'interval' | 'cron';
      intervalMinutes?: number;
      cronExpr?: string;
      enabled?: boolean;
    };
    if (!body.projectId) {
      reply.code(400).send({ error: 'projectId is required' });
      return;
    }
    if (!(await userOwnsProject(request.userId, body.projectId))) {
      reply.code(404).send({ error: 'Project not found' });
      return;
    }
    try {
      const schedule = await updateScheduledRun(body.projectId, params.scheduleId, {
        name: body.name,
        scheduleType: body.scheduleType,
        intervalMinutes: body.intervalMinutes,
        cronExpr: body.cronExpr,
        enabled: body.enabled,
      });
      if (!schedule) {
        reply.code(404).send({ error: 'Schedule not found' });
        return;
      }
      reply.send({ schedule: serialize(schedule) });
    } catch (error) {
      reply.code(400).send({ error: error instanceof Error ? error.message : 'Failed to update schedule' });
    }
  });

  app.delete('/schedules/:scheduleId', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    const params = request.params as { scheduleId: string };
    const q = request.query as { projectId?: string };
    if (!q.projectId) {
      reply.code(400).send({ error: 'projectId is required' });
      return;
    }
    if (!(await userOwnsProject(request.userId, q.projectId))) {
      reply.code(404).send({ error: 'Project not found' });
      return;
    }
    const ok = await deleteScheduledRun(q.projectId, params.scheduleId);
    if (!ok) {
      reply.code(404).send({ error: 'Schedule not found' });
      return;
    }
    reply.code(204).send();
  });

  app.post('/schedules/:scheduleId/run-now', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    const params = request.params as { scheduleId: string };
    const q = request.query as { projectId?: string };
    if (!q.projectId) {
      reply.code(400).send({ error: 'projectId is required' });
      return;
    }
    if (!(await userOwnsProject(request.userId, q.projectId))) {
      reply.code(404).send({ error: 'Project not found' });
      return;
    }
    const schedule = await getScheduledRun(q.projectId, params.scheduleId);
    if (!schedule) {
      reply.code(404).send({ error: 'Schedule not found' });
      return;
    }
    const prep = await triggerScheduledRun(schedule, 'manual');
    if (!prep) {
      reply.code(400).send({ error: 'Failed to trigger run (experiment validation or preparation error)' });
      return;
    }
    reply.code(201).send({ runId: prep.run.id, status: prep.run.status });
  });

  app.get('/schedules/:scheduleId/executions', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    const params = request.params as { scheduleId: string };
    const q = request.query as { projectId?: string; limit?: string };
    if (!q.projectId) {
      reply.code(400).send({ error: 'projectId is required' });
      return;
    }
    if (!(await userOwnsProject(request.userId, q.projectId))) {
      reply.code(404).send({ error: 'Project not found' });
      return;
    }
    const schedule = await getScheduledRun(q.projectId, params.scheduleId);
    if (!schedule) {
      reply.code(404).send({ error: 'Schedule not found' });
      return;
    }
    const limit = q.limit ? Number.parseInt(q.limit, 10) : 20;
    const executions = await listScheduledRunExecutions(q.projectId, params.scheduleId, limit);
    reply.send({ executions: executions.map(serializeExecution) });
  });
}
