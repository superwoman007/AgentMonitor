import { query, queryOne, run } from '../db/index.js';
import { config } from '../config.js';
import { sanitizeData } from '../middleware/sanitize.js';
import { truncateJson } from '../utils/truncate.js';

export interface Span {
  span_id: string;
  trace_id: string;
  parent_span_id: string | null;
  name: string;
  trace_type: string;
  started_at: Date;
  ended_at: Date | null;
  latency_ms: number | null;
  input: unknown;
  output: unknown | null;
  attributes: unknown | null;
  status: string;
  error: string | null;
  project_id: string;
  session_id: string | null;
  created_at: Date;
}

export interface SpanInput {
  spanId: string;
  traceId: string;
  parentSpanId?: string | null;
  name: string;
  traceType: string;
  startedAt: Date;
  endedAt?: Date;
  latencyMs?: number;
  input?: unknown;
  output?: unknown;
  attributes?: Record<string, unknown>;
  status?: string;
  error?: string;
  projectId: string;
  sessionId?: string | null;
}

export interface SpanTreeNode {
  spanId: string;
  name: string;
  traceType: string;
  startedAt: string;
  endedAt: string | null;
  latencyMs: number | null;
  status: string;
  error: string | null;
  input: unknown;
  output: unknown;
  attributes: unknown;
  tokens: { prompt?: number; completion?: number; total?: number } | null;
  costUsd: number | null;
  children: SpanTreeNode[];
}

export async function createSpan(data: SpanInput): Promise<Span> {
  const safeInput = data.input ? sanitizeData(data.input) : null;
  const safeOutput = data.output ? sanitizeData(data.output) : null;
  const safeAttributes = data.attributes ? sanitizeData(data.attributes) : null;

  const truncatedInput = safeInput ? truncateJson(safeInput, 512 * 1024, 'input') : null;
  const truncatedOutput = safeOutput ? truncateJson(safeOutput, 512 * 1024, 'output') : null;

  // 使用 INSERT OR IGNORE / ON CONFLICT 实现幂等插入，避免双写时 UNIQUE 约束冲突
  const insertSql = config.dbType === 'sqlite'
    ? `INSERT OR IGNORE INTO spans (
        span_id, trace_id, parent_span_id, name, trace_type,
        started_at, ended_at, latency_ms, input, output, attributes,
        status, error, project_id, session_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`
    : `INSERT INTO spans (
        span_id, trace_id, parent_span_id, name, trace_type,
        started_at, ended_at, latency_ms, input, output, attributes,
        status, error, project_id, session_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      ON CONFLICT (span_id) DO NOTHING`;

  await run(insertSql, [
    data.spanId,
    data.traceId,
    data.parentSpanId || null,
    data.name,
    data.traceType,
    data.startedAt.toISOString(),
    data.endedAt ? data.endedAt.toISOString() : null,
    data.latencyMs ?? null,
    truncatedInput ? JSON.stringify(truncatedInput) : null,
    truncatedOutput ? JSON.stringify(truncatedOutput) : null,
    safeAttributes ? JSON.stringify(safeAttributes) : null,
    data.status || 'unset',
    data.error || null,
    data.projectId,
    data.sessionId || null,
  ]);

  // 查询返回已插入或已存在的 span 记录
  const span = await queryOne<Span>(
    'SELECT * FROM spans WHERE span_id = $1',
    [data.spanId]
  );

  if (!span) throw new Error('Failed to create span');

  return deserializeSpan(span);
}

