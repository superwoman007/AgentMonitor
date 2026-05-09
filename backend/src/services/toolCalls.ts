import { query, queryOne, run } from '../db/index.js';
import { v4 as uuidv4 } from 'uuid';

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
      id, session_id, message_id, tool_name, input, output, status, started_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      id,
      data.sessionId,
      data.messageId || null,
      data.toolName,
      data.input ? JSON.stringify(data.input) : null,
      data.output ? JSON.stringify(data.output) : null,
      data.status || 'pending',
      new Date().toISOString(),
    ]
  );
  
  const toolCall = await queryOne<ToolCall>('SELECT * FROM tool_calls WHERE id = $1', [id]);
  if (!toolCall) {
    throw new Error('Failed to create tool call');
  }
  
  return {
    ...toolCall,
    input: toolCall.input ? JSON.parse(toolCall.input as string) : null,
    output: toolCall.output ? JSON.parse(toolCall.output as string) : null,
  } as ToolCall;
}

export async function getToolCallsBySession(sessionId: string): Promise<ToolCall[]> {
  const toolCalls = await query<ToolCall>(
    'SELECT * FROM tool_calls WHERE session_id = $1 ORDER BY started_at ASC',
    [sessionId]
  );
  
  return toolCalls.map(tc => ({
    ...tc,
    input: tc.input ? JSON.parse(tc.input as string) : null,
    output: tc.output ? JSON.parse(tc.output as string) : null,
  })) as ToolCall[];
}

export async function getToolCallById(toolCallId: string): Promise<ToolCall | null> {
  const toolCall = await queryOne<ToolCall>('SELECT * FROM tool_calls WHERE id = $1', [toolCallId]);
  if (!toolCall) return null;
  
  return {
    ...toolCall,
    input: toolCall.input ? JSON.parse(toolCall.input as string) : null,
    output: toolCall.output ? JSON.parse(toolCall.output as string) : null,
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
    params.push(JSON.stringify(data.output));
    paramIndex++;
  }
  
  if (data.status !== undefined) {
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
