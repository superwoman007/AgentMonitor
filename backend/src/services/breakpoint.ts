import { query, queryOne } from '../db/index.js';
import { v4 as uuidv4 } from 'uuid';

export interface Breakpoint {
  id: string;
  project_id: string;
  name: string;
  type: 'keyword' | 'error' | 'latency' | 'custom';
  condition: string;
  enabled: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface BreakpointCreateData {
  projectId: string;
  name: string;
  type: 'keyword' | 'error' | 'latency' | 'custom';
  condition: string;
  enabled?: boolean;
}

export interface BreakpointUpdateData {
  name?: string;
  type?: 'keyword' | 'error' | 'latency' | 'custom';
  condition?: string;
  enabled?: boolean;
}

export interface CheckContext {
  content?: string;
  error?: string;
  latencyMs?: number;
  toolName?: string;
  metadata?: Record<string, unknown>;
}

export async function createBreakpoint(data: BreakpointCreateData): Promise<Breakpoint> {
  const id = uuidv4();
  
  const breakpoint = await queryOne<Breakpoint>(
    `INSERT INTO breakpoints (id, project_id, name, type, condition, enabled)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [id, data.projectId, data.name, data.type, data.condition, data.enabled !== false ? 1 : 0]
  );
  
  if (!breakpoint) {
    throw new Error('Failed to create breakpoint');
  }
  
  return breakpoint;
}

export async function getBreakpointById(id: string): Promise<Breakpoint | null> {
  return queryOne<Breakpoint>('SELECT * FROM breakpoints WHERE id = $1', [id]);
}

export async function getBreakpointsByProject(projectId: string): Promise<Breakpoint[]> {
  return query<Breakpoint>(
    'SELECT * FROM breakpoints WHERE project_id = $1 ORDER BY created_at DESC',
    [projectId]
  );
}

export async function updateBreakpoint(id: string, data: BreakpointUpdateData): Promise<Breakpoint | null> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;
  
  if (data.name !== undefined) {
    fields.push(`name = $${paramIndex}`);
    values.push(data.name);
    paramIndex++;
  }
  
  if (data.type !== undefined) {
    fields.push(`type = $${paramIndex}`);
    values.push(data.type);
    paramIndex++;
  }
  
  if (data.condition !== undefined) {
    fields.push(`condition = $${paramIndex}`);
    values.push(data.condition);
    paramIndex++;
  }
  
  if (data.enabled !== undefined) {
    fields.push(`enabled = $${paramIndex}`);
    values.push(data.enabled);
    paramIndex++;
  }
  
  if (fields.length === 0) {
    return getBreakpointById(id);
  }
  
  fields.push(`updated_at = NOW()`);
  values.push(id);
  
  return queryOne<Breakpoint>(
    `UPDATE breakpoints SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    values
  );
}

export async function deleteBreakpoint(id: string): Promise<boolean> {
  const result = await queryOne<Breakpoint>(
    'DELETE FROM breakpoints WHERE id = $1 RETURNING *',
    [id]
  );
  
  return result !== null;
}

export async function toggleBreakpoint(id: string): Promise<Breakpoint | null> {
  return queryOne<Breakpoint>(
    `UPDATE breakpoints SET enabled = NOT enabled, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [id]
  );
}

export async function checkBreakpoints(projectId: string, context: CheckContext): Promise<Breakpoint[]> {
  const breakpoints = await getBreakpointsByProject(projectId);
  const enabledBreakpoints = breakpoints.filter(bp => bp.enabled);
  const triggered: Breakpoint[] = [];
  
  for (const bp of enabledBreakpoints) {
    let isTriggered = false;
    
    switch (bp.type) {
      case 'keyword':
        if (context.content) {
          const keywords = bp.condition.split(',').map(k => k.trim().toLowerCase());
          isTriggered = keywords.some(kw => context.content!.toLowerCase().includes(kw));
        }
        break;
        
      case 'error':
        if (context.error) {
          try {
            const pattern = new RegExp(bp.condition, 'i');
            isTriggered = pattern.test(context.error);
          } catch {
            isTriggered = context.error.toLowerCase().includes(bp.condition.toLowerCase());
          }
        }
        break;
        
      case 'latency':
        if (context.latencyMs !== undefined) {
          const threshold = parseInt(bp.condition, 10);
          if (!isNaN(threshold)) {
            isTriggered = context.latencyMs > threshold;
          }
        }
        break;
        
      case 'custom':
        try {
          const evalFunc = new Function('context', `return ${bp.condition}`);
          isTriggered = evalFunc(context);
        } catch (e) {
          console.error('Failed to evaluate custom breakpoint condition:', e);
        }
        break;
    }
    
    if (isTriggered) {
      triggered.push(bp);
    }
  }
  
  return triggered;
}
