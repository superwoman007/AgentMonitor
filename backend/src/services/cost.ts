import { query, queryOne } from '../db/index.js';
import { config } from '../config.js';

export interface ModelPricing {
  input: number;
  output: number;
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  'gpt-4': { input: 0.03, output: 0.06 },
  'gpt-4-turbo': { input: 0.01, output: 0.03 },
  'gpt-4o': { input: 0.005, output: 0.015 },
  'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
  'gpt-3.5-turbo': { input: 0.0015, output: 0.002 },
  'claude-3-opus': { input: 0.015, output: 0.075 },
  'claude-3-sonnet': { input: 0.003, output: 0.015 },
  'claude-3-haiku': { input: 0.00025, output: 0.00125 },
  'default': { input: 0.001, output: 0.002 },
};

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
  message: string;
  potentialSaving: number;
}

function getModelPricing(model: string): ModelPricing {
  const normalizedModel = model.toLowerCase();
  const keys = Object.keys(MODEL_PRICING)
    .filter((k) => k !== 'default')
    .sort((a, b) => b.length - a.length);

  for (const key of keys) {
    const pricing = MODEL_PRICING[key];
    if (!pricing) continue;
    const lower = key.toLowerCase();
    if (normalizedModel.includes(lower) || lower.includes(normalizedModel)) {
      return pricing;
    }
  }
  return MODEL_PRICING['default'];
}

function extractModelFromMetadata(metadata: unknown): string {
  const parsed = parseJsonIfString(metadata);
  if (!parsed || typeof parsed !== 'object') return 'unknown';
  const meta = parsed as Record<string, unknown>;
  return (meta.model as string) || (meta.modelId as string) || 'unknown';
}

