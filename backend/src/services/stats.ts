import { query, queryOne } from '../db/index.js';
import { config } from '../config.js';

function toInt(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string') {
    const n = parseInt(value, 10);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

function toFloat(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export interface Stats {
  totalTraces: number;
  totalSessions: number;
  totalProjects: number;
  avgLatencyMs: number | null;
  errorRate: number;
  tracesByStatus: Record<string, number>;
  tracesByType: Record<string, number>;
  recentTraces: number;
  recentSessions: number;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  successRate: number;
  avgLatency: number;
  totalTokens: number;
}

export async function getProjectStats(projectId: string): Promise<Stats> {
  const isSqlite = config.dbType === 'sqlite';
  const [
    totalTraces,
    totalSessions,
    avgLatency,
    errorStats,
    statusStats,
    typeStats,
    recentTraces,
    recentSessions,
    totalTokens,
  ] = await Promise.all([
    queryOne<{ count: unknown }>('SELECT COUNT(*) as count FROM traces WHERE project_id = $1', [projectId]),
    queryOne<{ count: unknown }>('SELECT COUNT(*) as count FROM sessions WHERE project_id = $1', [projectId]),
    queryOne<{ avg: unknown }>(
      isSqlite
        ? 'SELECT AVG(latency_ms) as avg FROM traces WHERE project_id = $1 AND latency_ms IS NOT NULL'
        : 'SELECT AVG(latency_ms)::text as avg FROM traces WHERE project_id = $1 AND latency_ms IS NOT NULL',
      [projectId]
    ),
    queryOne<{ total: unknown; errors: unknown }>(
      isSqlite
        ? `SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as errors
           FROM traces WHERE project_id = $1`
        : `SELECT 
            COUNT(*)::text as total,
            COUNT(*) FILTER (WHERE status = 'error')::text as errors
           FROM traces WHERE project_id = $1`,
      [projectId]
    ),
    query<{ status: string; count: string }>(
      isSqlite
        ? `SELECT status, COUNT(*) as count 
           FROM traces WHERE project_id = $1 
           GROUP BY status`
        : `SELECT status, COUNT(*)::text as count 
           FROM traces WHERE project_id = $1 
           GROUP BY status`,
      [projectId]
    ),
    query<{ trace_type: string; count: string }>(
      isSqlite
        ? `SELECT trace_type, COUNT(*) as count 
           FROM traces WHERE project_id = $1 
           GROUP BY trace_type`
        : `SELECT trace_type, COUNT(*)::text as count 
           FROM traces WHERE project_id = $1 
           GROUP BY trace_type`,
      [projectId]
    ),
    queryOne<{ count: string }>(
      isSqlite
        ? `SELECT COUNT(*) as count FROM traces 
           WHERE project_id = $1 AND started_at > datetime('now', '-1 day')`
        : `SELECT COUNT(*) as count FROM traces 
           WHERE project_id = $1 AND started_at > NOW() - INTERVAL '24 hours'`,
      [projectId]
    ),
    queryOne<{ count: string }>(
      isSqlite
        ? `SELECT COUNT(*) as count FROM sessions 
           WHERE project_id = $1 AND started_at > datetime('now', '-1 day')`
        : `SELECT COUNT(*) as count FROM sessions 
           WHERE project_id = $1 AND started_at > NOW() - INTERVAL '24 hours'`,
      [projectId]
    ),
    queryOne<{ tokens: unknown }>(
      isSqlite
        ? `SELECT COALESCE(SUM(
            COALESCE(json_extract(metadata, '$.usage.prompt_tokens'), 0) +
            COALESCE(json_extract(metadata, '$.usage.completion_tokens'), 0) +
            COALESCE(json_extract(metadata, '$.usage.inputTokens'), 0) +
            COALESCE(json_extract(metadata, '$.usage.outputTokens'), 0) +
            COALESCE(json_extract(metadata, '$.prompt_tokens'), 0) +
            COALESCE(json_extract(metadata, '$.completion_tokens'), 0) +
            COALESCE(json_extract(metadata, '$.inputTokens'), 0) +
            COALESCE(json_extract(metadata, '$.outputTokens'), 0)
          ), 0) as tokens
           FROM traces
           WHERE project_id = $1 AND metadata IS NOT NULL`
        : `SELECT COALESCE(SUM(
            COALESCE((metadata->'usage'->>'prompt_tokens')::int, 0) +
            COALESCE((metadata->'usage'->>'completion_tokens')::int, 0) +
            COALESCE((metadata->'usage'->>'inputTokens')::int, 0) +
            COALESCE((metadata->'usage'->>'outputTokens')::int, 0) +
            COALESCE((metadata->>'prompt_tokens')::int, 0) +
            COALESCE((metadata->>'completion_tokens')::int, 0) +
            COALESCE((metadata->>'inputTokens')::int, 0) +
            COALESCE((metadata->>'outputTokens')::int, 0)
          ), 0)::text as tokens
           FROM traces
           WHERE project_id = $1 AND metadata IS NOT NULL`,
      [projectId]
    ),
  ]);
  
  const totalTraceCount = toInt(totalTraces?.count);
  const errorCount = toInt(errorStats?.errors);
  
  const tracesByStatus: Record<string, number> = {};
  for (const row of statusStats) {
    tracesByStatus[row.status] = parseInt(row.count, 10);
  }
  
  const tracesByType: Record<string, number> = {};
  for (const row of typeStats) {
    tracesByType[row.trace_type] = parseInt(row.count, 10);
  }

  const successfulRequests = tracesByStatus.success ?? Math.max(0, totalTraceCount - errorCount);
  const failedRequests = tracesByStatus.error ?? errorCount;
  const successRate = totalTraceCount > 0 ? Math.round((successfulRequests / totalTraceCount) * 10000) / 100 : 0;
  const avgLatencyMsValue = toFloat(avgLatency?.avg) ?? 0;
  const totalTokensValue = toInt((totalTokens as any)?.tokens);
  
  return {
    totalTraces: totalTraceCount,
    totalSessions: toInt(totalSessions?.count),
    totalProjects: 1,
    avgLatencyMs: toFloat(avgLatency?.avg),
    errorRate: totalTraceCount > 0 ? errorCount / totalTraceCount : 0,
    tracesByStatus,
    tracesByType,
    recentTraces: parseInt(recentTraces?.count || '0', 10),
    recentSessions: parseInt(recentSessions?.count || '0', 10),
    totalRequests: totalTraceCount,
    successfulRequests,
    failedRequests,
    successRate,
    avgLatency: avgLatencyMsValue,
    totalTokens: totalTokensValue,
  };
}

export async function getUserStats(userId: string): Promise<Stats & { totalApiKeys: number }> {
  const isSqlite = config.dbType === 'sqlite';
  const [
    projectCount,
    totalTraces,
    totalSessions,
    totalApiKeys,
    avgLatency,
    errorStats,
    statusStats,
    typeStats,
    recentTraces,
    recentSessions,
    totalTokens,
  ] = await Promise.all([
    queryOne<{ count: string }>(
      'SELECT COUNT(*) as count FROM projects WHERE user_id = $1',
      [userId]
    ),
    queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM traces t
       JOIN projects p ON t.project_id = p.id
       WHERE p.user_id = $1`,
      [userId]
    ),
    queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM sessions s
       JOIN projects p ON s.project_id = p.id
       WHERE p.user_id = $1`,
      [userId]
    ),
    queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM api_keys ak
       JOIN projects p ON ak.project_id = p.id
       WHERE p.user_id = $1 AND ak.revoked_at IS NULL`,
      [userId]
    ),
    queryOne<{ avg: string | null }>(
      isSqlite
        ? `SELECT AVG(t.latency_ms) as avg FROM traces t
           JOIN projects p ON t.project_id = p.id
           WHERE p.user_id = $1 AND t.latency_ms IS NOT NULL`
        : `SELECT AVG(t.latency_ms)::text as avg FROM traces t
           JOIN projects p ON t.project_id = p.id
           WHERE p.user_id = $1 AND t.latency_ms IS NOT NULL`,
      [userId]
    ),
    queryOne<{ total: string; errors: string }>(
      isSqlite
        ? `SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN t.status = 'error' THEN 1 ELSE 0 END) as errors
           FROM traces t
           JOIN projects p ON t.project_id = p.id
           WHERE p.user_id = $1`
        : `SELECT 
            COUNT(*)::text as total,
            COUNT(*) FILTER (WHERE t.status = 'error')::text as errors
           FROM traces t
           JOIN projects p ON t.project_id = p.id
           WHERE p.user_id = $1`,
      [userId]
    ),
    query<{ status: string; count: string }>(
      isSqlite
        ? `SELECT t.status as status, COUNT(*) as count 
           FROM traces t
           JOIN projects p ON t.project_id = p.id
           WHERE p.user_id = $1 
           GROUP BY t.status`
        : `SELECT t.status, COUNT(*)::text as count 
           FROM traces t
           JOIN projects p ON t.project_id = p.id
           WHERE p.user_id = $1 
           GROUP BY t.status`,
      [userId]
    ),
    query<{ trace_type: string; count: string }>(
      isSqlite
        ? `SELECT t.trace_type as trace_type, COUNT(*) as count 
           FROM traces t
           JOIN projects p ON t.project_id = p.id
           WHERE p.user_id = $1 
           GROUP BY t.trace_type`
        : `SELECT t.trace_type, COUNT(*)::text as count 
           FROM traces t
           JOIN projects p ON t.project_id = p.id
           WHERE p.user_id = $1 
           GROUP BY t.trace_type`,
      [userId]
    ),
    queryOne<{ count: string }>(
      isSqlite
        ? `SELECT COUNT(*) as count FROM traces t
           JOIN projects p ON t.project_id = p.id
           WHERE p.user_id = $1 AND t.started_at > datetime('now', '-1 day')`
        : `SELECT COUNT(*) as count FROM traces t
           JOIN projects p ON t.project_id = p.id
           WHERE p.user_id = $1 AND t.started_at > NOW() - INTERVAL '24 hours'`,
      [userId]
    ),
    queryOne<{ count: string }>(
      isSqlite
        ? `SELECT COUNT(*) as count FROM sessions s
           JOIN projects p ON s.project_id = p.id
           WHERE p.user_id = $1 AND s.started_at > datetime('now', '-1 day')`
        : `SELECT COUNT(*) as count FROM sessions s
           JOIN projects p ON s.project_id = p.id
           WHERE p.user_id = $1 AND s.started_at > NOW() - INTERVAL '24 hours'`,
      [userId]
    ),
    queryOne<{ tokens: unknown }>(
      isSqlite
        ? `SELECT COALESCE(SUM(
            COALESCE(json_extract(t.metadata, '$.usage.prompt_tokens'), 0) +
            COALESCE(json_extract(t.metadata, '$.usage.completion_tokens'), 0) +
            COALESCE(json_extract(t.metadata, '$.usage.inputTokens'), 0) +
            COALESCE(json_extract(t.metadata, '$.usage.outputTokens'), 0) +
            COALESCE(json_extract(t.metadata, '$.prompt_tokens'), 0) +
            COALESCE(json_extract(t.metadata, '$.completion_tokens'), 0) +
            COALESCE(json_extract(t.metadata, '$.inputTokens'), 0) +
            COALESCE(json_extract(t.metadata, '$.outputTokens'), 0)
          ), 0) as tokens
           FROM traces t
           JOIN projects p ON t.project_id = p.id
           WHERE p.user_id = $1 AND t.metadata IS NOT NULL`
        : `SELECT COALESCE(SUM(
            COALESCE((t.metadata->'usage'->>'prompt_tokens')::int, 0) +
            COALESCE((t.metadata->'usage'->>'completion_tokens')::int, 0) +
            COALESCE((t.metadata->'usage'->>'inputTokens')::int, 0) +
            COALESCE((t.metadata->'usage'->>'outputTokens')::int, 0) +
            COALESCE((t.metadata->>'prompt_tokens')::int, 0) +
            COALESCE((t.metadata->>'completion_tokens')::int, 0) +
            COALESCE((t.metadata->>'inputTokens')::int, 0) +
            COALESCE((t.metadata->>'outputTokens')::int, 0)
          ), 0)::text as tokens
           FROM traces t
           JOIN projects p ON t.project_id = p.id
           WHERE p.user_id = $1 AND t.metadata IS NOT NULL`,
      [userId]
    ),
  ]);
  
  const totalTraceCount = toInt((totalTraces as any)?.count);
  const errorCount = toInt((errorStats as any)?.errors);
  
  const tracesByStatus: Record<string, number> = {};
  for (const row of statusStats) {
    tracesByStatus[row.status] = parseInt(row.count, 10);
  }
  
  const tracesByType: Record<string, number> = {};
  for (const row of typeStats) {
    tracesByType[row.trace_type] = parseInt(row.count, 10);
  }

  const successfulRequests = tracesByStatus.success ?? Math.max(0, totalTraceCount - errorCount);
  const failedRequests = tracesByStatus.error ?? errorCount;
  const successRate = totalTraceCount > 0 ? Math.round((successfulRequests / totalTraceCount) * 10000) / 100 : 0;
  const avgLatencyMsValue = toFloat((avgLatency as any)?.avg) ?? 0;
  const totalTokensValue = toInt((totalTokens as any)?.tokens);
  
  return {
    totalTraces: totalTraceCount,
    totalSessions: toInt((totalSessions as any)?.count),
    totalProjects: toInt((projectCount as any)?.count),
    totalApiKeys: toInt((totalApiKeys as any)?.count),
    avgLatencyMs: toFloat((avgLatency as any)?.avg),
    errorRate: totalTraceCount > 0 ? errorCount / totalTraceCount : 0,
    tracesByStatus,
    tracesByType,
    recentTraces: parseInt(recentTraces?.count || '0', 10),
    recentSessions: parseInt(recentSessions?.count || '0', 10),
    totalRequests: totalTraceCount,
    successfulRequests,
    failedRequests,
    successRate,
    avgLatency: avgLatencyMsValue,
    totalTokens: totalTokensValue,
  };
}
