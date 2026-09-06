import { query, queryOne, run, toDbJson, fromDbJson } from '../db/index.js';
import { config } from '../config.js';
import { v4 as uuidv4 } from 'uuid';

// PG schema 工具调用输入列名为 input_params（SQLite 历史表为 input）
const INPUT_COL = config.dbType === 'postgres' ? 'input_params' : 'input';

export interface ToolCall {
  id: string;
  session_id: string;
  message_id: string | null;
  tool_name: string;
  input: unknown | null;
  output: unknown | null;
  status: string;
  started_at: Date;
  ended_at: Date | null;
  created_at: Date;
}

export interface ToolCallInput {
  sessionId: string;
  messageId?: string;
  toolName: string;
  input?: unknown;
  output?: unknown;
  status?: string;
}

export async function createToolCall(data: ToolCallInput): Promise<ToolCall> {
  const id = uuidv4();

  await run(
    `INSERT INTO tool_calls (
      id, session_id, message_id, tool_name, ${INPUT_COL}, output${config.dbType === 'sqlite' ? ', status' : ''}, started_at
    ) VALUES ($1, $2, $3, $4, $5, $6${config.dbType === 'sqlite' ? ', $7' : ''}, $${config.dbType === 'sqlite' ? '8' : '7'})`,
    config.dbType === 'sqlite'
      ? [
          id,
          data.sessionId,
          data.messageId || null,
          data.toolName,
          toDbJson(data.input ?? null),
          toDbJson(data.output ?? null),
          data.status || 'pending',
          new Date().toISOString(),
        ]
      : [
          id,
          data.sessionId,
          data.messageId || null,
          data.toolName,
          toDbJson(data.input ?? null),
          toDbJson(data.output ?? null),
          new Date().toISOString(),
        ]
  );

  const toolCall = await queryOne<ToolCall>(`SELECT *${config.dbType === 'postgres' ? `, ${INPUT_COL} AS input` : ''} FROM tool_calls WHERE id = $1`, [id]);
  if (!toolCall) {
    throw new Error('Failed to create tool call');
  }

  const created = toolCall as unknown as Record<string, unknown>;
  return {
    ...toolCall,
    input: fromDbJson(created.input),
    output: fromDbJson(toolCall.output),
  } as ToolCall;
}

export async function getToolCallsBySession(sessionId: string): Promise<ToolCall[]> {
  const toolCalls = await query<ToolCall>(
    `SELECT *${config.dbType === 'postgres' ? `, ${INPUT_COL} AS input` : ''} FROM tool_calls WHERE session_id = $1 ORDER BY started_at ASC`,
    [sessionId]
  );

  return toolCalls.map(tc => {
    const row = tc as unknown as Record<string, unknown>;
    return {
      ...tc,
      input: fromDbJson(row.input),
      output: fromDbJson(tc.output),
      status: (row.status as string | undefined) ?? 'completed',
    };
  }) as ToolCall[];
}

export async function getToolCallById(toolCallId: string): Promise<ToolCall | null> {
  const toolCall = await queryOne<ToolCall>(`SELECT *${config.dbType === 'postgres' ? `, ${INPUT_COL} AS input` : ''} FROM tool_calls WHERE id = $1`, [toolCallId]);
  if (!toolCall) return null;

  const row = toolCall as unknown as Record<string, unknown>;
  return {
    ...toolCall,
    input: fromDbJson(row.input),
    output: fromDbJson(toolCall.output),
  } as ToolCall;
}

export async function updateToolCall(
  toolCallId: string,
  data: {
    output?: unknown;
    status?: string;
    endedAt?: string;
  }
): Promise<ToolCall | null> {
  const updates: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;
  
  if (data.output !== undefined) {
    updates.push(`output = $${paramIndex}`);
    params.push(toDbJson(data.output));
    paramIndex++;
  }
  
  if (data.status !== undefined && config.dbType === 'sqlite') {
    updates.push(`status = $${paramIndex}`);
    params.push(data.status);
    paramIndex++;
  }
  
  if (data.endedAt !== undefined) {
    updates.push(`ended_at = $${paramIndex}`);
    params.push(data.endedAt);
    paramIndex++;
  }
  
  if (updates.length === 0) {
    return getToolCallById(toolCallId);
  }
  
  params.push(toolCallId);
  
  await run(
    `UPDATE tool_calls SET ${updates.join(', ')} WHERE id = $${paramIndex}`,
    params
  );
  
  return getToolCallById(toolCallId);
}
