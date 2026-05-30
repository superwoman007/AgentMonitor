import { query, queryOne, run } from '../db/index.js';
import { v4 as uuidv4 } from 'uuid';
import { createSpan } from './span.js';

export interface Trace {
  id: string;
  project_id: string;
  session_id: string | null;
  agent_id: string | null;
  parent_trace_id: string | null;
  trace_type: string;
  name: string;
  input: unknown;
  output: unknown | null;
  metadata: unknown | null;
  trace_id: string | null;
  span_id: string | null;
  parent_span_id: string | null;
  prompt_id: string | null;
  prompt_version_id: string | null;
  started_at: Date;
  ended_at: Date | null;
  latency_ms: number | null;
  status: string;
  error: string | null;
  created_at: Date;
}

export interface TraceInput {
  projectId: string;
  sessionId?: string;
  agentId?: string;
  parentTraceId?: string;
  traceType: string;
  name: string;
  input?: unknown;
  output?: unknown;
  metadata?: unknown;
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  promptId?: string;
  promptVersionId?: string;
  startedAt?: Date;
  endedAt?: Date;
  latencyMs?: number;
  status?: string;
  error?: string;
}

export async function createTrace(data: TraceInput): Promise<Trace> {
  const id = uuidv4();
  const status = data.status ?? (data.error ? 'error' : 'success');
  // 自动生成 traceId，确保后续双写时 spans 表有对应的 trace_id
  const traceId = data.traceId || uuidv4();
  // 默认使用当前时间作为 startedAt
  const startedAt = data.startedAt || new Date();

  // 如果传入了 sessionId 但 session 不存在，自动创建（避免外键约束失败）
  let sessionId = data.sessionId || null;
  if (sessionId) {
    const existingSession = await queryOne<{ id: string }>('SELECT id FROM sessions WHERE id = $1', [sessionId]);
    if (!existingSession) {
      try {
        const { createSession } = await import('./session.js');
        await createSession(data.projectId, sessionId);
      } catch {
        sessionId = null;
      }
    }
  }

  const trace = await queryOne<Trace>(
    `INSERT INTO traces (
      id, project_id, session_id, agent_id, parent_trace_id, trace_type, name,
      input, output, metadata, trace_id, span_id, parent_span_id, prompt_id, prompt_version_id,
      started_at, ended_at, latency_ms, status, error
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
    RETURNING *`,
    [
      id,
      data.projectId,
      sessionId,
      data.agentId || null,
      data.parentTraceId || null,
      data.traceType,
      data.name,
      JSON.stringify(data.input || {}),
      data.output ? JSON.stringify(data.output) : null,
      data.metadata ? JSON.stringify(data.metadata) : null,
      traceId,
      data.spanId || null,
      data.parentSpanId || null,
      data.promptId || null,
      data.promptVersionId || null,
      startedAt.toISOString(),
      data.endedAt ? data.endedAt.toISOString() : null,
      data.latencyMs ?? null,
      status,
      data.error || null,
    ]
  );

  if (!trace) {
    throw new Error('Failed to create trace');
  }

  // 双写：将 trace 数据同步写入 spans 表，创建 root span
  try {
    await createSpan({
      projectId: data.projectId,
      spanId: data.spanId || traceId,  // 优先使用传入的 spanId，否则用 traceId
      traceId: traceId,
      parentSpanId: data.parentSpanId || null,
      name: data.name,
      traceType: data.traceType,
      startedAt: startedAt,
      endedAt: data.endedAt,
      latencyMs: data.latencyMs,
      input: data.input,
      output: data.output,
      attributes: data.metadata as Record<string, unknown> | undefined,
      status: data.status,
      error: data.error,
      sessionId: data.sessionId || null,
    });
  } catch (e) {
    // 双写失败不影响 traces 主流程
    console.warn('[Trace] Dual-write to spans failed:', e);
  }

  return trace;
}

