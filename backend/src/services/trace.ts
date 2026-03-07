import { query, queryOne } from '../db/index.js';
import { v4 as uuidv4 } from 'uuid';

export interface Trace {
  id: string;
  project_id: string;
  session_id: string | null;
  agent_id: string | null;
  trace_type: string;
  name: string;
  input: unknown;
  output: unknown | null;
  metadata: unknown | null;
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
  traceType: string;
  name: string;
  input?: unknown;
  output?: unknown;
  metadata?: unknown;
  startedAt: Date;
  endedAt?: Date;
  latencyMs?: number;
  status?: string;
  error?: string;
}

export async function createTrace(data: TraceInput): Promise<Trace> {
  const id = uuidv4();
  const status = data.status ?? (data.error ? 'error' : 'success');
  
  const trace = await queryOne<Trace>(
    `INSERT INTO traces (
      id, project_id, session_id, agent_id, trace_type, name, 
      input, output, metadata, started_at, ended_at, latency_ms, status, error
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    RETURNING *`,
    [
      id,
      data.projectId,
      data.sessionId || null,
      data.agentId || null,
      data.traceType,
      data.name,
      JSON.stringify(data.input || {}),
      data.output ? JSON.stringify(data.output) : null,
      data.metadata ? JSON.stringify(data.metadata) : null,
      data.startedAt.toISOString(),
      data.endedAt ? data.endedAt.toISOString() : null,
      data.latencyMs ?? null,
      status,
      data.error || null,
    ]
  );
  
  if (!trace) {
    throw new Error('Failed to create trace');
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
  
  if (updates.length === 0) {
    return getTraceById(traceId);
  }
  
  params.push(traceId);
  
  return queryOne<Trace>(
    `UPDATE traces SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    params
  );
}
