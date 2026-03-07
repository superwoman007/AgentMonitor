import { FastifyInstance } from 'fastify';
import { 
  createAlert, 
  getAlertsByProject, 
  getAlertById, 
  updateAlert, 
  deleteAlert,
  getAlertHistory,
  getAlertHistoryById,
  ignoreAlertHistory,
  checkAlerts,
} from '../services/alert.js';
import { authMiddleware } from '../middleware/auth.js';
import { getProjectById } from '../services/project.js';
import { getProjectStats } from '../services/stats.js';
import { getCostByProject } from '../services/cost.js';
import { queryOne } from '../db/index.js';
import { config } from '../config.js';

export async function alertsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const query = request.query as { projectId: string };
    
    const project = await getProjectById(query.projectId);
    if (!project || project.user_id !== request.userId) {
      reply.code(404).send({ error: 'Project not found' });
      return;
    }

    const alerts = getAlertsByProject(query.projectId);
    const history = getAlertHistory(query.projectId, 50);
    reply.send({ alerts, history });
  });

  app.post('/', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const body = request.body as {
      projectId: string;
      name: string;
      type: 'latency' | 'error_rate' | 'cost' | 'custom';
      condition: string;
      threshold: number;
      enabled?: boolean;
    };
    
    const project = await getProjectById(body.projectId);
    if (!project || project.user_id !== request.userId) {
      reply.code(404).send({ error: 'Project not found' });
      return;
    }

    const alert = createAlert(body);
    reply.code(201).send({ alert });
  });

  app.put('/:id', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const params = request.params as { id: string };
    const body = request.body as Partial<{
      name: string;
      type: 'latency' | 'error_rate' | 'cost' | 'custom';
      condition: string;
      threshold: number;
      enabled: boolean;
    }>;

    const alert = getAlertById(params.id);
    if (!alert) {
      reply.code(404).send({ error: 'Alert not found' });
      return;
    }

    const project = await getProjectById(alert.projectId);
    if (!project || project.user_id !== request.userId) {
      reply.code(404).send({ error: 'Alert not found' });
      return;
    }

    const updated = updateAlert(params.id, body);
    reply.send({ alert: updated });
  });

  app.post('/history/:id/ignore', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const params = request.params as { id: string };
    const body = request.body as { minutes?: number };

    const history = getAlertHistoryById(params.id);
    if (!history) {
      reply.code(404).send({ error: 'Alert history not found' });
      return;
    }

    const project = await getProjectById(history.projectId);
    if (!project || project.user_id !== request.userId) {
      reply.code(404).send({ error: 'Alert history not found' });
      return;
    }

    const minutes = body.minutes;
    if (minutes === undefined || minutes === null || Number.isFinite(minutes) === false || minutes <= 0) {
      reply.code(400).send({ error: 'minutes must be a positive number' });
      return;
    }

    const result = ignoreAlertHistory(params.id, minutes);
    if (!result) {
      reply.code(400).send({ error: 'Failed to ignore alert history' });
      return;
    }

    reply.send({ mutedUntil: result.mutedUntil.toISOString() });
  });

  app.delete('/:id', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const params = request.params as { id: string };

    const alert = getAlertById(params.id);
    if (!alert) {
      reply.code(404).send({ error: 'Alert not found' });
      return;
    }

    const project = await getProjectById(alert.projectId);
    if (!project || project.user_id !== request.userId) {
      reply.code(404).send({ error: 'Alert not found' });
      return;
    }

    deleteAlert(params.id);
    reply.code(204).send();
  });

  app.post('/check', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const body = request.body as { projectId: string };
    
    const project = await getProjectById(body.projectId);
    if (!project || project.user_id !== request.userId) {
      reply.code(404).send({ error: 'Project not found' });
      return;
    }

    const [stats, costSummary] = await Promise.all([
      getProjectStats(body.projectId),
      getCostByProject(body.projectId, 1),
    ]);

    const isSqlite = config.dbType === 'sqlite';
    const sinceSql = isSqlite
      ? `datetime(started_at) > datetime('now', '-1 day')`
      : `started_at > NOW() - INTERVAL '24 hours'`;

    const latencyEvidence = await queryOne<{
      id: string;
      session_id: string | null;
      trace_type: string;
      name: string;
      started_at: string;
      latency_ms: number | null;
      status: string;
      error: string | null;
    }>(
      `SELECT id, session_id, trace_type, name, started_at, latency_ms, status, error
       FROM traces
       WHERE project_id = $1 AND latency_ms IS NOT NULL AND ${sinceSql}
       ORDER BY latency_ms DESC, started_at DESC
       LIMIT 1`,
      [body.projectId]
    );

    const errorEvidence = await queryOne<{
      id: string;
      session_id: string | null;
      trace_type: string;
      name: string;
      started_at: string;
      latency_ms: number | null;
      status: string;
      error: string | null;
    }>(
      `SELECT id, session_id, trace_type, name, started_at, latency_ms, status, error
       FROM traces
       WHERE project_id = $1 AND status = 'error' AND ${sinceSql}
       ORDER BY started_at DESC
       LIMIT 1`,
      [body.projectId]
    );

    const tokenCostExprSqlite = `
      (COALESCE(json_extract(metadata, '$.usage.prompt_tokens'), 0) +
       COALESCE(json_extract(metadata, '$.usage.input_tokens'), 0) +
       COALESCE(json_extract(metadata, '$.inputTokens'), 0) +
       COALESCE(json_extract(metadata, '$.input_tokens'), 0)) * 0.001 / 1000 +
      (COALESCE(json_extract(metadata, '$.usage.completion_tokens'), 0) +
       COALESCE(json_extract(metadata, '$.usage.output_tokens'), 0) +
       COALESCE(json_extract(metadata, '$.outputTokens'), 0) +
       COALESCE(json_extract(metadata, '$.output_tokens'), 0)) * 0.002 / 1000
    `;

    const tokenCostExprPostgres = `
      (COALESCE((metadata->'usage'->>'prompt_tokens')::int, 0) +
       COALESCE((metadata->'usage'->>'input_tokens')::int, 0) +
       COALESCE((metadata->>'inputTokens')::int, 0) +
       COALESCE((metadata->>'input_tokens')::int, 0)) * 0.001 / 1000 +
      (COALESCE((metadata->'usage'->>'completion_tokens')::int, 0) +
       COALESCE((metadata->'usage'->>'output_tokens')::int, 0) +
       COALESCE((metadata->>'outputTokens')::int, 0) +
       COALESCE((metadata->>'output_tokens')::int, 0)) * 0.002 / 1000
    `;

    const costExpr = isSqlite ? tokenCostExprSqlite : tokenCostExprPostgres;
    const costEvidence = await queryOne<{
      id: string;
      session_id: string | null;
      trace_type: string;
      name: string;
      started_at: string;
      latency_ms: number | null;
      status: string;
      error: string | null;
      cost: unknown;
    }>(
      `SELECT id, session_id, trace_type, name, started_at, latency_ms, status, error, (${costExpr}) as cost
       FROM traces
       WHERE project_id = $1 AND metadata IS NOT NULL AND ${sinceSql}
       ORDER BY cost DESC, started_at DESC
       LIMIT 1`,
      [body.projectId]
    );

    const triggered = checkAlerts(body.projectId, {
      avgLatency: stats.avgLatencyMs || undefined,
      errorRate: stats.errorRate,
      dailyCost: costSummary.today,
    }, {
      latency: latencyEvidence
        ? {
            id: latencyEvidence.id,
            sessionId: latencyEvidence.session_id,
            traceType: latencyEvidence.trace_type,
            name: latencyEvidence.name,
            startedAt: latencyEvidence.started_at,
            latencyMs: latencyEvidence.latency_ms,
            status: latencyEvidence.status,
            error: latencyEvidence.error,
          }
        : undefined,
      error_rate: errorEvidence
        ? {
            id: errorEvidence.id,
            sessionId: errorEvidence.session_id,
            traceType: errorEvidence.trace_type,
            name: errorEvidence.name,
            startedAt: errorEvidence.started_at,
            latencyMs: errorEvidence.latency_ms,
            status: errorEvidence.status,
            error: errorEvidence.error,
          }
        : undefined,
      cost: costEvidence
        ? {
            id: costEvidence.id,
            sessionId: costEvidence.session_id,
            traceType: costEvidence.trace_type,
            name: costEvidence.name,
            startedAt: costEvidence.started_at,
            latencyMs: costEvidence.latency_ms,
            status: costEvidence.status,
            error: costEvidence.error,
            cost: costEvidence.cost === null || costEvidence.cost === undefined ? null : Number(costEvidence.cost),
          }
        : undefined,
    });

    reply.send({ triggered });
  });
}