export async function getTracesByProject(
  projectId: string,
  options?: {
    limit?: number;
    offset?: number;
    sessionId?: string;
    traceType?: string;
    status?: string;
    parentTraceId?: string;
    evalStatus?: string;
    name?: string;
    startDate?: string;
    endDate?: string;
    latencyMin?: number;
    latencyMax?: number;
  }
): Promise<Trace[]> {
  const conditions: string[] = ['project_id = $1'];
  const params: unknown[] = [projectId];
  let paramIndex = 2;
  
  if (options?.sessionId) {
    conditions.push(`session_id = $${paramIndex}`);
    params.push(options.sessionId);
    paramIndex++;
  }
  
  if (options?.traceType) {
    conditions.push(`trace_type = $${paramIndex}`);
    params.push(options.traceType);
    paramIndex++;
  }
  
  if (options?.status) {
    conditions.push(`status = $${paramIndex}`);
    params.push(options.status);
    paramIndex++;
  }

  if (options?.parentTraceId !== undefined) {
    conditions.push(`parent_trace_id = $${paramIndex}`);
    params.push(options.parentTraceId);
    paramIndex++;
  }

  if (options?.name) {
    conditions.push(`LOWER(name) LIKE '%' || $${paramIndex} || '%'`);
    params.push(options.name.toLowerCase());
    paramIndex++;
  }

  if (options?.startDate) {
    conditions.push(`started_at >= $${paramIndex}`);
    params.push(options.startDate);
    paramIndex++;
  }

  if (options?.endDate) {
    conditions.push(`started_at <= $${paramIndex}`);
    params.push(options.endDate);
    paramIndex++;
  }

  if (options?.latencyMin !== undefined) {
    conditions.push(`latency_ms >= $${paramIndex}`);
    params.push(options.latencyMin);
    paramIndex++;
  }

  if (options?.latencyMax !== undefined) {
    conditions.push(`latency_ms <= $${paramIndex}`);
    params.push(options.latencyMax);
    paramIndex++;
  }

  if (options?.evalStatus === 'needs_attention') {
    conditions.push(`(latest_eval_passed = 0 OR status = 'error')`);
  } else if (options?.evalStatus === 'passed') {
    conditions.push(`latest_eval_passed = 1`);
  } else if (options?.evalStatus === 'unevaluated') {
    conditions.push(`latest_eval_score IS NULL`);
  }
  
  const limit = options?.limit || 50;
  const offset = options?.offset || 0;
  
  params.push(limit, offset);
  
  return query<Trace>(
    `SELECT * FROM traces 
     WHERE ${conditions.join(' AND ')}
     ORDER BY started_at DESC
     LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    params
  );
}

export async function getTraceById(traceId: string): Promise<Trace | null> {
  return queryOne<Trace>('SELECT * FROM traces WHERE id = $1', [traceId]);
}

export async function getTracesByIds(traceIds: string[]): Promise<Trace[]> {
  if (traceIds.length === 0) return [];
  const placeholders = traceIds.map((_, i) => `$${i + 1}`).join(',');
  return query<Trace>(
    `SELECT * FROM traces WHERE id IN (${placeholders})`,
    traceIds
  );
}

export async function getChildTraces(parentTraceId: string): Promise<Trace[]> {
  return query<Trace>(
    'SELECT * FROM traces WHERE parent_trace_id = $1 ORDER BY started_at ASC',
    [parentTraceId]
  );
}

export async function getTraceTree(traceId: string): Promise<{ trace: Trace; children: Trace[] } | null> {
  const trace = await getTraceById(traceId);
  if (!trace) return null;
  
  const children = await getChildTraces(traceId);
  return { trace, children };
}

export async function getChildTraceCount(traceId: string): Promise<number> {
  const result = await queryOne<{ count: string }>(
    'SELECT COUNT(*) as count FROM traces WHERE parent_trace_id = $1',
    [traceId]
  );
  return result ? parseInt(result.count, 10) : 0;
}

export async function getTracesByPrompt(
  promptId: string,
  options?: { limit?: number; offset?: number }
): Promise<Trace[]> {
  const limit = options?.limit || 50;
  const offset = options?.offset || 0;
  return query<Trace>(
    `SELECT * FROM traces WHERE prompt_id = $1 ORDER BY started_at DESC LIMIT $2 OFFSET $3`,
    [promptId, limit, offset]
  );
}

export async function updateTrace(traceId: string, data: Partial<TraceInput>): Promise<Trace | null> {
  const updates: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;
  
  if (data.output !== undefined) {
    updates.push(`output = $${paramIndex}`);
    params.push(JSON.stringify(data.output));
    paramIndex++;
  }
  
  if (data.endedAt !== undefined) {
    updates.push(`ended_at = $${paramIndex}`);
    params.push(data.endedAt);
    paramIndex++;
  }
  
  if (data.latencyMs !== undefined) {
    updates.push(`latency_ms = $${paramIndex}`);
    params.push(data.latencyMs);
    paramIndex++;
  }
  
  if (data.status !== undefined) {
    updates.push(`status = $${paramIndex}`);
    params.push(data.status);
    paramIndex++;
  }
  
  if (data.error !== undefined) {
    updates.push(`error = $${paramIndex}`);
    params.push(data.error);
    paramIndex++;
  }

  if (data.traceId !== undefined) {
    updates.push(`trace_id = $${paramIndex}`);
    params.push(data.traceId);
    paramIndex++;
  }

  if (data.spanId !== undefined) {
    updates.push(`span_id = $${paramIndex}`);
    params.push(data.spanId);
    paramIndex++;
  }

  if (data.parentSpanId !== undefined) {
    updates.push(`parent_span_id = $${paramIndex}`);
    params.push(data.parentSpanId);
    paramIndex++;
  }

  if (data.promptId !== undefined) {
    updates.push(`prompt_id = $${paramIndex}`);
    params.push(data.promptId);
    paramIndex++;
  }

  if (data.promptVersionId !== undefined) {
    updates.push(`prompt_version_id = $${paramIndex}`);
    params.push(data.promptVersionId);
    paramIndex++;
  }
  
  if (updates.length === 0) {
    return getTraceById(traceId);
  }
  
  params.push(traceId);
  
  return queryOne<Trace>(
    `UPDATE traces SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    params
  );
}

