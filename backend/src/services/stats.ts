import { query, queryOne } from '../db/index.js';
import { config } from '../config.js';

export function toInt(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string') {
    const n = parseInt(value, 10);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

// 统计结果短 TTL 缓存。Dashboard 默认每 15s 轮询，而统计为全表聚合，
// 高频重复计算会给数据库带来不必要压力；缓存 10s 可在实时性与开销间取得平衡。
const STATS_CACHE_TTL_MS = 10_000;
interface StatsCacheEntry<T> {
  expiresAt: number;
  promise: Promise<T>;
}
const statsCache = new Map<string, StatsCacheEntry<unknown>>();

/**
 * 以短 TTL 缓存异步统计结果，相同 key 在有效期内复用同一个 Promise（同时去重并发请求）。
 * @param key - 缓存键（建议含项目 ID 与函数名）
 * @param producer - 缓存未命中时的计算函数
 * @returns 统计结果
 */
async function withStatsCache<T>(key: string, producer: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = statsCache.get(key);
  if (hit && hit.expiresAt > now) {
    return hit.promise as Promise<T>;
  }
  const entry: StatsCacheEntry<T> = {
    expiresAt: now + STATS_CACHE_TTL_MS,
    promise: producer(),
  };
  statsCache.set(key, entry as StatsCacheEntry<unknown>);
  // 失败时清除缓存，避免把 rejected Promise 缓存到过期。
  entry.promise.catch(() => {
    if (statsCache.get(key) === (entry as StatsCacheEntry<unknown>)) {
      statsCache.delete(key);
    }
  });
  return entry.promise;
}


export function toFloat(value: unknown): number | null {
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
  return withStatsCache(`projectStats:${projectId}`, () => computeProjectStats(projectId));
}

async function computeProjectStats(projectId: string): Promise<Stats> {
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
            CASE
              WHEN json_extract(metadata, '$.usage.total_tokens') IS NOT NULL THEN CAST(json_extract(metadata, '$.usage.total_tokens') AS INTEGER)
              WHEN json_extract(metadata, '$.total_tokens') IS NOT NULL THEN CAST(json_extract(metadata, '$.total_tokens') AS INTEGER)
              WHEN json_extract(metadata, '$.tokens') IS NOT NULL THEN CAST(json_extract(metadata, '$.tokens') AS INTEGER)
              ELSE (
                COALESCE(CAST(json_extract(metadata, '$.usage.prompt_tokens') AS INTEGER), 0) +
                COALESCE(CAST(json_extract(metadata, '$.usage.completion_tokens') AS INTEGER), 0) +
                COALESCE(CAST(json_extract(metadata, '$.usage.input_tokens') AS INTEGER), 0) +
                COALESCE(CAST(json_extract(metadata, '$.usage.output_tokens') AS INTEGER), 0) +
                COALESCE(CAST(json_extract(metadata, '$.usage.inputTokens') AS INTEGER), 0) +
                COALESCE(CAST(json_extract(metadata, '$.usage.outputTokens') AS INTEGER), 0) +
                COALESCE(CAST(json_extract(metadata, '$.prompt_tokens') AS INTEGER), 0) +
                COALESCE(CAST(json_extract(metadata, '$.completion_tokens') AS INTEGER), 0) +
                COALESCE(CAST(json_extract(metadata, '$.input_tokens') AS INTEGER), 0) +
                COALESCE(CAST(json_extract(metadata, '$.output_tokens') AS INTEGER), 0) +
                COALESCE(CAST(json_extract(metadata, '$.inputTokens') AS INTEGER), 0) +
                COALESCE(CAST(json_extract(metadata, '$.outputTokens') AS INTEGER), 0)
              )
            END
          ), 0) as tokens
           FROM traces
           WHERE project_id = $1 AND metadata IS NOT NULL`
        : `SELECT COALESCE(SUM(
            CASE
              WHEN (metadata->'usage'->>'total_tokens') ~ '^[0-9]+$' THEN (metadata->'usage'->>'total_tokens')::int
              WHEN (metadata->>'total_tokens') ~ '^[0-9]+$' THEN (metadata->>'total_tokens')::int
              WHEN (metadata->>'tokens') ~ '^[0-9]+$' THEN (metadata->>'tokens')::int
              ELSE (
                COALESCE((metadata->'usage'->>'prompt_tokens')::int, 0) +
                COALESCE((metadata->'usage'->>'completion_tokens')::int, 0) +
                COALESCE((metadata->'usage'->>'input_tokens')::int, 0) +
                COALESCE((metadata->'usage'->>'output_tokens')::int, 0) +
                COALESCE((metadata->'usage'->>'inputTokens')::int, 0) +
                COALESCE((metadata->'usage'->>'outputTokens')::int, 0) +
                COALESCE((metadata->>'prompt_tokens')::int, 0) +
                COALESCE((metadata->>'completion_tokens')::int, 0) +
                COALESCE((metadata->>'input_tokens')::int, 0) +
                COALESCE((metadata->>'output_tokens')::int, 0) +
                COALESCE((metadata->>'inputTokens')::int, 0) +
                COALESCE((metadata->>'outputTokens')::int, 0)
              )
            END
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

export interface ObservationStats {
  totalTraces: number;
  totalSessions: number;
  totalToolCalls: number;
  traceTypeBreakdown: Array<{ type: string; count: number }>;
  avgLatency: number;
  successRate: number;
  topTools: Array<{ name: string; count: number }>;
}

export async function getObservationStats(projectId: string): Promise<ObservationStats> {
  return withStatsCache(`observationStats:${projectId}`, () => computeObservationStats(projectId));
}

async function computeObservationStats(projectId: string): Promise<ObservationStats> {
  const isSqlite = config.dbType === 'sqlite';
  
  const [
    totalTraces,
    totalSessions,
    totalToolCalls,
    avgLatency,
    errorStats,
    typeStats,
    toolStats,
  ] = await Promise.all([
    queryOne<{ count: unknown }>('SELECT COUNT(*) as count FROM traces WHERE project_id = $1', [projectId]),
    queryOne<{ count: unknown }>('SELECT COUNT(*) as count FROM sessions WHERE project_id = $1', [projectId]),
    queryOne<{ count: unknown }>('SELECT COUNT(*) as count FROM tool_calls tc JOIN sessions s ON tc.session_id = s.id WHERE s.project_id = $1', [projectId]),
    queryOne<{ avg: unknown }>(
      isSqlite
        ? 'SELECT AVG(latency_ms) as avg FROM traces WHERE project_id = $1 AND latency_ms IS NOT NULL'
        : 'SELECT AVG(latency_ms)::text as avg FROM traces WHERE project_id = $1 AND latency_ms IS NOT NULL',
      [projectId]
    ),
    queryOne<{ total: unknown; errors: unknown }>(
      isSqlite
        ? `SELECT COUNT(*) as total, SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as errors FROM traces WHERE project_id = $1`
        : `SELECT COUNT(*)::text as total, COUNT(*) FILTER (WHERE status = 'error')::text as errors FROM traces WHERE project_id = $1`,
      [projectId]
    ),
    query<{ trace_type: string; count: string }>(
      isSqlite
        ? `SELECT trace_type, COUNT(*) as count FROM traces WHERE project_id = $1 GROUP BY trace_type`
        : `SELECT trace_type, COUNT(*)::text as count FROM traces WHERE project_id = $1 GROUP BY trace_type`,
      [projectId]
    ),
    query<{ tool_name: string; count: string }>(
      isSqlite
        ? `SELECT tc.tool_name, COUNT(*) as count FROM tool_calls tc JOIN sessions s ON tc.session_id = s.id WHERE s.project_id = $1 GROUP BY tc.tool_name ORDER BY count DESC LIMIT 5`
        : `SELECT tc.tool_name, COUNT(*)::text as count FROM tool_calls tc JOIN sessions s ON tc.session_id = s.id WHERE s.project_id = $1 GROUP BY tc.tool_name ORDER BY count DESC LIMIT 5`,
      [projectId]
    ),
  ]);
  
  const totalTraceCount = toInt(totalTraces?.count);
  const errorCount = toInt(errorStats?.errors);
  const successRate = totalTraceCount > 0 ? Math.round(((totalTraceCount - errorCount) / totalTraceCount) * 10000) / 100 : 0;
  const avgLatencyMs = toFloat(avgLatency?.avg) ?? 0;
  
  return {
    totalTraces: totalTraceCount,
    totalSessions: toInt(totalSessions?.count),
    totalToolCalls: toInt(totalToolCalls?.count),
    traceTypeBreakdown: typeStats.map(row => ({ type: row.trace_type, count: parseInt(row.count, 10) })),
    avgLatency: avgLatencyMs,
    successRate,
    topTools: toolStats.map(row => ({ name: row.tool_name, count: parseInt(row.count, 10) })),
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
            CASE
              WHEN json_extract(t.metadata, '$.usage.total_tokens') IS NOT NULL THEN CAST(json_extract(t.metadata, '$.usage.total_tokens') AS INTEGER)
              WHEN json_extract(t.metadata, '$.total_tokens') IS NOT NULL THEN CAST(json_extract(t.metadata, '$.total_tokens') AS INTEGER)
              WHEN json_extract(t.metadata, '$.tokens') IS NOT NULL THEN CAST(json_extract(t.metadata, '$.tokens') AS INTEGER)
              ELSE (
                COALESCE(CAST(json_extract(t.metadata, '$.usage.prompt_tokens') AS INTEGER), 0) +
                COALESCE(CAST(json_extract(t.metadata, '$.usage.completion_tokens') AS INTEGER), 0) +
                COALESCE(CAST(json_extract(t.metadata, '$.usage.input_tokens') AS INTEGER), 0) +
                COALESCE(CAST(json_extract(t.metadata, '$.usage.output_tokens') AS INTEGER), 0) +
                COALESCE(CAST(json_extract(t.metadata, '$.usage.inputTokens') AS INTEGER), 0) +
                COALESCE(CAST(json_extract(t.metadata, '$.usage.outputTokens') AS INTEGER), 0) +
                COALESCE(CAST(json_extract(t.metadata, '$.prompt_tokens') AS INTEGER), 0) +
                COALESCE(CAST(json_extract(t.metadata, '$.completion_tokens') AS INTEGER), 0) +
                COALESCE(CAST(json_extract(t.metadata, '$.input_tokens') AS INTEGER), 0) +
                COALESCE(CAST(json_extract(t.metadata, '$.output_tokens') AS INTEGER), 0) +
                COALESCE(CAST(json_extract(t.metadata, '$.inputTokens') AS INTEGER), 0) +
                COALESCE(CAST(json_extract(t.metadata, '$.outputTokens') AS INTEGER), 0)
              )
            END
          ), 0) as tokens
           FROM traces t
           JOIN projects p ON t.project_id = p.id
           WHERE p.user_id = $1 AND t.metadata IS NOT NULL`
        : `SELECT COALESCE(SUM(
            CASE
              WHEN (t.metadata->'usage'->>'total_tokens') ~ '^[0-9]+$' THEN (t.metadata->'usage'->>'total_tokens')::int
              WHEN (t.metadata->>'total_tokens') ~ '^[0-9]+$' THEN (t.metadata->>'total_tokens')::int
              WHEN (t.metadata->>'tokens') ~ '^[0-9]+$' THEN (t.metadata->>'tokens')::int
              ELSE (
                COALESCE((t.metadata->'usage'->>'prompt_tokens')::int, 0) +
                COALESCE((t.metadata->'usage'->>'completion_tokens')::int, 0) +
                COALESCE((t.metadata->'usage'->>'input_tokens')::int, 0) +
                COALESCE((t.metadata->'usage'->>'output_tokens')::int, 0) +
                COALESCE((t.metadata->'usage'->>'inputTokens')::int, 0) +
                COALESCE((t.metadata->'usage'->>'outputTokens')::int, 0) +
                COALESCE((t.metadata->>'prompt_tokens')::int, 0) +
                COALESCE((t.metadata->>'completion_tokens')::int, 0) +
                COALESCE((t.metadata->>'input_tokens')::int, 0) +
                COALESCE((t.metadata->>'output_tokens')::int, 0) +
                COALESCE((t.metadata->>'inputTokens')::int, 0) +
                COALESCE((t.metadata->>'outputTokens')::int, 0)
              )
            END
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

export interface TrendPoint {
  date: string;
  traceCount: number;
  tokenCount: number;
  successRate: number;
  errorCount: number;
  avgLatency: number;
}

export async function getTrendStats(projectId: string, days = 7): Promise<TrendPoint[]> {
  const isSqlite = config.dbType === 'sqlite';

  // Build date series for the last N days
  const today = new Date();
  const dates: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }

  const sql = isSqlite
    ? `SELECT
        date(started_at) as date,
        COUNT(*) as trace_count,
        SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as error_count,
        AVG(CASE WHEN latency_ms IS NOT NULL THEN latency_ms END) as avg_latency
      FROM traces
      WHERE project_id = $1 AND started_at >= date('now', '-${days} days')
      GROUP BY date(started_at)
      ORDER BY date(started_at) ASC`
    : `SELECT
        date(started_at) as date,
        COUNT(*)::int as trace_count,
        COUNT(*) FILTER (WHERE status = 'error')::int as error_count,
        COALESCE(AVG(latency_ms)::numeric, 0)::float as avg_latency
      FROM traces
      WHERE project_id = $1 AND started_at >= NOW() - INTERVAL '${days} days'
      GROUP BY date(started_at)
      ORDER BY date(started_at) ASC`;

  const rows = await query<{ date: string; trace_count: string | number; error_count: string | number; avg_latency: string | number | null }>(sql, [projectId]);

  // Token count per day
  const tokenSql = isSqlite
    ? `SELECT date(started_at) as date,
        COALESCE(SUM(
          CASE
            WHEN json_extract(metadata, '$.usage.total_tokens') IS NOT NULL THEN CAST(json_extract(metadata, '$.usage.total_tokens') AS INTEGER)
            WHEN json_extract(metadata, '$.total_tokens') IS NOT NULL THEN CAST(json_extract(metadata, '$.total_tokens') AS INTEGER)
            WHEN json_extract(metadata, '$.tokens') IS NOT NULL THEN CAST(json_extract(metadata, '$.tokens') AS INTEGER)
            ELSE (
              COALESCE(CAST(json_extract(metadata, '$.usage.prompt_tokens') AS INTEGER), 0) +
              COALESCE(CAST(json_extract(metadata, '$.usage.completion_tokens') AS INTEGER), 0) +
              COALESCE(CAST(json_extract(metadata, '$.usage.input_tokens') AS INTEGER), 0) +
              COALESCE(CAST(json_extract(metadata, '$.usage.output_tokens') AS INTEGER), 0) +
              COALESCE(CAST(json_extract(metadata, '$.prompt_tokens') AS INTEGER), 0) +
              COALESCE(CAST(json_extract(metadata, '$.completion_tokens') AS INTEGER), 0) +
              COALESCE(CAST(json_extract(metadata, '$.input_tokens') AS INTEGER), 0) +
              COALESCE(CAST(json_extract(metadata, '$.output_tokens') AS INTEGER), 0)
            )
          END
        ), 0) as token_count
      FROM traces
      WHERE project_id = $1 AND started_at >= date('now', '-${days} days') AND metadata IS NOT NULL
      GROUP BY date(started_at)`
    : `SELECT date(started_at) as date,
        COALESCE(SUM(
          CASE
            WHEN (metadata->'usage'->>'total_tokens') ~ '^[0-9]+$' THEN (metadata->'usage'->>'total_tokens')::int
            WHEN (metadata->>'total_tokens') ~ '^[0-9]+$' THEN (metadata->>'total_tokens')::int
            WHEN (metadata->>'tokens') ~ '^[0-9]+$' THEN (metadata->>'tokens')::int
            ELSE (
              COALESCE((metadata->'usage'->>'prompt_tokens')::int, 0) +
              COALESCE((metadata->'usage'->>'completion_tokens')::int, 0) +
              COALESCE((metadata->'usage'->>'input_tokens')::int, 0) +
              COALESCE((metadata->'usage'->>'output_tokens')::int, 0) +
              COALESCE((metadata->>'prompt_tokens')::int, 0) +
              COALESCE((metadata->>'completion_tokens')::int, 0) +
              COALESCE((metadata->>'input_tokens')::int, 0) +
              COALESCE((metadata->>'output_tokens')::int, 0)
            )
          END
        ), 0)::int as token_count
      FROM traces
      WHERE project_id = $1 AND started_at >= NOW() - INTERVAL '${days} days' AND metadata IS NOT NULL
      GROUP BY date(started_at)`;

  const tokenRows = await query<{ date: string; token_count: string | number }>(tokenSql, [projectId]);

  const tokenMap = new Map<string, number>();
  for (const row of tokenRows) {
    tokenMap.set(row.date, toInt(row.token_count));
  }

  const rowMap = new Map<string, { trace_count: number; error_count: number; avg_latency: number }>();
  for (const row of rows) {
    rowMap.set(row.date, {
      trace_count: toInt(row.trace_count),
      error_count: toInt(row.error_count),
      avg_latency: toFloat(row.avg_latency) ?? 0,
    });
  }

  return dates.map(date => {
    const r = rowMap.get(date);
    const traceCount = r?.trace_count ?? 0;
    const errorCount = r?.error_count ?? 0;
    return {
      date,
      traceCount,
      tokenCount: tokenMap.get(date) ?? 0,
      successRate: traceCount > 0 ? Math.round(((traceCount - errorCount) / traceCount) * 10000) / 100 : 0,
      errorCount,
      avgLatency: r?.avg_latency ?? 0,
    };
  });
}
