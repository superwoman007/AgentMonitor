import { query, queryOne, toDbJson, fromDbJson } from '../db/index.js';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config.js';

export interface Session {
  id: string;
  project_id: string;
  agent_id: string | null;
  started_at: Date;
  ended_at: Date | null;
  status: string;
  metadata: unknown | null;
  created_at: Date;
}

export interface Message {
  id: string;
  session_id: string;
  role: string;
  content: string;
  timestamp: Date;
  metadata: unknown | null;
  created_at: Date;
}

/**
 * 创建会话。幂等：相同 session_id 已存在时直接返回既有记录，
 * 避免 Agent SDK 并发/重试上报时触发主键冲突。
 * @param projectId 项目 ID
 * @param sessionId 外部 SDK 指定的会话 ID（可为 UUID 或自定义字符串）
 * @param metadata 会话元数据
 * @returns 新建或已存在的会话
 */
export async function createSession(
  projectId: string,
  sessionId: string,
  metadata?: unknown
): Promise<Session> {
  const now = new Date().toISOString();
  let session: Session | null = null;

  if (config.dbType === 'postgres') {
    // PostgreSQL：ON CONFLICT DO NOTHING 保证幂等，JSONB 直接传对象
    await queryOne<Session>(
      `INSERT INTO sessions (id, project_id, agent_id, started_at, status, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO NOTHING
       RETURNING *`,
      [sessionId, projectId, null, now, 'active', toDbJson(metadata)]
    );
    session = await queryOne<Session>('SELECT * FROM sessions WHERE id = $1', [sessionId]);
  } else {
    // SQLite：INSERT OR IGNORE 幂等，未插入时回查既有记录
    const inserted = await queryOne<Session>(
      `INSERT OR IGNORE INTO sessions (id, project_id, agent_id, started_at, status, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [sessionId, projectId, null, now, 'active', toDbJson(metadata)]
    );
    session = inserted ?? await queryOne<Session>('SELECT * FROM sessions WHERE id = $1', [sessionId]);
  }

  if (!session) {
    throw new Error('Failed to create session');
  }

  return {
    ...session,
    metadata: fromDbJson(session.metadata),
  } as Session;
}

export async function getSessionById(sessionId: string): Promise<Session | null> {
  const session = await queryOne<Session>('SELECT * FROM sessions WHERE id = $1', [sessionId]);
  if (!session) return null;

  return {
    ...session,
    metadata: fromDbJson(session.metadata),
  } as Session;
}

export async function getSessionsByProject(
  projectId: string,
  options?: {
    limit?: number;
    offset?: number;
    status?: string;
  }
): Promise<Session[]> {
  const conditions: string[] = ['project_id = $1'];
  const params: unknown[] = [projectId];
  let paramIndex = 2;
  
  if (options?.status) {
    conditions.push(`status = $${paramIndex}`);
    params.push(options.status);
    paramIndex++;
  }
  
  const limit = options?.limit || 50;
  const offset = options?.offset || 0;
  
  params.push(limit, offset);
  
  const sessions = await query<Session>(
    `SELECT * FROM sessions 
     WHERE ${conditions.join(' AND ')}
     ORDER BY started_at DESC
     LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    params
  );
  
  // 归一化 metadata（SQLite 为 JSON 字符串，PG JSONB 已为对象）
  return sessions.map(s => ({
    ...s,
    metadata: fromDbJson(s.metadata),
  })) as Session[];
}

/**
 * 结束指定会话
 *
 * 将 sessions 表中对应记录的 status 置为 'ended'，并写入 ended_at。
 * 时间表达式按数据库类型选择（SQLite 使用 datetime('now')，PostgreSQL 使用 NOW()），
 * 以保证开发（SQLite）与生产（PostgreSQL）环境均可正确执行。
 *
 * @param sessionId 会话 ID
 * @returns 更新后的 Session；若会话不存在则返回 null
 */
export async function endSession(sessionId: string): Promise<Session | null> {
  const nowExpr = config.dbType === 'sqlite' ? "datetime('now')" : 'NOW()';
  return queryOne<Session>(
    `UPDATE sessions
     SET status = 'ended', ended_at = ${nowExpr}
     WHERE id = $1
     RETURNING *`,
    [sessionId]
  );
}

export async function addMessage(
  sessionId: string,
  role: string,
  content: string,
  timestamp: string,
  metadata?: unknown
): Promise<Message> {
  const messageId = uuidv4();
  
  const message = await queryOne<Message>(
    `INSERT INTO messages (id, session_id, role, content, timestamp, metadata)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      messageId,
      sessionId,
      role,
      content,
      timestamp,
      toDbJson(metadata),
    ]
  );

  if (!message) {
    throw new Error('Failed to add message');
  }

  // 归一化 metadata（SQLite 为 JSON 字符串，PG JSONB 已为对象）
  return {
    ...message,
    metadata: fromDbJson(message.metadata),
  } as Message;
}

export async function getMessagesBySession(
  sessionId: string,
  options?: {
    limit?: number;
    offset?: number;
  }
): Promise<Message[]> {
  const limit = options?.limit || 100;
  const offset = options?.offset || 0;
  
  const messages = await query<Message>(
    `SELECT * FROM messages 
     WHERE session_id = $1 
     ORDER BY timestamp ASC
     LIMIT $2 OFFSET $3`,
    [sessionId, limit, offset]
  );
  
  // 归一化 metadata（SQLite 为 JSON 字符串，PG JSONB 已为对象）
  return messages.map(m => ({
    ...m,
    metadata: fromDbJson(m.metadata),
  })) as Message[];
}

export interface TimelineItem {
  type: 'message' | 'trace' | 'tool_call';
  id: string;
  timestamp: string;
  data: unknown;
}

export async function getSessionTimeline(sessionId: string): Promise<TimelineItem[]> {
  const [messages, traces, toolCalls] = await Promise.all([
    query<Message>(
      `SELECT id, session_id, role, content, timestamp, metadata, created_at 
       FROM messages WHERE session_id = $1 ORDER BY timestamp ASC`,
      [sessionId]
    ),
    query<{
      id: string; name: string; trace_type: string; input: unknown; output: unknown;
      status: string; latency_ms: number | null; started_at: string; error: string | null;
    }>(
      `SELECT id, name, trace_type, input, output, status, latency_ms, started_at, error
       FROM traces WHERE session_id = $1 ORDER BY started_at ASC`,
      [sessionId]
    ),
    query<{
      id: string; tool_name: string; input: unknown; output: unknown; status: string; started_at: string;
    }>(
      // SQLite 的工具调用输入列为 input；PostgreSQL 为 input_params，需按库切换列名/别名。
      config.dbType === 'postgres'
        ? `SELECT id, tool_name, input_params AS input, output,
                  'completed' AS status,
                  started_at
           FROM tool_calls WHERE session_id = $1 ORDER BY started_at ASC`
        : `SELECT id, tool_name, input, output, status, started_at
           FROM tool_calls WHERE session_id = $1 ORDER BY started_at ASC`,
      [sessionId]
    ),
  ]);
  
  const items: TimelineItem[] = [];
  
  for (const m of messages) {
    items.push({
      type: 'message',
      id: m.id,
      timestamp: m.timestamp as unknown as string,
      data: {
        role: m.role,
        content: m.content,
        metadata: fromDbJson(m.metadata),
      },
    });
  }
  
  for (const t of traces) {
    items.push({
      type: 'trace',
      id: t.id,
      timestamp: t.started_at,
      data: {
        name: t.name,
        trace_type: t.trace_type,
        input: fromDbJson(t.input),
        output: fromDbJson(t.output),
        status: t.status,
        latency_ms: t.latency_ms,
        error: t.error,
      },
    });
  }
  
  for (const tc of toolCalls) {
    items.push({
      type: 'tool_call',
      id: tc.id,
      timestamp: tc.started_at,
      data: {
        tool_name: tc.tool_name,
        input: fromDbJson(tc.input),
        output: fromDbJson(tc.output),
        status: tc.status,
      },
    });
  }
  
  // Sort by timestamp
  items.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  
  return items;
}
