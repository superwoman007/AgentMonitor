import { query, queryOne, fromDbJson } from '../db/index.js';
import { config } from '../config.js';

export interface ModelPricing {
  input: number;
  output: number;
}

// 内置默认价格表（单位：美元 / 1K tokens）。
// 价格可通过环境变量 MODEL_PRICING_JSON 覆盖或扩展，格式为 { "模型名": { "input": 0.01, "output": 0.03 } }，
// 便于在不发版的情况下跟随厂商调价或补充私有模型单价。
export const MODEL_PRICING: Record<string, ModelPricing> = {
  'gpt-4': { input: 0.03, output: 0.06 },
  'gpt-4-turbo': { input: 0.01, output: 0.03 },
  'gpt-4o': { input: 0.0025, output: 0.01 },
  'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
  'gpt-4.1': { input: 0.002, output: 0.008 },
  'gpt-4.1-mini': { input: 0.0004, output: 0.0016 },
  'gpt-3.5-turbo': { input: 0.0015, output: 0.002 },
  'o1': { input: 0.015, output: 0.06 },
  'o1-mini': { input: 0.003, output: 0.012 },
  'o3-mini': { input: 0.0011, output: 0.0044 },
  'claude-3-opus': { input: 0.015, output: 0.075 },
  'claude-3-sonnet': { input: 0.003, output: 0.015 },
  'claude-3-haiku': { input: 0.00025, output: 0.00125 },
  'claude-3.5-sonnet': { input: 0.003, output: 0.015 },
  'claude-3-5-sonnet': { input: 0.003, output: 0.015 },
  'claude-sonnet-4': { input: 0.003, output: 0.015 },
  'claude-opus-4': { input: 0.015, output: 0.075 },
  'gemini-1.5-pro': { input: 0.00125, output: 0.005 },
  'gemini-1.5-flash': { input: 0.000075, output: 0.0003 },
  'gemini-2.0-flash': { input: 0.0001, output: 0.0004 },
  'deepseek-chat': { input: 0.00027, output: 0.0011 },
  'deepseek-reasoner': { input: 0.00055, output: 0.00219 },
  'qwen-max': { input: 0.0024, output: 0.0096 },
  'qwen-plus': { input: 0.0004, output: 0.0012 },
  'glm-4': { input: 0.014, output: 0.014 },
  'default': { input: 0.001, output: 0.002 },
};

// 运行时生效的价格表 = 内置表 + 环境变量覆盖（自定义优先生效）。
const RUNTIME_PRICING: Record<string, ModelPricing> = (() => {
  const merged: Record<string, ModelPricing> = { ...MODEL_PRICING };
  const raw = process.env.MODEL_PRICING_JSON;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, ModelPricing>;
      for (const [key, value] of Object.entries(parsed)) {
        if (
          value &&
          typeof value.input === 'number' &&
          Number.isFinite(value.input) &&
          typeof value.output === 'number' &&
          Number.isFinite(value.output)
        ) {
          merged[key.toLowerCase()] = { input: value.input, output: value.output };
        }
      }
    } catch {
      // 价格覆盖配置非法时静默回退到内置表，不影响主流程。
    }
  }
  return merged;
})();

export interface CostSummary {
  today: number;
  week: number;
  month: number;
  total: number;
}

export interface CostByModel {
  model: string;
  count: number;
  totalCost: number;
  inputCost: number;
  outputCost: number;
  inputTokens: number;
  outputTokens: number;
}

export interface ExpensiveCall {
  id: string;
  name: string;
  model: string;
  cost: number;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  startedAt: Date;
}

export interface CostSuggestion {
  type: 'downgrade' | 'cache' | 'batch' | 'optimize';
  // 机器可读的建议码，前端可据此做 i18n 翻译；message 保留作为兜底英文文案。
  code: string;
  message: string;
  potentialSaving: number;
  meta?: Record<string, unknown>;
}

/**
 * 根据模型名解析单价。优先精确匹配，其次按模型名包含关系做最长匹配，均未命中回落 default。
 * @param model - 模型名称（不区分大小写）
 * @returns 输入/输出单价（美元 / 1K tokens）
 */
export function getModelPricing(model: string): ModelPricing {
  const normalizedModel = (model || 'unknown').toLowerCase();
  const keys = Object.keys(RUNTIME_PRICING)
    .filter((k) => k !== 'default')
    .sort((a, b) => b.length - a.length);

  for (const key of keys) {
    const pricing = RUNTIME_PRICING[key];
    if (!pricing) continue;
    const lower = key.toLowerCase();
    if (normalizedModel.includes(lower) || lower.includes(normalizedModel)) {
      return pricing;
    }
  }
  return RUNTIME_PRICING['default'];
}