function extractTokensFromMetadata(metadata: unknown): { input: number; output: number } {
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

function parseJsonIfString(value: unknown): unknown {
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

export async function getCostByProject(projectId: string, days: number = 7): Promise<CostSummary> {
  const isSqlite = config.dbType === 'sqlite';

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

  const [today, week, month, total] = await Promise.all([
    queryOne<{ cost: unknown }>(
      isSqlite
        ? `SELECT COALESCE(SUM(${costExpr}), 0) as cost
           FROM traces 
           WHERE project_id = $1 
           AND datetime(started_at) > datetime('now', '-1 day')`
        : `SELECT COALESCE(SUM(${costExpr}), 0)::text as cost
           FROM traces 
           WHERE project_id = $1 
           AND started_at > NOW() - INTERVAL '1 day'`,
      [projectId]
    ),
    queryOne<{ cost: unknown }>(
      isSqlite
        ? `SELECT COALESCE(SUM(${costExpr}), 0) as cost
           FROM traces 
           WHERE project_id = $1 
           AND datetime(started_at) > datetime('now', '-7 days')`
        : `SELECT COALESCE(SUM(${costExpr}), 0)::text as cost
           FROM traces 
           WHERE project_id = $1 
           AND started_at > NOW() - INTERVAL '7 days'`,
      [projectId]
    ),
    queryOne<{ cost: unknown }>(
      isSqlite
        ? `SELECT COALESCE(SUM(${costExpr}), 0) as cost
           FROM traces 
           WHERE project_id = $1 
           AND datetime(started_at) > datetime('now', '-30 days')`
        : `SELECT COALESCE(SUM(${costExpr}), 0)::text as cost
           FROM traces 
           WHERE project_id = $1 
           AND started_at > NOW() - INTERVAL '30 days'`,
      [projectId]
    ),
    queryOne<{ cost: unknown }>(
      isSqlite
        ? `SELECT COALESCE(SUM(${costExpr}), 0) as cost
           FROM traces 
           WHERE project_id = $1`
        : `SELECT COALESCE(SUM(${costExpr}), 0)::text as cost
           FROM traces 
           WHERE project_id = $1`,
      [projectId]
    ),
  ]);

  const toNumber = (value: unknown): number =>
    value === null || value === undefined ? 0 : Number(value);

  return {
    today: toNumber(today?.cost),
    week: toNumber(week?.cost),
    month: toNumber(month?.cost),
    total: toNumber(total?.cost),
  };
}

export async function getCostByModel(projectId: string): Promise<CostByModel[]> {
  const isSqlite = config.dbType === 'sqlite';

  const rows = await query<{
    model: string | null;
    count: unknown;
    input_tokens: unknown;
    output_tokens: unknown;
  }>(
    isSqlite
      ? `SELECT
          COALESCE(
            json_extract(metadata, '$.model'),
            json_extract(metadata, '$.modelId'),
            'unknown'
          ) as model,
          COUNT(*) as count,
          SUM(
            COALESCE(json_extract(metadata, '$.usage.prompt_tokens'), 0) +
            COALESCE(json_extract(metadata, '$.usage.input_tokens'), 0) +
            COALESCE(json_extract(metadata, '$.inputTokens'), 0)
            + COALESCE(json_extract(metadata, '$.input_tokens'), 0)
          ) as input_tokens,
          SUM(
            COALESCE(json_extract(metadata, '$.usage.completion_tokens'), 0) +
            COALESCE(json_extract(metadata, '$.usage.output_tokens'), 0) +
            COALESCE(json_extract(metadata, '$.outputTokens'), 0)
            + COALESCE(json_extract(metadata, '$.output_tokens'), 0)
          ) as output_tokens
         FROM traces
         WHERE project_id = $1
         AND metadata IS NOT NULL
         GROUP BY model`
      : `SELECT
          COALESCE(metadata->>'model', metadata->>'modelId', 'unknown') as model,
          COUNT(*)::text as count,
          SUM(
            COALESCE((metadata->'usage'->>'prompt_tokens')::int, 0) +
            COALESCE((metadata->'usage'->>'input_tokens')::int, 0) +
            COALESCE((metadata->>'inputTokens')::int, 0) +
            COALESCE((metadata->>'input_tokens')::int, 0)
          )::text as input_tokens,
          SUM(
            COALESCE((metadata->'usage'->>'completion_tokens')::int, 0) +
            COALESCE((metadata->'usage'->>'output_tokens')::int, 0) +
            COALESCE((metadata->>'outputTokens')::int, 0) +
            COALESCE((metadata->>'output_tokens')::int, 0)
          )::text as output_tokens
         FROM traces
         WHERE project_id = $1
         AND metadata IS NOT NULL
         GROUP BY COALESCE(metadata->>'model', metadata->>'modelId', 'unknown')`,
    [projectId]
  );

  const toInt = (v: unknown): number =>
    v === null || v === undefined ? 0 : parseInt(String(v), 10) || 0;

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
    const model = extractModelFromMetadata(trace.metadata);
    const tokens = extractTokensFromMetadata(trace.metadata);
    const pricing = getModelPricing(model);
    
    const cost = (tokens.input * pricing.input + tokens.output * pricing.output) / 1000;

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
    if (mc.model.toLowerCase().includes('gpt-4') && !mc.model.toLowerCase().includes('turbo') && !mc.model.toLowerCase().includes('mini')) {
      const potentialSaving = mc.totalCost * 0.6;
      suggestions.push({
        type: 'downgrade',
        message: `Consider using GPT-4-Turbo or GPT-4o instead of ${mc.model} for potentially 60% cost savings on $${mc.totalCost.toFixed(2)} spent`,
        potentialSaving,
      });
    }

    if (mc.model.toLowerCase().includes('opus')) {
      const potentialSaving = mc.totalCost * 0.7;
      suggestions.push({
        type: 'downgrade',
        message: `Consider using Claude 3 Sonnet instead of Opus for potentially 70% cost savings on $${mc.totalCost.toFixed(2)} spent`,
        potentialSaving,
      });
    }
  }

  const traces = await query<{ count: string }>(
    config.dbType === 'sqlite'
      ? `SELECT COUNT(*) as count 
         FROM traces 
         WHERE project_id = $1 
         AND datetime(started_at) > datetime('now', '-1 day')`
      : `SELECT COUNT(*)::text as count 
         FROM traces 
         WHERE project_id = $1 
         AND started_at > NOW() - INTERVAL '24 hours'`,
    [projectId]
  );
  
  const recentCount = parseInt(traces[0]?.count || '0', 10);
  
  if (recentCount > 100) {
    suggestions.push({
      type: 'cache',
      message: 'High API call volume detected. Consider implementing response caching for repeated queries',
      potentialSaving: recentCount * 0.001,
    });
  }

  suggestions.push({
    type: 'optimize',
    message: 'Use shorter system prompts and concise instructions to reduce input token costs',
    potentialSaving: 0,
  });

  return suggestions;
}

export async function getCostTrend(projectId: string, days: number = 7): Promise<{ date: string; cost: number; count: number }[]> {
  const isSqlite = config.dbType === 'sqlite';

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

  const result = await query<{
    date: string;
    cost: unknown;
    count: unknown;
  }>(
    isSqlite
      ? `SELECT 
          date(datetime(started_at)) as date,
          COALESCE(SUM(${costExpr}), 0) as cost,
          COUNT(*) as count
         FROM traces 
         WHERE project_id = $1 
         AND datetime(started_at) > datetime('now', '-' || $2 || ' days')
         GROUP BY date(datetime(started_at))
         ORDER BY date DESC`
      : `SELECT 
          DATE(started_at) as date,
          COALESCE(SUM(${costExpr}), 0)::text as cost,
          COUNT(*)::text as count
         FROM traces 
         WHERE project_id = $1 
         AND started_at > NOW() - INTERVAL '1 day' * $2
         GROUP BY DATE(started_at)
         ORDER BY date DESC`,
    [projectId, days]
  );

  return result.map((row) => ({
    date: row.date,
    cost: Number(row.cost ?? 0),
    count: typeof row.count === 'number' ? row.count : parseInt(String(row.count), 10),
  }));
}
