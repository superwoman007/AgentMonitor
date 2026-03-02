import { query, queryOne } from '../db/index.js';
import { v4 as uuidv4 } from 'uuid';

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

export async function createSession(
  projectId: string,
  sessionId: string,
  metadata?: unknown
): Promise<Session> {
  const session = await queryOne<Session>(
    `INSERT INTO sessions (id, project_id, agent_id, started_at, status, metadata)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      sessionId,
      projectId,
      null,
      new Date().toISOString(),
      'active',
      metadata ? JSON.stringify(metadata) : null,
    ]
  );
  
  if (!session) {
    throw new Error('Failed to create session');
  }
  
  // 解析 metadata JSON
  return {
    ...session,
    metadata: session.metadata ? JSON.parse(session.metadata as string) : null,
  } as Session;
}

export async function getSessionById(sessionId: string): Promise<Session | null> {
  const session = await queryOne<Session>('SELECT * FROM sessions WHERE id = $1', [sessionId]);
  if (!session) return null;
  
  return {
    ...session,
    metadata: session.metadata ? JSON.parse(session.metadata as string) : null,
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
  
  // 解析 metadata JSON
  return sessions.map(s => ({
    ...s,
    metadata: s.metadata ? JSON.parse(s.metadata as string) : null,
  })) as Session[];
}

export async function endSession(sessionId: string): Promise<Session | null> {
  return queryOne<Session>(
    `UPDATE sessions 
     SET status = 'ended', ended_at = NOW() 
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
      metadata ? JSON.stringify(metadata) : null,
    ]
  );
  
  if (!message) {
    throw new Error('Failed to add message');
  }
  
  // 解析 metadata JSON
  return {
    ...message,
    metadata: message.metadata ? JSON.parse(message.metadata as string) : null,
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
  
  // 解析 metadata JSON
  return messages.map(m => ({
    ...m,
    metadata: m.metadata ? JSON.parse(m.metadata as string) : null,
  })) as Message[];
}
