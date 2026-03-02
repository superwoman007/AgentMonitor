import { query, queryOne } from '../db/index.js';

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
}

export async function getProjectStats(projectId: string): Promise<Stats> {
  const [
    totalTraces,
    totalSessions,
    avgLatency,
    errorStats,
    statusStats,
    typeStats,
    recentTraces,
    recentSessions,
  ] = await Promise.all([
    queryOne<{ count: string }>(
      'SELECT COUNT(*) as count FROM traces WHERE project_id = $1',
      [projectId]
    ),
    queryOne<{ count: string }>(
      'SELECT COUNT(*) as count FROM sessions WHERE project_id = $1',
      [projectId]
    ),
    queryOne<{ avg: string | null }>(
      'SELECT AVG(latency_ms)::text as avg FROM traces WHERE project_id = $1 AND latency_ms IS NOT NULL',
      [projectId]
    ),
    queryOne<{ total: string; errors: string }>(
      `SELECT 
        COUNT(*)::text as total,
        COUNT(*) FILTER (WHERE status = 'error')::text as errors
       FROM traces WHERE project_id = $1`,
      [projectId]
    ),
    query<{ status: string; count: string }>(
      `SELECT status, COUNT(*)::text as count 
       FROM traces WHERE project_id = $1 
       GROUP BY status`,
      [projectId]
    ),
    query<{ trace_type: string; count: string }>(
      `SELECT trace_type, COUNT(*)::text as count 
       FROM traces WHERE project_id = $1 
       GROUP BY trace_type`,
      [projectId]
    ),
    queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM traces 
       WHERE project_id = $1 AND started_at > NOW() - INTERVAL '24 hours'`,
      [projectId]
    ),
    queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM sessions 
       WHERE project_id = $1 AND started_at > NOW() - INTERVAL '24 hours'`,
      [projectId]
    ),
  ]);
  
  const totalTraceCount = parseInt(totalTraces?.count || '0', 10);
  const errorCount = parseInt(errorStats?.errors || '0', 10);
  
  const tracesByStatus: Record<string, number> = {};
  for (const row of statusStats) {
    tracesByStatus[row.status] = parseInt(row.count, 10);
  }
  
  const tracesByType: Record<string, number> = {};
  for (const row of typeStats) {
    tracesByType[row.trace_type] = parseInt(row.count, 10);
  }
  
  return {
    totalTraces: totalTraceCount,
    totalSessions: parseInt(totalSessions?.count || '0', 10),
    totalProjects: 1,
    avgLatencyMs: avgLatency?.avg ? parseFloat(avgLatency.avg) : null,
    errorRate: totalTraceCount > 0 ? errorCount / totalTraceCount : 0,
    tracesByStatus,
    tracesByType,
    recentTraces: parseInt(recentTraces?.count || '0', 10),
    recentSessions: parseInt(recentSessions?.count || '0', 10),
  };
}

export async function getUserStats(userId: string): Promise<Stats & { totalApiKeys: number }> {
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
      `SELECT AVG(t.latency_ms)::text as avg FROM traces t
       JOIN projects p ON t.project_id = p.id
       WHERE p.user_id = $1 AND t.latency_ms IS NOT NULL`,
      [userId]
    ),
    queryOne<{ total: string; errors: string }>(
      `SELECT 
        COUNT(*)::text as total,
        COUNT(*) FILTER (WHERE t.status = 'error')::text as errors
       FROM traces t
       JOIN projects p ON t.project_id = p.id
       WHERE p.user_id = $1`,
      [userId]
    ),
    query<{ status: string; count: string }>(
      `SELECT t.status, COUNT(*)::text as count 
       FROM traces t
       JOIN projects p ON t.project_id = p.id
       WHERE p.user_id = $1 
       GROUP BY t.status`,
      [userId]
    ),
    query<{ trace_type: string; count: string }>(
      `SELECT t.trace_type, COUNT(*)::text as count 
       FROM traces t
       JOIN projects p ON t.project_id = p.id
       WHERE p.user_id = $1 
       GROUP BY t.trace_type`,
      [userId]
    ),
    queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM traces t
       JOIN projects p ON t.project_id = p.id
       WHERE p.user_id = $1 AND t.started_at > NOW() - INTERVAL '24 hours'`,
      [userId]
    ),
    queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM sessions s
       JOIN projects p ON s.project_id = p.id
       WHERE p.user_id = $1 AND s.started_at > NOW() - INTERVAL '24 hours'`,
      [userId]
    ),
  ]);
  
  const totalTraceCount = parseInt(totalTraces?.count || '0', 10);
  const errorCount = parseInt(errorStats?.errors || '0', 10);
  
  const tracesByStatus: Record<string, number> = {};
  for (const row of statusStats) {
    tracesByStatus[row.status] = parseInt(row.count, 10);
  }
  
  const tracesByType: Record<string, number> = {};
  for (const row of typeStats) {
    tracesByType[row.trace_type] = parseInt(row.count, 10);
  }
  
  return {
    totalTraces: totalTraceCount,
    totalSessions: parseInt(totalSessions?.count || '0', 10),
    totalProjects: parseInt(projectCount?.count || '0', 10),
    totalApiKeys: parseInt(totalApiKeys?.count || '0', 10),
    avgLatencyMs: avgLatency?.avg ? parseFloat(avgLatency.avg) : null,
    errorRate: totalTraceCount > 0 ? errorCount / totalTraceCount : 0,
    tracesByStatus,
    tracesByType,
    recentTraces: parseInt(recentTraces?.count || '0', 10),
    recentSessions: parseInt(recentSessions?.count || '0', 10),
  };
}