export function parseJsonIfString(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (trimmed.length === 0) return value;
  if (trimmed[0] !== '{' && trimmed[0] !== '[' && trimmed[0] !== '"') return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

export function extractModelFromMetadata(metadata: unknown): string {
  const parsed = parseJsonIfString(metadata);
  if (!parsed || typeof parsed !== 'object') return 'unknown';
  const meta = parsed as Record<string, unknown>;
  return (meta.model as string) || (meta.modelId as string) || 'unknown';
}

/**
 * 从 Trace metadata 中抽取输入/输出 Token 数，兼容多种字段命名。
 * @param metadata - Trace 的 metadata（对象或 JSON 字符串）
 * @returns 输入、输出 Token 数
 */
export function extractTokensFromMetadata(metadata: unknown): { input: number; output: number } {
  const parsed = parseJsonIfString(metadata);
  if (!parsed || typeof parsed !== 'object') return { input: 0, output: 0 };
  const meta = parsed as Record<string, unknown>;

  const usage = meta.usage as Record<string, unknown> | undefined;
  if (usage) {
    return {
      input:
        (usage.prompt_tokens as number) ||
        (usage.inputTokens as number) ||
        (usage.input_tokens as number) ||
        0,
      output:
        (usage.completion_tokens as number) ||
        (usage.outputTokens as number) ||
        (usage.output_tokens as number) ||
        0,
    };
  }

  return {
    input: (meta.prompt_tokens as number) || (meta.inputTokens as number) || (meta.input_tokens as number) || 0,
    output: (meta.completion_tokens as number) || (meta.outputTokens as number) || (meta.output_tokens as number) || 0,
  };
}

/**
 * 计算单条 Trace 的成本（美元），按模型真实单价计价。
 * @param model - 模型名
 * @param inputTokens - 输入 Token
 * @param outputTokens - 输出 Token
 * @returns 成本（美元）
 */
export function calculateCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = getModelPricing(model);
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1000;
}

// 各数据库下「按模型聚合 Token」的取值表达式。
// 统一抽取输入/输出 Token（兼容多种字段命名），供 GROUP BY 聚合后在 JS 层按模型单价计费。
function tokenAggExprSqlite(): { model: string; input: string; output: string } {
  return {
    model: `COALESCE(json_extract(metadata, '$.model'), json_extract(metadata, '$.modelId'), 'unknown')`,
    input: `COALESCE(json_extract(metadata, '$.usage.prompt_tokens'), 0)
            + COALESCE(json_extract(metadata, '$.usage.input_tokens'), 0)
            + COALESCE(json_extract(metadata, '$.inputTokens'), 0)
            + COALESCE(json_extract(metadata, '$.input_tokens'), 0)`,
    output: `COALESCE(json_extract(metadata, '$.usage.completion_tokens'), 0)
            + COALESCE(json_extract(metadata, '$.usage.output_tokens'), 0)
            + COALESCE(json_extract(metadata, '$.outputTokens'), 0)
            + COALESCE(json_extract(metadata, '$.output_tokens'), 0)`,
  };
}

function tokenAggExprPostgres(): { model: string; input: string; output: string } {
  return {
    model: `COALESCE(metadata->>'model', metadata->>'modelId', 'unknown')`,
    input: `COALESCE((metadata->'usage'->>'prompt_tokens')::int, 0)
            + COALESCE((metadata->'usage'->>'input_tokens')::int, 0)
            + COALESCE((metadata->>'inputTokens')::int, 0)
            + COALESCE((metadata->>'input_tokens')::int, 0)`,
    output: `COALESCE((metadata->'usage'->>'completion_tokens')::int, 0)
            + COALESCE((metadata->'usage'->>'output_tokens')::int, 0)
            + COALESCE((metadata->>'outputTokens')::int, 0)
            + COALESCE((metadata->>'output_tokens')::int, 0)`,
  };
}

interface ModelTokenRow {
  model: string | null;
  input_tokens: unknown;
  output_tokens: unknown;
}

function toInt(v: unknown): number {
  return v === null || v === undefined ? 0 : parseInt(String(v), 10) || 0;
}

/**
 * 按可选时间窗口聚合各模型的 Token 用量，并在 JS 层用真实单价计算成本。
 * @param projectId - 项目 ID
 * @param sinceExpr - 时间过滤条件片段（含 $2 起始时间参数时配合 sinceParams）
 * @param params - 绑定参数（项目 ID 在前）
 * @returns 各模型成本明细与总成本
 */