export async function getSpanTree(traceId: string): Promise<{
  rootSpan: SpanTreeNode | null;
  stats: { totalSpans: number; totalLatencyMs: number; totalTokens: { prompt: number; completion: number; total: number }; totalCostUsd: number; errorCount: number };
} | null> {
  const spans = await query<Span>(
    `SELECT * FROM spans WHERE trace_id = $1 ORDER BY started_at ASC`,
    [traceId]
  );

  if (spans.length === 0) return null;

  const parsedSpans = spans.map(deserializeSpan);

  const spanMap = new Map<string, SpanTreeNode>();
  for (const s of parsedSpans) {
    spanMap.set(s.span_id, {
      spanId: s.span_id,
      name: s.name,
      traceType: s.trace_type,
      startedAt: s.started_at instanceof Date ? s.started_at.toISOString() : s.started_at,
      endedAt: s.ended_at instanceof Date ? s.ended_at.toISOString() : s.ended_at,
      latencyMs: s.latency_ms,
      status: s.status,
      error: s.error,
      input: s.input,
      output: s.output,
      attributes: s.attributes,
      tokens: extractTokens(s.attributes),
      costUsd: extractCost(s.attributes),
      children: [],
    });
  }

  const cycleNodes = detectCycles(parsedSpans);

  let rootNode: SpanTreeNode | null = null;
  const orphaned: SpanTreeNode[] = [];

  for (const node of spanMap.values()) {
    const rawSpan = parsedSpans.find(s => s.span_id === node.spanId)!;
    if (cycleNodes.has(node.spanId)) {
      orphaned.push(node);
      continue;
    }
    if (!rawSpan.parent_span_id) {
      if (!rootNode) rootNode = node;
      else orphaned.push(node);
    } else {
      const parent = spanMap.get(rawSpan.parent_span_id);
      if (parent && !cycleNodes.has(rawSpan.parent_span_id)) {
        parent.children.push(node);
      } else {
        orphaned.push(node);
      }
    }
  }

  if (orphaned.length > 0 && rootNode) {
    rootNode.children.push(...orphaned);
  } else if (orphaned.length > 0 && !rootNode) {
    rootNode = orphaned[0];
    rootNode.children.push(...orphaned.slice(1));
  }

  const stats = calculateStats(parsedSpans);

  return { rootSpan: rootNode, stats };
}

function detectCycles(spans: Span[]): Set<string> {
  const cycleNodes = new Set<string>();
  const parentMap = new Map<string, string | null>();
  for (const s of spans) {
    parentMap.set(s.span_id, s.parent_span_id);
  }

  for (const spanId of parentMap.keys()) {
    if (cycleNodes.has(spanId)) continue;
    const visited = new Set<string>();
    let current: string | null = spanId;
    let depth = 0;
    while (current && depth <= 100) {
      if (visited.has(current)) {
        const cycleStart = current;
        const cycle = new Set<string>();
        do {
          cycle.add(current);
          current = parentMap.get(current) || null;
        } while (current && current !== cycleStart && cycle.size < 100);
        for (const id of cycle) cycleNodes.add(id);
        break;
      }
      visited.add(current);
      current = parentMap.get(current) || null;
      depth++;
    }
    if (depth > 100) {
      for (const id of visited) cycleNodes.add(id);
    }
  }
  return cycleNodes;
}

function extractTokens(attrs: unknown): { prompt?: number; completion?: number; total?: number } | null {
  if (!attrs || typeof attrs !== 'object') return null;
  const a = attrs as Record<string, unknown>;
  const prompt = a.tokens_prompt ?? a.prompt_tokens ?? a.tokens?.prompt;
  const completion = a.tokens_completion ?? a.completion_tokens ?? a.tokens?.completion;
  const total = a.tokens_total ?? a.total_tokens ?? a.tokens?.total;
  if (prompt === undefined && completion === undefined && total === undefined) return null;
  return {
    prompt: typeof prompt === 'number' ? prompt : undefined,
    completion: typeof completion === 'number' ? completion : undefined,
    total: typeof total === 'number' ? total : undefined,
  };
}

function extractCost(attrs: unknown): number | null {
  if (!attrs || typeof attrs !== 'object') return null;
  const a = attrs as Record<string, unknown>;
  const cost = a.cost_usd ?? a.costUsd ?? a.cost;
  return typeof cost === 'number' ? cost : null;
}

function calculateStats(spans: Span[]): {
  totalSpans: number;
  totalLatencyMs: number;
  totalTokens: { prompt: number; completion: number; total: number };
  totalCostUsd: number;
  errorCount: number;
} {
  let totalLatency = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let totalTokens = 0;
  let totalCost = 0;
  let errors = 0;

  for (const s of spans) {
    if (s.latency_ms) totalLatency += s.latency_ms;
    if (s.status === 'error') errors++;
    const tokens = extractTokens(s.attributes);
    if (tokens) {
      if (tokens.prompt) promptTokens += tokens.prompt;
      if (tokens.completion) completionTokens += tokens.completion;
      if (tokens.total) totalTokens += tokens.total;
    }
    const cost = extractCost(s.attributes);
    if (cost) totalCost += cost;
  }

  return {
    totalSpans: spans.length,
    totalLatencyMs: totalLatency,
    totalTokens: { prompt: promptTokens, completion: completionTokens, total: totalTokens },
    totalCostUsd: totalCost,
    errorCount: errors,
  };
}

function deserializeSpan(span: Span): Span {
  return {
    ...span,
    input: parseJsonField(span.input),
    output: parseJsonField(span.output),
    attributes: parseJsonField(span.attributes),
  };
}

function parseJsonField(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return value;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return value; }
  }
  return value;
}
