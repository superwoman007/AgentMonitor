import { query, queryOne } from '../db/index.js';
import { v4 as uuidv4 } from 'uuid';

export interface Snapshot {
  id: string;
  session_id: string;
  breakpoint_id: string | null;
  trigger_reason: string;
  state: Record<string, unknown>;
  timestamp: Date;
  created_at: Date;
}

type SnapshotRow = Omit<Snapshot, 'state' | 'timestamp' | 'created_at'> & {
  state: unknown;
  timestamp: unknown;
  created_at: unknown;
};

export interface SnapshotCreateData {
  sessionId: string;
  breakpointId?: string;
  triggerReason: string;
  state: Record<string, unknown>;
  timestamp?: Date;
}

export interface SnapshotState {
  messages?: Array<{
    role: string;
    content: string;
    timestamp: string;
  }>;
  variables?: Record<string, unknown>;
  toolCalls?: Array<{
    toolName: string;
    input: unknown;
    output?: unknown;
    error?: string;
  }>;
  metadata?: Record<string, unknown>;
  stackTrace?: string[];
  error?: {
    message: string;
    code?: string;
  };
}

export async function createSnapshot(data: SnapshotCreateData): Promise<Snapshot> {
  const id = uuidv4();
  
  const snapshot = await queryOne<SnapshotRow>(
    `INSERT INTO snapshots (id, session_id, breakpoint_id, trigger_reason, state, timestamp)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      id,
      data.sessionId,
      data.breakpointId || null,
      data.triggerReason,
      JSON.stringify(data.state),
      data.timestamp ? (data.timestamp instanceof Date ? data.timestamp.toISOString() : data.timestamp) : new Date().toISOString(),
    ]
  );
  
  if (!snapshot) {
    throw new Error('Failed to create snapshot');
  }
  
  return normalizeSnapshot(snapshot);
}

export async function getSnapshotById(id: string): Promise<Snapshot | null> {
  const row = await queryOne<SnapshotRow>('SELECT * FROM snapshots WHERE id = $1', [id]);
  return row ? normalizeSnapshot(row) : null;
}

export async function getSnapshotsBySession(sessionId: string): Promise<Snapshot[]> {
  const rows = await query<SnapshotRow>(
    'SELECT * FROM snapshots WHERE session_id = $1 ORDER BY timestamp DESC',
    [sessionId]
  );
  return rows.map(normalizeSnapshot);
}

export async function getSnapshotsByBreakpoint(breakpointId: string): Promise<Snapshot[]> {
  const rows = await query<SnapshotRow>(
    'SELECT * FROM snapshots WHERE breakpoint_id = $1 ORDER BY timestamp DESC',
    [breakpointId]
  );
  return rows.map(normalizeSnapshot);
}

export async function deleteSnapshotsBySession(sessionId: string): Promise<number> {
  const result = await query<SnapshotRow>(
    'DELETE FROM snapshots WHERE session_id = $1 RETURNING *',
    [sessionId]
  );
  
  return result.length;
}

export async function getSnapshotCount(sessionId: string): Promise<number> {
  const result = await queryOne<{ count: string }>(
    'SELECT COUNT(*) as count FROM snapshots WHERE session_id = $1',
    [sessionId]
  );
  
  return result ? parseInt(result.count, 10) : 0;
}

export async function getSnapshotsByProject(projectId: string): Promise<Snapshot[]> {
  const result = await query<SnapshotRow>(
    `SELECT s.* FROM snapshots s
     JOIN sessions sess ON s.session_id = sess.id
     WHERE sess.project_id = $1
     ORDER BY s.timestamp DESC`,
    [projectId]
  );
  
  return result.map(normalizeSnapshot);
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

function parseDateIfString(value: unknown): Date {
  if (value instanceof Date) return value;
  if (typeof value === 'string') {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

function normalizeSnapshot(row: SnapshotRow): Snapshot {
  let state = parseJsonIfString(row.state);
  if (typeof state === 'string') {
    const twice = parseJsonIfString(state);
    state = twice;
  }

  const safeState =
    state && typeof state === 'object' ? (state as Record<string, unknown>) : { raw: state };

  return {
    id: row.id,
    session_id: row.session_id,
    breakpoint_id: row.breakpoint_id,
    trigger_reason: row.trigger_reason,
    state: safeState,
    timestamp: parseDateIfString(row.timestamp),
    created_at: parseDateIfString(row.created_at),
  };
}