async function aggregateCostByModel(
  projectId: string,
  whereClause: string,
  params: unknown[]
): Promise<{ byModel: CostByModel[]; total: number }> {
  const isSqlite = config.dbType === 'sqlite';
  const expr = isSqlite ? tokenAggExprSqlite() : tokenAggExprPostgres();

  const rows = await query<ModelTokenRow>(
    isSqlite
      ? `SELECT ${expr.model} as model,
                SUM(${expr.input}) as input_tokens,
                SUM(${expr.output}) as output_tokens
         FROM traces
         WHERE project_id = $1 AND metadata IS NOT NULL ${whereClause}
         GROUP BY ${expr.model}`
      : `SELECT ${expr.model} as model,
                SUM(${expr.input})::text as input_tokens,
                SUM(${expr.output})::text as output_tokens
         FROM traces
         WHERE project_id = $1 AND metadata IS NOT NULL ${whereClause}
         GROUP BY ${expr.model}`,
    [projectId, ...params]
  );

  const byModel: CostByModel[] = rows.map((r) => {
    const model = (r.model || 'unknown').toString();
    const inputTokens = toInt(r.input_tokens);
    const outputTokens = toInt(r.output_tokens);
    const pricing = getModelPricing(model);
    const inputCost = (inputTokens * pricing.input) / 1000;
    const outputCost = (outputTokens * pricing.output) / 1000;
    return {
      model,
      count: 0,
      totalCost: inputCost + outputCost,
      inputCost,
      outputCost,
      inputTokens,
      outputTokens,
    };
  });

  const total = byModel.reduce((sum, m) => sum + m.totalCost, 0);
  return { byModel, total };
}

/**
 * 获取项目在今日 / 本周 / 本月 / 总计四个时间窗口的成本汇总。
 * 成本统一按模型真实单价在 JS 层计算，避免 SQL 写死单价导致口径不一致。
 * @param projectId - 项目 ID
 * @param _days - 兼容旧签名（趋势窗口由调用方另查），未使用
 * @returns 四档时间窗口成本
 */
export async function getCostByProject(projectId: string, _days: number = 7): Promise<CostSummary> {
  const isSqlite = config.dbType === 'sqlite';

  const windows = isSqlite
    ? [
        `AND datetime(started_at) > datetime('now', '-1 day')`,
        `AND datetime(started_at) > datetime('now', '-7 days')`,
        `AND datetime(started_at) > datetime('now', '-30 days')`,
        ``,
      ]
    : [
        `AND started_at > NOW() - INTERVAL '1 day'`,
        `AND started_at > NOW() - INTERVAL '7 days'`,
        `AND started_at > NOW() - INTERVAL '30 days'`,
        ``,
      ];

  const [today, week, month, total] = await Promise.all(
    windows.map((where) => aggregateCostByModel(projectId, where, []).then((r) => r.total))
  );

  return { today, week, month, total };
}

export async function getCostByModel(projectId: string): Promise<CostByModel[]> {
  const isSqlite = config.dbType === 'sqlite';
  const expr = isSqlite ? tokenAggExprSqlite() : tokenAggExprPostgres();

  const rows = await query<ModelTokenRow & { count: unknown }>(
    isSqlite
      ? `SELECT ${expr.model} as model,
                COUNT(*) as count,
                SUM(${expr.input}) as input_tokens,
                SUM(${expr.output}) as output_tokens
         FROM traces
         WHERE project_id = $1 AND metadata IS NOT NULL
         GROUP BY ${expr.model}`
      : `SELECT ${expr.model} as model,
                COUNT(*)::text as count,
                SUM(${expr.input})::text as input_tokens,
                SUM(${expr.output})::text as output_tokens
         FROM traces
         WHERE project_id = $1 AND metadata IS NOT NULL
         GROUP BY ${expr.model}`,
    [projectId]
  );

  const byModel: CostByModel[] = rows.map((r) => {
    const model = (r.model || 'unknown').toString();
    const count = toInt(r.count);
    const inputTokens = toInt(r.input_tokens);
    const outputTokens = toInt(r.output_tokens);
    const pricing = getModelPricing(model);
    const inputCost = (inputTokens * pricing.input) / 1000;
    const outputCost = (outputTokens * pricing.output) / 1000;
    return {
      model,
      count,
      totalCost: inputCost + outputCost,
      inputCost,
      outputCost,
      inputTokens,
      outputTokens,
    };
  });

  return byModel.sort((a, b) => b.totalCost - a.totalCost);
}

export async function getMostExpensive(
  projectId: string,
  limit: number = 10
): Promise<ExpensiveCall[]> {
  const traces = await query<{
    id: string;
    name: string;
    metadata: unknown;
    latency_ms: number;
    started_at: Date;
  }>(
    `SELECT id, name, metadata, latency_ms, started_at
     FROM traces
     WHERE project_id = $1
     AND metadata IS NOT NULL
     ORDER BY started_at DESC
     LIMIT 1000`,
    [projectId]
  );

  const calls: ExpensiveCall[] = traces.map((trace) => {
    const model = extractModelFromMetadata(fromDbJson(trace.metadata));
    const tokens = extractTokensFromMetadata(fromDbJson(trace.metadata));
    const cost = calculateCost(model, tokens.input, tokens.output);

    return {
      id: trace.id,
      name: trace.name,
      model,
      cost,
      inputTokens: tokens.input,
      outputTokens: tokens.output,
      latencyMs: trace.latency_ms || 0,
      startedAt: trace.started_at,
    };
  });

  return calls.sort((a, b) => b.cost - a.cost).slice(0, limit);
}

