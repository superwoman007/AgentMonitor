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
  const traces = await query<Trace>(
    `SELECT * FROM traces 
     WHERE project_id = $1 
     AND status != 'pending'
     ORDER BY started_at DESC
     LIMIT 1000`,
    [projectId]
  );

  if (traces.length === 0) {
    return {
      score: 0,
      speedScore: 0,
      successScore: 0,
      totalTraces: 0,
    };
  }

  let totalSpeedScore = 0;
  let totalSuccessScore = 0;

  for (const trace of traces) {
    totalSpeedScore += calculateSpeedScore(trace.latency_ms);
    totalSuccessScore += calculateSuccessScore(trace.status);
  }

  const avgSpeedScore = totalSpeedScore / traces.length;
  const avgSuccessScore = totalSuccessScore / traces.length;
  const finalScore = Math.round(avgSpeedScore * 0.6 + avgSuccessScore * 0.4);

  return {
    score: finalScore,
    speedScore: Math.round(avgSpeedScore),
    successScore: Math.round(avgSuccessScore),
    totalTraces: traces.length,
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
