import type { FastifyInstance } from 'fastify';
import { queryOne } from '../db/index.js';
import { authMiddleware } from '../middleware/auth.js';
import {
  PROMPT_ENVIRONMENTS,
  buildRuntimeResponse,
  deleteDeployment,
  deployPromptVersion,
  getDeployment,
  listDeployments,
  resolveDeployedPrompt,
} from '../services/prompt-deployment.js';
import { getPromptAbAnalytics } from '../services/prompt-ab-analytics.js';
import { getPromptById } from '../services/prompts.js';
import { deleteAbVariant, listAbVariants, upsertAbVariant } from '../services/prompt-ab-test.js';

/**
 * 校验用户是否为项目成员/所有者。
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
 注册 Prompt Deployment 管理与 Runtime 解析路由。
 *
 * 管理接口：
 * - GET    /prompt-deployments?projectId=&promptId=
 * - GET    /prompt-deployments/:promptId?environment=
 * - PUT    /prompt-deployments/:promptId  {environment, promptVersionId, note}
 * - DELETE /prompt-deployments/:promptId?environment=
 *
 * Runtime 接口：
 * - GET    /runtime/prompts/:promptName?environment=production  支持 If-None-Match
 *
 * @param app - Fastify 实例
 */
export async function promptDeploymentRoutes(app: FastifyInstance): Promise<void> {
  app.get('/prompt-deployments/environments', { preHandler: authMiddleware }, async (_request, reply) => {
    reply.send({ environments: [...PROMPT_ENVIRONMENTS] });
  });

  app.get('/prompt-deployments', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    const q = request.query as { projectId?: string; promptId?: string };
    if (!q.projectId) {
      reply.code(400).send({ error: 'projectId is required' });
      return;
    }
    if (!(await userOwnsProject(request.userId, q.projectId))) {
      reply.code(404).send({ error: 'Project not found' });
      return;
    }
    const deployments = await listDeployments(q.projectId, q.promptId);
    reply.send({ deployments });
  });

  app.get('/prompt-deployments/:promptId', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    const params = request.params as { promptId: string };
    const q = request.query as { environment?: string };
    const prompt = await getPromptById(params.promptId);
    if (!prompt || !(await userOwnsProject(request.userId, prompt.project_id))) {
      reply.code(404).send({ error: 'Prompt not found' });
      return;
    }
    const env = q.environment ?? 'production';
    const deployment = await getDeployment(prompt.project_id, params.promptId, env);
    if (!deployment) {
      reply.code(404).send({ error: `No deployment for environment ${env}` });
      return;
    }
    reply.send({ deployment });
  });

  app.put('/prompt-deployments/:promptId', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    const params = request.params as { promptId: string };
    const body = request.body as {
      projectId: string;
      promptVersionId: string;
      environment: string;
      note?: string;
    };
    if (!body.projectId || !body.promptVersionId || !body.environment) {
      reply.code(400).send({ error: 'projectId, promptVersionId and environment are required' });
      return;
    }
    if (!(await userOwnsProject(request.userId, body.projectId))) {
      reply.code(404).send({ error: 'Project not found' });
      return;
    }
    try {
      const deployment = await deployPromptVersion(
        body.projectId,
        params.promptId,
        body.promptVersionId,
        body.environment,
        { deployedBy: request.userId, note: body.note }
      );
      reply.send({ deployment });
    } catch (error) {
      reply.code(400).send({ error: error instanceof Error ? error.message : 'Failed to deploy prompt' });
    }
  });

  app.delete('/prompt-deployments/:promptId', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    const params = request.params as { promptId: string };
    const q = request.query as { projectId?: string; environment?: string };
    if (!q.projectId || !q.environment) {
      reply.code(400).send({ error: 'projectId and environment are required' });
      return;
    }
    if (!(await userOwnsProject(request.userId, q.projectId))) {
      reply.code(404).send({ error: 'Project not found' });
      return;
    }
    const ok = await deleteDeployment(q.projectId, params.promptId, q.environment);
    if (!ok) {
      reply.code(404).send({ error: 'Deployment not found' });
      return;
    }
    reply.code(204).send();
  });

  // ===== Prompt A/B 实验变体管理 =====

  app.get('/prompt-ab-variants/:promptId', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    const params = request.params as { promptId: string };
    const q = request.query as { projectId?: string; environment?: string };
    if (!q.projectId || !q.environment) {
      reply.code(400).send({ error: 'projectId and environment are required' });
      return;
    }
    const prompt = await getPromptById(params.promptId);
    if (!prompt || !(await userOwnsProject(request.userId, prompt.project_id)) || q.projectId !== prompt.project_id) {
      reply.code(404).send({ error: 'Prompt not found' });
      return;
    }
    const variants = await listAbVariants(q.projectId, params.promptId, q.environment);
    reply.send({ variants });
  });

  app.put('/prompt-ab-variants/:promptId/:variantKey', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    const params = request.params as { promptId: string; variantKey: string };
    const body = request.body as {
      projectId: string;
      environment: string;
      promptVersionId: string;
      weight: number;
      note?: string;
      enabled?: boolean;
    };
    if (!body.projectId || !body.environment || !body.promptVersionId || body.weight === undefined) {
      reply.code(400).send({ error: 'projectId, environment, promptVersionId and weight are required' });
      return;
    }
    const prompt = await getPromptById(params.promptId);
    if (!prompt || !(await userOwnsProject(request.userId, body.projectId))) {
      reply.code(404).send({ error: 'Prompt not found' });
      return;
    }
    try {
      const variant = await upsertAbVariant({
        projectId: body.projectId,
        promptId: params.promptId,
        environment: body.environment,
        variantKey: params.variantKey,
        promptVersionId: body.promptVersionId,
        weight: body.weight,
        note: body.note,
        enabled: body.enabled,
        createdBy: request.userId,
      });
      reply.send({ variant });
    } catch (error) {
      reply.code(400).send({ error: error instanceof Error ? error.message : 'Failed to upsert variant' });
    }
  });

  app.delete('/prompt-ab-variants/:promptId/:variantKey', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    const params = request.params as { promptId: string; variantKey: string };
    const q = request.query as { projectId?: string; environment?: string };
    if (!q.projectId || !q.environment) {
      reply.code(400).send({ error: 'projectId and environment are required' });
      return;
    }
    if (!(await userOwnsProject(request.userId, q.projectId))) {
      reply.code(404).send({ error: 'Project not found' });
      return;
    }
    const ok = await deleteAbVariant(q.projectId, params.promptId, q.environment, params.variantKey);
    if (!ok) {
      reply.code(404).send({ error: 'Variant not found' });
      return;
    }
    reply.code(204).send();
  });

  /**
   * A/B 效果分析：按环境聚合真实 Trace 指标，比较基线与变体。
   */
  app.get('/prompt-ab-analytics/:promptId', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    const params = request.params as { promptId: string };
    const q = request.query as { projectId?: string; environment?: string; days?: string };
    if (!q.projectId || !q.environment) {
      reply.code(400).send({ error: 'projectId and environment are required' });
      return;
    }
    const prompt = await getPromptById(params.promptId);
    if (!prompt || !(await userOwnsProject(request.userId, q.projectId)) || q.projectId !== prompt.project_id) {
      reply.code(404).send({ error: 'Prompt not found' });
      return;
    }
    try {
      const report = await getPromptAbAnalytics(
        q.projectId,
        params.promptId,
        q.environment,
        q.days ? Number.parseInt(q.days, 10) : undefined
      );
      reply.send({ report });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to analyze A/B variants';
      if (message.includes('not found') || message.includes('is not deployed')) {
        reply.code(404).send({ error: message });
        return;
      }
      reply.code(400).send({ error: message });
    }
  });

  // Runtime API：按项目 + Prompt 名称 + 环境解析已发布版本，支持 ETag/304 与 A/B 分桶。
  // 同时允许 JWT 或具备任意 scope 的 Service Token（CLI/Agent SDK 通常携带 telemetry:write 或 prompts:read）。
  // A/B 分桶：通过 ?bucketKey=<userId|sessionId> 或 X-Bucket-Key 头传入稳定分桶键，
  // 命中变体时响应体携带 variantKey/bucket，SDK 可将其写入 Trace metadata。
  app.get('/runtime/prompts/:promptName', { preHandler: authMiddleware }, async (request, reply) => {
    const params = request.params as { promptName: string };
    const q = request.query as { environment?: string; projectId?: string; bucketKey?: string };
    const environment = q.environment ?? 'production';
    const headerBucketKey = request.headers['x-bucket-key'];
    const bucketKey =
      q.bucketKey ?? (Array.isArray(headerBucketKey) ? headerBucketKey[0] : headerBucketKey) ?? null;

    // Service Token 自带 projectId；JWT 用户通过 X-Project-Id 头或 ?projectId= 指定
    const headerProjectId = request.headers['x-project-id'];
    const projectId =
      request.authProjectId ??
      (Array.isArray(headerProjectId) ? headerProjectId[0] : headerProjectId) ??
      q.projectId;
    if (!projectId) {
      reply.code(400).send({ error: 'projectId is required (set via X-Project-Id header, ?projectId=, or service token)' });
      return;
    }
    if (request.userId && !(await userOwnsProject(request.userId, projectId))) {
      reply.code(404).send({ error: 'Project not found' });
      return;
    }

    const resolved = await resolveDeployedPrompt(
      projectId,
      decodeURIComponent(params.promptName),
      environment,
      bucketKey
    );
    if (!resolved) {
      reply.code(404).send({ error: `Prompt "${params.promptName}" is not deployed to ${environment}` });
      return;
    }

    const response = buildRuntimeResponse(resolved.deployment, resolved.prompt, resolved.version, resolved.etag, {
      variantKey: resolved.variantKey,
      bucket: resolved.bucket,
    });
    const ifNoneMatch = request.headers['if-none-match'];
    if (ifNoneMatch && ifNoneMatch === response.etag) {
      reply.code(304).send();
      return;
    }
    reply.header('ETag', response.etag);
    reply.header('Cache-Control', 'private, max-age=60');
    reply.send(response);
  });
}
