import { query, queryOne } from '../db/index.js';

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
  for (const [key, pricing] of Object.entries(MODEL_PRICING)) {
    if (normalizedModel.includes(key.toLowerCase()) || key.toLowerCase().includes(normalizedModel)) {
      return pricing;
    }
  }
  return MODEL_PRICING['default'];
}

function extractModelFromMetadata(metadata: unknown): string {
  if (!metadata || typeof metadata !== 'object') return 'unknown';
  const meta = metadata as Record<string, unknown>;
  return (meta.model as string) || (meta.modelId as string) || 'unknown';
}

function extractTokensFromMetadata(metadata: unknown): { input: number; output: number } {
  if (!metadata || typeof metadata !== 'object') return { input: 0, output: 0 };
  const meta = metadata as Record<string, unknown>;
  
  const usage = meta.usage as Record<string, unknown> | undefined;
  if (usage) {
    return {
      input: (usage.prompt_tokens as number) || (usage.inputTokens as number) || 0,
      output: (usage.completion_tokens as number) || (usage.outputTokens as number) || 0,
    };
  }
  
  return {
    input: (meta.prompt_tokens as number) || (meta.inputTokens as number) || 0,
    output: (meta.completion_tokens as number) || (meta.outputTokens as number) || 0,
  };
}

export async function getCostByProject(projectId: string, days: number = 7): Promise<CostSummary> {
  const [today, week, month, total] = await Promise.all([
    queryOne<{ cost: string }>(
      `SELECT COALESCE(SUM(
        (COALESCE((metadata->'usage'->>'prompt_tokens')::int, 0) + 
         COALESCE((metadata->>'inputTokens')::int, 0)) * 0.001 / 1000 +
        (COALESCE((metadata->'usage'->>'completion_tokens')::int, 0) + 
         COALESCE((metadata->>'outputTokens')::int, 0)) * 0.002 / 1000
      ), 0)::text as cost
       FROM traces 
       WHERE project_id = $1 
       AND started_at > NOW() - INTERVAL '1 day'`,
      [projectId]
    ),
    queryOne<{ cost: string }>(
      `SELECT COALESCE(SUM(
        (COALESCE((metadata->'usage'->>'prompt_tokens')::int, 0) + 
         COALESCE((metadata->>'inputTokens')::int, 0)) * 0.001 / 1000 +
        (COALESCE((metadata->'usage'->>'completion_tokens')::int, 0) + 
         COALESCE((metadata->>'outputTokens')::int, 0)) * 0.002 / 1000
      ), 0)::text as cost
       FROM traces 
       WHERE project_id = $1 
       AND started_at > NOW() - INTERVAL '7 days'`,
      [projectId]
    ),
    queryOne<{ cost: string }>(
      `SELECT COALESCE(SUM(
        (COALESCE((metadata->'usage'->>'prompt_tokens')::int, 0) + 
         COALESCE((metadata->>'inputTokens')::int, 0)) * 0.001 / 1000 +
        (COALESCE((metadata->'usage'->>'completion_tokens')::int, 0) + 
         COALESCE((metadata->>'outputTokens')::int, 0)) * 0.002 / 1000
      ), 0)::text as cost
       FROM traces 
       WHERE project_id = $1 
       AND started_at > NOW() - INTERVAL '30 days'`,
      [projectId]
    ),
    queryOne<{ cost: string }>(
      `SELECT COALESCE(SUM(
        (COALESCE((metadata->'usage'->>'prompt_tokens')::int, 0) + 
         COALESCE((metadata->>'inputTokens')::int, 0)) * 0.001 / 1000 +
        (COALESCE((metadata->'usage'->>'completion_tokens')::int, 0) + 
         COALESCE((metadata->>'outputTokens')::int, 0)) * 0.002 / 1000
      ), 0)::text as cost
       FROM traces 
       WHERE project_id = $1`,
      [projectId]
    ),
  ]);

  return {
    today: parseFloat(today?.cost || '0'),
    week: parseFloat(week?.cost || '0'),
    month: parseFloat(month?.cost || '0'),
    total: parseFloat(total?.cost || '0'),
  };
}

export async function getCostByModel(projectId: string): Promise<CostByModel[]> {
  const traces = await query<{
    metadata: unknown;
    count: string;
  }>(
    `SELECT metadata, COUNT(*)::text as count
     FROM traces 
     WHERE project_id = $1 
     AND metadata IS NOT NULL
     GROUP BY metadata`,
    [projectId]
  );

  const modelCosts: Record<string, CostByModel> = {};

  for (const trace of traces) {
    const model = extractModelFromMetadata(trace.metadata);
    const tokens = extractTokensFromMetadata(trace.metadata);
    const pricing = getModelPricing(model);
    const count = parseInt(trace.count, 10);
    
    const inputCost = (tokens.input * pricing.input * count) / 1000;
    const outputCost = (tokens.output * pricing.output * count) / 1000;

    if (modelCosts[model]) {
      modelCosts[model].count += count;
      modelCosts[model].totalCost += inputCost + outputCost;
      modelCosts[model].inputCost += inputCost;
      modelCosts[model].outputCost += outputCost;
      modelCosts[model].inputTokens += tokens.input * count;
      modelCosts[model].outputTokens += tokens.output * count;
    } else {
      modelCosts[model] = {
        model,
        count,
        totalCost: inputCost + outputCost,
        inputCost,
        outputCost,
        inputTokens: tokens.input * count,
        outputTokens: tokens.output * count,
      };
    }
  }

  return Object.values(modelCosts).sort((a, b) => b.totalCost - a.totalCost);
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
    `SELECT COUNT(*)::text as count FROM traces WHERE project_id = $1 AND started_at > NOW() - INTERVAL '24 hours'`,
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
  const result = await query<{
    date: string;
    cost: string;
    count: string;
  }>(
    `SELECT 
      DATE(started_at) as date,
      COALESCE(SUM(
        (COALESCE((metadata->'usage'->>'prompt_tokens')::int, 0) + 
         COALESCE((metadata->>'inputTokens')::int, 0)) * 0.001 / 1000 +
        (COALESCE((metadata->'usage'->>'completion_tokens')::int, 0) + 
         COALESCE((metadata->>'outputTokens')::int, 0)) * 0.002 / 1000
      ), 0)::text as cost,
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
    cost: parseFloat(row.cost),
    count: parseInt(row.count, 10),
  }));
}
