import { SQL_TRUE, query } from '../db/index.js';
import { getDeployment, type PromptDeployment } from './prompt-deployment.js';
import { getPromptById, getVersionById } from './prompts.js';
import { listAbVariants } from './prompt-ab-test.js';

/**
 * A/B 变体汇总指标。
 */
export interface PromptAbAnalyticsVariantSummary {
  variantKey: string | null;
  label: string;
  promptVersionId: string;
  versionNumber: number | null;
  configuredWeight: number | null;
  sampleCount: number;
  trafficShare: number | null;
  successRate: number | null;
  avgLatencyMs: number | null;
  avgEvalScore: number | null;
  evalPassRate: number | null;
}

/**
 * A/B 每日趋势点。
 */
export interface PromptAbAnalyticsTimelinePoint {
  day: string;
  variantKey: string | null;
  sampleCount: number;
  successRate: number | null;
  avgLatencyMs: number | null;
  avgEvalScore: number | null;
  evalPassRate: number | null;
}

/**
 * A/B 分析总览。
 */
export interface PromptAbAnalyticsReport {
  promptId: string;
  promptName: string;
  environment: string;
  days: number;
  generatedAt: string;
  baselinePromptVersionId: string;
  totalSamples: number;
  variants: PromptAbAnalyticsVariantSummary[];
  timeline: PromptAbAnalyticsTimelinePoint[];
}

interface AggregateRow {
  prompt_version_id: string;
  sample_count: unknown;
  success_count: unknown;
  avg_latency_ms: unknown;
  avg_eval_score: unknown;
  eval_passed_count: unknown;
  eval_count: unknown;
}

interface TimelineRow extends AggregateRow {
  day: string;
}

/**
 * 将数据库数值安全转换为 number。
 * @param value - 数据库返回值
 * @returns number 或 0
 */
function toNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

/**
 * 将数据库平均值安全转换为 number|null。
 * @param value - 数据库返回值
 * @returns 平均值
 */
