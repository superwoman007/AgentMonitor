import { FastifyInstance } from 'fastify';
import { authWithScopes } from '../middleware/auth.js';
import {
  createRunnerSession,
  closeRunnerSession,
  heartbeatRunnerSession,
  runnerClaimItem,
  runnerHeartbeatItem,
  runnerSubmitResult,
  runnerFailItem,
} from '../services/runner-session.js';
import { getRunById } from '../services/evaluation-run.js';

/**
 * PR-10 External Runner 协议路由：
 * - POST /runner-sessions           创建会话（绑定 Run）
 * - POST /runner-sessions/:id/close 关闭会话
 * - POST /runner-sessions/:id/heartbeat  会话心跳
 * - POST /runner-sessions/:id/claim       领取 RunItem
 * - POST /run-items/:id/heartbeat         RunItem 续租
 * - POST /run-items/:id/target-result    上传 Target 结果
 * - POST /run-items/:id/fail              上报失败
 *
 * 所有路由都需要 evaluation:run scope。
 */
export async function runnerRoutes(app: FastifyInstance): Promise<void> {
  app.post('/runner-sessions', {
    preHandler: authWithScopes('evaluation:run'),
  }, async (request, reply) => {
    if (!request.serviceToken) {
      reply.code(403).send({ error: 'Runner sessions require a service token' });
      return;
    }
    const body = (request.body ?? {}) as {
      runId: string;
      runnerId?: string;
      capabilities?: Record<string, unknown>;
      metadata?: Record<string, unknown>;
    };
    if (!body.runId) {
      reply.code(400).send({ error: 'runId is required' });
      return;
    }
    try {
      const session = await createRunnerSession(
        request.serviceToken.project_id,
        body.runId,
        request.serviceToken,
        {
          runnerId: body.runnerId || `cli-${process.pid}`,
          capabilities: body.capabilities,
          metadata: body.metadata,
        }
      );
      reply.code(201).send({ session });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const status = msg.includes('not found') ? 404 : msg.includes('already') || msg.includes('terminal') ? 409 : 400;
      reply.code(status).send({ error: msg });
    }
  });

  app.post('/runner-sessions/:id/close', {
    preHandler: authWithScopes('evaluation:run'),
  }, async (request, reply) => {
    if (!request.serviceToken) {
      reply.code(403).send({ error: 'Service token required' });
      return;
    }
    const params = request.params as { id: string };
    const session = await closeRunnerSession(params.id, request.serviceToken);
    if (!session) {
      reply.code(404).send({ error: 'Active session not found' });
      return;
    }
    reply.send({ session });
  });

  app.post('/runner-sessions/:id/heartbeat', {
    preHandler: authWithScopes('evaluation:run'),
  }, async (request, reply) => {
    if (!request.serviceToken) {
      reply.code(403).send({ error: 'Service token required' });
      return;
    }
    const params = request.params as { id: string };
    const session = await heartbeatRunnerSession(params.id, request.serviceToken);
    if (!session) {
      reply.code(404).send({ error: 'Active session not found' });
      return;
    }
    reply.send({ session });
  });

  app.post('/runner-sessions/:id/claim', {
    preHandler: authWithScopes('evaluation:run'),
  }, async (request, reply) => {
    if (!request.serviceToken) {
      reply.code(403).send({ error: 'Service token required' });
      return;
    }
    const params = request.params as { id: string };
    const body = (request.body ?? {}) as { leaseSeconds?: number };
    try {
      const claim = await runnerClaimItem(params.id, request.serviceToken, body.leaseSeconds);
      if (!claim) {
        reply.send({ claimed: false });
        return;
      }
      reply.send({
        claimed: true,
        runItem: {
          id: claim.runItem.id,
          runId: claim.run.id,
          caseKey: claim.sample.caseKey,
          input: claim.sample.input,
          expected: claim.sample.expected,
        },
        leaseToken: claim.leaseToken,
        leaseSeconds: body.leaseSeconds ?? 300,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      reply.code(msg.includes('not active') ? 409 : 400).send({ error: msg });
    }
  });

  app.post('/run-items/:id/heartbeat', {
    preHandler: authWithScopes('evaluation:run'),
  }, async (request, reply) => {
    if (!request.serviceToken) {
      reply.code(403).send({ error: 'Service token required' });
      return;
    }
    const params = request.params as { id: string };
    const body = (request.body ?? {}) as { leaseToken: string; leaseSeconds?: number };
    if (!body.leaseToken) {
      reply.code(400).send({ error: 'leaseToken is required' });
      return;
    }
    try {
      const item = await runnerHeartbeatItem(
        params.id,
        body.leaseToken,
        request.serviceToken,
        body.leaseSeconds
      );
      reply.send({ runItem: item });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      reply.code(msg.includes('not found') ? 404 : 409).send({ error: msg });
    }
  });

  app.post('/run-items/:id/target-result', {
    preHandler: authWithScopes('evaluation:result:write', 'evaluation:run'),
  }, async (request, reply) => {
    if (!request.serviceToken) {
      reply.code(403).send({ error: 'Service token required' });
      return;
    }
    const params = request.params as { id: string };
    const body = (request.body ?? {}) as {
      leaseToken: string;
      output: string;
      error?: string | null;
      traceId?: string | null;
      latencyMs?: number;
      tokenUsage?: Record<string, unknown> | null;
    };
    if (!body.leaseToken) {
      reply.code(400).send({ error: 'leaseToken is required' });
      return;
    }
    if (typeof body.output !== 'string' && !body.error) {
      reply.code(400).send({ error: 'output (string) or error is required' });
      return;
    }
    try {
      const item = await runnerSubmitResult(params.id, body.leaseToken, request.serviceToken, {
        output: body.output ?? '',
        error: body.error ?? null,
        traceId: body.traceId ?? null,
        latencyMs: body.latencyMs,
        tokenUsage: body.tokenUsage ?? null,
      });
      reply.send({ runItem: item });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      reply.code(msg.includes('not found') ? 404 : 409).send({ error: msg });
    }
  });

  app.post('/run-items/:id/fail', {
    preHandler: authWithScopes('evaluation:result:write', 'evaluation:run'),
  }, async (request, reply) => {
    if (!request.serviceToken) {
      reply.code(403).send({ error: 'Service token required' });
      return;
    }
    const params = request.params as { id: string };
    const body = (request.body ?? {}) as { leaseToken: string; error: string };
    if (!body.leaseToken || !body.error) {
      reply.code(400).send({ error: 'leaseToken and error are required' });
      return;
    }
    try {
      const item = await runnerFailItem(
        params.id,
        body.leaseToken,
        request.serviceToken,
        body.error
      );
      reply.send({ runItem: item });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      reply.code(msg.includes('not found') ? 404 : 409).send({ error: msg });
    }
  });

  /** 便捷：通过 Service Token 读取 Run 状态（供 CLI wait 使用） */
  app.get('/runs-for-runner/:id', {
    preHandler: authWithScopes('evaluation:read', 'evaluation:run'),
  }, async (request, reply) => {
    if (!request.serviceToken) {
      reply.code(403).send({ error: 'Service token required' });
      return;
    }
    const params = request.params as { id: string };
    const run = await getRunById(params.id);
    if (!run || run.project_id !== request.serviceToken.project_id) {
      reply.code(404).send({ error: 'Run not found' });
      return;
    }
    reply.send({ run });
  });
}