export interface TraceEvalResult {
  id: string;
  trace_id: string;
  evaluator: string | null;
  score: number | null;
  passed: number | null;
  details: Record<string, unknown> | null;
  created_at: Date;
}

export async function addTraceEvalResult(
  traceId: string,
  evaluator: string,
  score: number,
  passed: boolean,
  details?: Record<string, unknown>
): Promise<TraceEvalResult> {
  const result = await queryOne<TraceEvalResult>(
    `INSERT INTO trace_eval_results (id, trace_id, evaluator, score, passed, details)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [crypto.randomUUID(), traceId, evaluator, score, passed ? 1 : 0, details ? JSON.stringify(details) : null]
  );

  // Update trace latest eval score
  await run(
    `UPDATE traces SET latest_eval_score = $1, latest_eval_passed = $2 WHERE id = $3`,
    [score, passed ? 1 : 0, traceId]
  );

  if (result && typeof result.details === 'string') {
    try { result.details = JSON.parse(result.details); } catch { result.details = null; }
  }
  return result!;
}

export async function getTraceEvalResults(traceId: string): Promise<TraceEvalResult[]> {
  const rows = await query<TraceEvalResult>(
    `SELECT * FROM trace_eval_results WHERE trace_id = $1 ORDER BY created_at DESC`,
    [traceId]
  );
  return rows.map(row => {
    if (row.details && typeof row.details === 'string') {
      try { row.details = JSON.parse(row.details); } catch { row.details = null; }
    }
    return row;
  });
}
