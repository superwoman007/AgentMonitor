import type { FastifyInstance } from 'fastify';
import { queryOne } from '../db/index.js';
import { authMiddleware } from '../middleware/auth.js';
import {
  createSamplingRule,
  deleteSamplingRule,
  getSamplingRule,
  listSamplingRules,
  runSamplingScan,
  updateSamplingRule,
  type SamplingRule,
} from '../services/trace-sampling.js';

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
 * 序列化采样规则：把 SQLite 的 0/1 布尔字段转为真实布尔。
 * @param row - 数据库行
 * @returns 前端响应体
 */
function serialize(row: SamplingRule) {
  return {
    ...row,
    error_only: Boolean(row.error_only),
    enabled: Boolean(row.enabled),
  };
}

/**
 * 注册 Trace Sampling 规则管理路由（/api/v2/evaluation 前缀下）：
 * - GET    /sampling-rules?projectId=
 * - POST   /sampling-rules
 * - GET    /sampling-rules/:ruleId?projectId=
 * - PATCH  /sampling-rules/:ruleId
 * - DELETE /sampling-rules/:ruleId?projectId=
 * - POST   /sampling-rules/:ruleId/run-now?projectId=  立即执行一轮采样
 * @param app - Fastify 实例
 */
export async function traceSamplingRuleRoutes(app: FastifyInstance): Promise<void> {
  app.get('/sampling-rules', { preHandler: authMiddleware }, async (request, reply) => {
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
    const rules = await listSamplingRules(q.projectId);
    reply.send({ rules: rules.map(serialize) });
  });

  app.post('/sampling-rules', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    const body = request.body as {
      projectId: string;
      name: string;
      targetDatasetId: string;
      traceTypeFilter?: string;
      nameContains?: string;
      statusFilter?: string;
      errorOnly?: boolean;
      sampleRate?: number;
      maxItemsTotal?: number;
      enabled?: boolean;
    };
    if (!body.projectId || !body.name || !body.targetDatasetId) {
      reply.code(400).send({ error: 'projectId, name and targetDatasetId are required' });
      return;
    }
    if (!(await userOwnsProject(request.userId, body.projectId))) {
      reply.code(404).send({ error: 'Project not found' });
      return;
    }
    try {
      const rule = await createSamplingRule({
        projectId: body.projectId,
        name: body.name,
        targetDatasetId: body.targetDatasetId,
        traceTypeFilter: body.traceTypeFilter,
        nameContains: body.nameContains,
        statusFilter: body.statusFilter,
        errorOnly: body.errorOnly,
        sampleRate: body.sampleRate,
        maxItemsTotal: body.maxItemsTotal,
        enabled: body.enabled,
        createdBy: request.userId,
      });
      reply.code(201).send({ rule: serialize(rule) });
    } catch (error) {
      reply.code(400).send({ error: error instanceof Error ? error.message : 'Failed to create rule' });
    }
  });

  app.get('/sampling-rules/:ruleId', { preHandler: authMiddleware }, async (request, reply) => {
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
    const rule = await getSamplingRule(q.projectId, params.ruleId);
    if (!rule) {
      reply.code(404).send({ error: 'Rule not found' });
      return;
    }
    reply.send({ rule: serialize(rule) });
  });

  app.patch('/sampling-rules/:ruleId', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    const params = request.params as { ruleId: string };
    const body = request.body as {
      projectId: string;
      name?: string;
      targetDatasetId?: string;
      traceTypeFilter?: string | null;
      nameContains?: string | null;
      statusFilter?: string | null;
      errorOnly?: boolean;
      sampleRate?: number;
      maxItemsTotal?: number | null;
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
      const rule = await updateSamplingRule(body.projectId, params.ruleId, {
        name: body.name,
        targetDatasetId: body.targetDatasetId,
        traceTypeFilter: body.traceTypeFilter,
        nameContains: body.nameContains,
        statusFilter: body.statusFilter,
        errorOnly: body.errorOnly,
        sampleRate: body.sampleRate,
        maxItemsTotal: body.maxItemsTotal,
        enabled: body.enabled,
      });
      if (!rule) {
        reply.code(404).send({ error: 'Rule not found' });
        return;
      }
      reply.send({ rule: serialize(rule) });
    } catch (error) {
      reply.code(400).send({ error: error instanceof Error ? error.message : 'Failed to update rule' });
    }
  });

  app.delete('/sampling-rules/:ruleId', { preHandler: authMiddleware }, async (request, reply) => {
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
    const ok = await deleteSamplingRule(q.projectId, params.ruleId);
    if (!ok) {
      reply.code(404).send({ error: 'Rule not found' });
      return;
    }
    reply.code(204).send();
  });

  app.post('/sampling-rules/:ruleId/run-now', { preHandler: authMiddleware }, async (request, reply) => {
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
    const rule = await getSamplingRule(q.projectId, params.ruleId);
    if (!rule) {
      reply.code(404).send({ error: 'Rule not found' });
      return;
    }
    const result = await runSamplingScan(rule);
    reply.code(201).send(result);
  });
}