function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = toNumber(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * 计算百分比。
 * @param numerator - 分子
 * @param denominator - 分母
 * @returns 百分比
 */
function percent(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Number(((numerator / denominator) * 100).toFixed(2));
}

/**
 * 读取 Prompt A/B 效果分析。
 * 数据来源为 traces 表中的真实调用记录，通过 prompt_version_id 归因到基线或变体。
 * @param projectId - 项目 ID
 * @param promptId - Prompt ID
 * @param environment - 环境
 * @param days - 最近 N 天窗口
 * @returns 分析报告
 */
export async function getPromptAbAnalytics(
  projectId: string,
  promptId: string,
  environment: string,
  days = 14
): Promise<PromptAbAnalyticsReport> {
  const prompt = await getPromptById(promptId);
  if (!prompt || prompt.project_id !== projectId) {
    throw new Error('Prompt not found');
  }

  const deployment = await getDeployment(projectId, promptId, environment);
  if (!deployment) {
    throw new Error(`Prompt "${prompt.name}" is not deployed to ${environment}`);
  }

  const variants = await listAbVariants(projectId, promptId, environment);
  const safeDays = Math.max(1, Math.min(days, 90));
  const since = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000).toISOString();

  const versionIds = Array.from(new Set([deployment.prompt_version_id, ...variants.map((item) => item.prompt_version_id)]));
  const placeholders = versionIds.map((_, index) => `$${index + 4}`).join(', ');

  const aggregateRows = await query<AggregateRow>(
    `SELECT prompt_version_id,
            COUNT(*) AS sample_count,
            SUM(CASE WHEN status <> 'error' THEN 1 ELSE 0 END) AS success_count,
            AVG(latency_ms) AS avg_latency_ms,
            AVG(latest_eval_score) AS avg_eval_score,
            SUM(CASE WHEN latest_eval_passed = ${SQL_TRUE} THEN 1 ELSE 0 END) AS eval_passed_count,
            SUM(CASE WHEN latest_eval_passed IS NOT NULL THEN 1 ELSE 0 END) AS eval_count
       FROM traces
      WHERE project_id = $1
        AND prompt_id = $2
        AND started_at >= $3
        AND prompt_version_id IN (${placeholders})
      GROUP BY prompt_version_id`,
    [projectId, promptId, since, ...versionIds]
  );

  const timelineRows = await query<TimelineRow>(
    `SELECT DATE(started_at) AS day,
            prompt_version_id,
            COUNT(*) AS sample_count,
            SUM(CASE WHEN status <> 'error' THEN 1 ELSE 0 END) AS success_count,
            AVG(latency_ms) AS avg_latency_ms,
            AVG(latest_eval_score) AS avg_eval_score,
            SUM(CASE WHEN latest_eval_passed = ${SQL_TRUE} THEN 1 ELSE 0 END) AS eval_passed_count,
            SUM(CASE WHEN latest_eval_passed IS NOT NULL THEN 1 ELSE 0 END) AS eval_count
       FROM traces
      WHERE project_id = $1
        AND prompt_id = $2
        AND started_at >= $3
        AND prompt_version_id IN (${placeholders})
      GROUP BY DATE(started_at), prompt_version_id
      ORDER BY day DESC, prompt_version_id ASC`,
    [projectId, promptId, since, ...versionIds]
  );

  const variantByVersionId = new Map<string, { variantKey: string | null; configuredWeight: number | null; label: string }>();
  variantByVersionId.set(deployment.prompt_version_id, {
    variantKey: null,
    configuredWeight: null,
    label: 'baseline',
  });
  for (const item of variants) {
    variantByVersionId.set(item.prompt_version_id, {
      variantKey: item.variant_key,
      configuredWeight: item.enabled ? item.weight : 0,
      label: item.variant_key,
    });
  }

  const totalSamples = aggregateRows.reduce((sum, row) => sum + toNumber(row.sample_count), 0);
  const versionNumberCache = new Map<string, number | null>();
  for (const versionId of versionIds) {
    const version = await getVersionById(versionId);
    versionNumberCache.set(versionId, version?.version_number ?? null);
  }

  const summaries = versionIds.map((versionId) => {
    const row = aggregateRows.find((item) => item.prompt_version_id === versionId);
    const sampleCount = row ? toNumber(row.sample_count) : 0;
    const successCount = row ? toNumber(row.success_count) : 0;
    const evalCount = row ? toNumber(row.eval_count) : 0;
    const evalPassedCount = row ? toNumber(row.eval_passed_count) : 0;
    const mapping = variantByVersionId.get(versionId) ?? {
      variantKey: null,
      configuredWeight: null,
      label: 'unknown',
    };

    return {
      variantKey: mapping.variantKey,
      label: mapping.label,
      promptVersionId: versionId,
      versionNumber: versionNumberCache.get(versionId) ?? null,
      configuredWeight: mapping.configuredWeight,
      sampleCount,
      trafficShare: percent(sampleCount, totalSamples),
      successRate: percent(successCount, sampleCount),
      avgLatencyMs: row ? toNullableNumber(row.avg_latency_ms) : null,
      avgEvalScore: row ? toNullableNumber(row.avg_eval_score) : null,
      evalPassRate: percent(evalPassedCount, evalCount),
    } satisfies PromptAbAnalyticsVariantSummary;
  });

  const timeline = timelineRows.map((row) => {
    const sampleCount = toNumber(row.sample_count);
    const successCount = toNumber(row.success_count);
    const evalCount = toNumber(row.eval_count);
    const evalPassedCount = toNumber(row.eval_passed_count);
    const mapping = variantByVersionId.get(row.prompt_version_id) ?? {
      variantKey: null,
    };
    return {
      day: row.day,
      variantKey: mapping.variantKey,
      sampleCount,
      successRate: percent(successCount, sampleCount),
      avgLatencyMs: toNullableNumber(row.avg_latency_ms),
      avgEvalScore: toNullableNumber(row.avg_eval_score),
      evalPassRate: percent(evalPassedCount, evalCount),
    } satisfies PromptAbAnalyticsTimelinePoint;
  });

  return {
    promptId,
    promptName: prompt.name,
    environment,
    days: safeDays,
    generatedAt: new Date().toISOString(),
    baselinePromptVersionId: deployment.prompt_version_id,
    totalSamples,
    variants: summaries,
    timeline,
  };
}
