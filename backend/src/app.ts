import Fastify, { FastifyError } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import { randomUUID } from 'crypto';
import { config } from './config.js';
import { authRoutes } from './routes/auth.js';
import { tracesRoutes } from './routes/traces.js';
import { sessionsRoutes } from './routes/sessions.js';
import { projectsRoutes } from './routes/projects.js';
import { apikeysRoutes } from './routes/apikeys.js';
import { statsRoutes } from './routes/stats.js';
import { wsRoutes } from './routes/ws.js';
import { breakpointsRoutes } from './routes/breakpoints.js';
import { snapshotsRoutes } from './routes/snapshots.js';
import { qualityRoutes } from './routes/quality.js';
import { costRoutes } from './routes/cost.js';
import { alertsRoutes } from './routes/alerts.js';
import decisionsRoutes from './routes/decisions.js';
import { evaluationRoutes } from './routes/evaluation.js';
import { promptsRoutes } from './routes/prompts.js';
import { playgroundRoutes } from './routes/playground.js';
import { modelConfigRoutes } from './routes/modelConfigs.js';
import { toolCallsRoutes } from './routes/toolCalls.js';
import { feedbackRoutes } from './routes/feedback.js';
import { spansRoutes } from './routes/spans.js';
import { telemetryV2Routes } from './routes/telemetry-v2.js';
import { integrationStatusRoutes } from './routes/integration-status.js';
import { agentTargetRoutes } from './routes/agent-targets.js';
import { evaluatorSuiteRoutes } from './routes/evaluator-suites.js';
import { datasetVersionItemRoutes } from './routes/dataset-version-items.js';
import { evaluationRunRoutes } from './routes/evaluation-runs.js';
import { serviceTokenRoutes } from './routes/service-tokens.js';
import { runnerRoutes } from './routes/runner.js';
import { promptDeploymentRoutes } from './routes/prompt-deployments.js';
import { scheduledRunRoutes } from './routes/scheduled-runs.js';
import { traceSamplingRuleRoutes } from './routes/trace-sampling-rules.js';
import { alertRuleRoutes } from './routes/alert-rules.js';
import { traceAnnotationRoutes } from './routes/trace-annotations.js';
import { startEvaluationWorker } from './services/evaluation-worker.js';

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: config.isProduction ? 'info' : 'debug',
    },
    genReqId: () => randomUUID(),
    trustProxy: config.isProduction,
  });

  // Request ID propagation
  app.addHook('onRequest', async (request, reply) => {
    reply.header('X-Request-Id', request.id);
  });

  // Security headers for all API responses
  app.addHook('onSend', async (_request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('X-XSS-Protection', '0');
    reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    reply.header('Cache-Control', 'no-store');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  });

  // CORS - restricted in production
  await app.register(cors, {
    origin: config.cors.origins,
    credentials: true,
  });

  // Rate limiting
  // 限流：生产环境或显式启用 RATE_LIMIT_ENABLED=true 时开启。
  // 测试/开发环境默认关闭，避免本地集成测试触发 429；rate-limit.test.ts 通过环境变量显式启用。
  const rateLimitEnabled = config.isProduction || process.env.RATE_LIMIT_ENABLED === 'true';
  if (rateLimitEnabled) {
    await app.register(rateLimit, {
      max: config.rateLimit.global.max,
      timeWindow: config.rateLimit.global.timeWindow,
    });
  }

  await app.register(websocket);

  app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  await app.register(authRoutes, { prefix: `${config.api.prefix}/auth` });
  await app.register(tracesRoutes, { prefix: `${config.api.prefix}/traces` });
  await app.register(sessionsRoutes, { prefix: `${config.api.prefix}/sessions` });
  await app.register(projectsRoutes, { prefix: `${config.api.prefix}/projects` });
  await app.register(apikeysRoutes, { prefix: `${config.api.prefix}/apikeys` });
  await app.register(statsRoutes, { prefix: `${config.api.prefix}/stats` });
  await app.register(breakpointsRoutes, { prefix: `${config.api.prefix}/breakpoints` });
  await app.register(snapshotsRoutes, { prefix: `${config.api.prefix}/snapshots` });
  await app.register(qualityRoutes, { prefix: `${config.api.prefix}/quality` });
  await app.register(costRoutes, { prefix: `${config.api.prefix}/cost` });
  await app.register(alertsRoutes, { prefix: `${config.api.prefix}/alerts` });
  await app.register(decisionsRoutes, { prefix: config.api.prefix });
  await app.register(evaluationRoutes, { prefix: `${config.api.prefix}/evaluation` });
  await app.register(promptsRoutes, { prefix: `${config.api.prefix}/prompts` });
  await app.register(playgroundRoutes, { prefix: `${config.api.prefix}/playground` });
  await app.register(modelConfigRoutes, { prefix: `${config.api.prefix}/model-configs` });
  await app.register(toolCallsRoutes, { prefix: `${config.api.prefix}/tool-calls` });
  await app.register(feedbackRoutes, { prefix: `${config.api.prefix}/feedbacks` });
  await app.register(spansRoutes, { prefix: `${config.api.prefix}/spans` });
  await app.register(telemetryV2Routes, { prefix: '/api/v2/telemetry' });
  await app.register(integrationStatusRoutes, { prefix: '/api/v2/projects' });
  await app.register(agentTargetRoutes, { prefix: '/api/v2/evaluation' });
  await app.register(evaluatorSuiteRoutes, { prefix: '/api/v2/evaluation' });
  await app.register(datasetVersionItemRoutes, { prefix: '/api/v2/evaluation' });
  await app.register(evaluationRunRoutes, { prefix: '/api/v2/evaluation' });
  await app.register(serviceTokenRoutes, { prefix: '/api/v2' });
  await app.register(runnerRoutes, { prefix: '/api/v2/evaluation' });
  await app.register(promptDeploymentRoutes, { prefix: '/api/v2' });
  await app.register(scheduledRunRoutes, { prefix: '/api/v2/evaluation' });
  await app.register(traceSamplingRuleRoutes, { prefix: '/api/v2/evaluation' });
  await app.register(alertRuleRoutes, { prefix: '/api/v2/evaluation' });
  await app.register(traceAnnotationRoutes, { prefix: '/api/v2' });
  await app.register(wsRoutes);

  // 启动持久化评测 Worker（claim/lease/heartbeat/recovery）。
  // 测试环境通过 EVAL_WORKER_ENABLED=true 显式开启，避免全局定时器干扰无关测试。
  if (config.nodeEnv !== 'test' || process.env.EVAL_WORKER_ENABLED === 'true') {
    await startEvaluationWorker();
  }

  app.setErrorHandler((error: FastifyError, request, reply) => {
    request.log.error({ err: error, requestId: request.id }, 'Unhandled error');

    if (error.validation) {
      reply.code(400).send({ error: 'Validation error', requestId: request.id });
      return;
    }

    const statusCode = error.statusCode || 500;

    // In production, don't expose internal error details
    if (config.isProduction && statusCode >= 500) {
      reply.code(statusCode).send({ error: 'Internal server error', requestId: request.id });
      return;
    }

    reply.code(statusCode).send({
      error: error.message || 'Internal server error',
      requestId: request.id,
    });
  });

  return app;
}
