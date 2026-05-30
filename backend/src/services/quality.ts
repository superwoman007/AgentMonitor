import { query } from '../db/index.js';
import { Trace } from './trace.js';
import { config } from '../config.js';

export interface QualityScore {
  score: number;
  speedScore: number;
  successScore: number;
  totalTraces: number;
}

export interface QualityTrendPoint {
  date: string;
  score: number;
  speedScore: number;
  successScore: number;
  count: number;
}

export function calculateQualityScore(trace: Trace): number {
  const speedScore = calculateSpeedScore(trace.latency_ms);
  const successScore = trace.status === 'success' ? 100 : 0;
  return Math.round(speedScore * 0.6 + successScore * 0.4);
}

export function calculateSpeedScore(latencyMs: number | null): number {
  if (latencyMs === null) return 50;
  if (latencyMs < 500) return 100;
  if (latencyMs < 2000) return 80;
  if (latencyMs < 5000) return 50;
  return 20;
}

export function calculateSuccessScore(status: string): number {
  return status === 'success' ? 100 : 0;
}

export async function getQualityScore(projectId: string): Promise<QualityScore> {
  const isSqlite = config.dbType === 'sqlite';

  // Use SQL aggregation instead of loading all traces into memory
  const result = await query<{
    total_count: number;
    success_count: number;
    avg_latency: number | null;
    fast_count: number;    // < 500ms
    medium_count: number;  // 500-2000ms
    slow_count: number;    // 2000-5000ms
    very_slow_count: number; // > 5000ms
  }>(
    isSqlite
      ? `SELECT
          COUNT(*) as total_count,
          SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success_count,
          AVG(latency_ms) as avg_latency,
          SUM(CASE WHEN latency_ms < 500 THEN 1 ELSE 0 END) as fast_count,
          SUM(CASE WHEN latency_ms >= 500 AND latency_ms < 2000 THEN 1 ELSE 0 END) as medium_count,
          SUM(CASE WHEN latency_ms >= 2000 AND latency_ms < 5000 THEN 1 ELSE 0 END) as slow_count,
          SUM(CASE WHEN latency_ms >= 5000 THEN 1 ELSE 0 END) as very_slow_count
         FROM traces
         WHERE project_id = $1 AND status != 'pending'
         ORDER BY started_at DESC
         LIMIT 1000`
      : `SELECT
          COUNT(*) as total_count,
          COUNT(*) FILTER (WHERE status = 'success') as success_count,
          AVG(latency_ms) as avg_latency,
          COUNT(*) FILTER (WHERE latency_ms < 500) as fast_count,
          COUNT(*) FILTER (WHERE latency_ms >= 500 AND latency_ms < 2000) as medium_count,
          COUNT(*) FILTER (WHERE latency_ms >= 2000 AND latency_ms < 5000) as slow_count,
          COUNT(*) FILTER (WHERE latency_ms >= 5000) as very_slow_count
         FROM (
           SELECT latency_ms, status FROM traces
           WHERE project_id = $1 AND status != 'pending'
           ORDER BY started_at DESC
           LIMIT 1000
         ) sub`,
    [projectId]
  );

  const row = result[0];
  if (!row || row.total_count === 0) {
    return { score: 0, speedScore: 0, successScore: 0, totalTraces: 0 };
  }

  const total = row.total_count;
  const nullLatencyCount = total - (row.fast_count + row.medium_count + row.slow_count + row.very_slow_count);

  // Weighted speed score based on latency distribution
  const avgSpeedScore = (
    (row.fast_count * 100) +
    (row.medium_count * 80) +
    (row.slow_count * 50) +
    (row.very_slow_count * 20) +
    (nullLatencyCount * 50)
  ) / total;

  const avgSuccessScore = (row.success_count / total) * 100;
  const finalScore = Math.round(avgSpeedScore * 0.6 + avgSuccessScore * 0.4);

  return {
    score: finalScore,
    speedScore: Math.round(avgSpeedScore),
    successScore: Math.round(avgSuccessScore),
    totalTraces: total,
  };
}

export async function getQualityTrend(
  projectId: string,
  days: number = 7
): Promise<QualityTrendPoint[]> {
  const isSqlite = config.dbType === 'sqlite';
  const result = await query<{
    date: string;
    avg_latency: number | null;
    success_count: unknown;
    total_count: unknown;
  }>(
    isSqlite
      ? `SELECT 
          date(datetime(started_at)) as date,
          AVG(latency_ms) as avg_latency,
          SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success_count,
          COUNT(*) as total_count
         FROM traces
         WHERE project_id = $1
         AND datetime(started_at) > datetime('now', '-' || $2 || ' days')
         AND status != 'pending'
         GROUP BY date(datetime(started_at))
         ORDER BY date DESC`
      : `SELECT 
          DATE(started_at) as date,
          AVG(latency_ms) as avg_latency,
          COUNT(*) FILTER (WHERE status = 'success')::text as success_count,
          COUNT(*)::text as total_count
         FROM traces 
         WHERE project_id = $1 
         AND started_at > NOW() - INTERVAL '1 day' * $2
         AND status != 'pending'
         GROUP BY DATE(started_at)
         ORDER BY date DESC`,
    [projectId, days]
  );

  return result.map((row) => {
    const avgLatency = row.avg_latency || 0;
    const speedScore = calculateSpeedScore(avgLatency);
    const successCount = typeof row.success_count === 'number' ? row.success_count : parseInt(String(row.success_count), 10);
    const totalCount = typeof row.total_count === 'number' ? row.total_count : parseInt(String(row.total_count), 10);
    const successRate = successCount / Math.max(totalCount, 1);
    const successScore = Math.round(successRate * 100);
    const score = Math.round(speedScore * 0.6 + successScore * 0.4);

    return {
      date: row.date,
      score,
      speedScore,
      successScore,
      count: totalCount,
    };
  });
}