export async function getCostOptimizationSuggestions(projectId: string): Promise<CostSuggestion[]> {
  const suggestions: CostSuggestion[] = [];
  const modelCosts = await getCostByModel(projectId);

  for (const mc of modelCosts) {
    const lower = mc.model.toLowerCase();
    // 高价旗舰模型 → 建议降级到同代更经济型号（建议码供前端 i18n）。
    if (lower.includes('gpt-4') && !lower.includes('turbo') && !lower.includes('mini') && !lower.includes('gpt-4o')) {
      const potentialSaving = mc.totalCost * 0.6;
      suggestions.push({
        type: 'downgrade',
        code: 'downgrade_gpt4',
        message: `Consider using GPT-4o or GPT-4-Turbo instead of ${mc.model} for potentially 60% cost savings`,
        potentialSaving,
        meta: { model: mc.model, spent: Number(mc.totalCost.toFixed(2)) },
      });
    }

    if (lower.includes('opus')) {
      const potentialSaving = mc.totalCost * 0.7;
      suggestions.push({
        type: 'downgrade',
        code: 'downgrade_opus',
        message: `Consider using Claude Sonnet instead of Opus for potentially 70% cost savings`,
        potentialSaving,
        meta: { model: mc.model, spent: Number(mc.totalCost.toFixed(2)) },
      });
    }
  }

  const recent = await queryOne<{ count: unknown }>(
    config.dbType === 'sqlite'
      ? `SELECT COUNT(*) as count
         FROM traces
         WHERE project_id = $1
         AND datetime(started_at) > datetime('now', '-1 day')`
      : `SELECT COUNT(*)::text as count
         FROM traces
         WHERE project_id = $1
         AND started_at > NOW() - INTERVAL '1 day'`,
    [projectId]
  );

  const recentCount = toInt(recent?.count);

  if (recentCount > 100) {
    suggestions.push({
      type: 'cache',
      code: 'enable_caching',
      message: 'High API call volume detected. Consider implementing response caching for repeated queries',
      potentialSaving: recentCount * 0.001,
      meta: { recentCount },
    });
  }

  suggestions.push({
    type: 'optimize',
    code: 'shorten_prompts',
    message: 'Use shorter system prompts and concise instructions to reduce input token costs',
    potentialSaving: 0,
  });

  return suggestions;
}

export async function getCostTrend(
  projectId: string,
  days: number = 7
): Promise<{ date: string; cost: number; count: number }[]> {
  const isSqlite = config.dbType === 'sqlite';
  const expr = isSqlite ? tokenAggExprSqlite() : tokenAggExprPostgres();

  // 按天 + 模型聚合 Token，随后在 JS 层按模型单价计费并按天汇总，
  // 保证趋势口径与汇总/明细完全一致。
  const rows = await query<{
    date: string;
    model: string | null;
    input_tokens: unknown;
    output_tokens: unknown;
    count: unknown;
  }>(
    isSqlite
      ? `SELECT
           date(datetime(started_at)) as date,
           ${expr.model} as model,
           SUM(${expr.input}) as input_tokens,
           SUM(${expr.output}) as output_tokens,
           COUNT(*) as count
         FROM traces
         WHERE project_id = $1
         AND metadata IS NOT NULL
         AND datetime(started_at) > datetime('now', '-' || $2 || ' days')
         GROUP BY date, model
         ORDER BY date DESC`
      : `SELECT
           DATE(started_at) as date,
           ${expr.model} as model,
           SUM(${expr.input})::text as input_tokens,
           SUM(${expr.output})::text as output_tokens,
           COUNT(*)::text as count
         FROM traces
         WHERE project_id = $1
         AND metadata IS NOT NULL
         AND started_at > NOW() - INTERVAL '1 day' * $2
         GROUP BY DATE(started_at), ${expr.model}
         ORDER BY date DESC`,
    [projectId, days]
  );

  const byDate = new Map<string, { cost: number; count: number }>();
  for (const row of rows) {
    const model = (row.model || 'unknown').toString();
    const cost = calculateCost(model, toInt(row.input_tokens), toInt(row.output_tokens));
    const entry = byDate.get(row.date) || { cost: 0, count: 0 };
    entry.cost += cost;
    entry.count += toInt(row.count);
    byDate.set(row.date, entry);
  }

  return Array.from(byDate.entries())
    .map(([date, v]) => ({ date, cost: Number(v.cost.toFixed(6)), count: v.count }))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}
