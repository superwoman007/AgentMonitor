import { toDbBool, query, queryOne } from '../db/index.js';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config.js';

export interface Breakpoint {
  id: string;
  project_id: string;
  name: string;
  type: 'keyword' | 'error' | 'latency' | 'custom';
  condition: string;
  enabled: boolean;
  hit_threshold: number;
  hit_count: number;
  created_at: Date;
  updated_at: Date;
}

export interface BreakpointCreateData {
  projectId: string;
  name: string;
  type: 'keyword' | 'error' | 'latency' | 'custom';
  condition: string;
  enabled?: boolean;
  hit_threshold?: number;
}

export interface BreakpointUpdateData {
  name?: string;
  type?: 'keyword' | 'error' | 'latency' | 'custom';
  condition?: string;
  enabled?: boolean;
  hit_threshold?: number;
  hit_count?: number;
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
  
  const hitThreshold = data.hit_threshold ?? 0;
  const breakpoint = await queryOne<Breakpoint>(
    `INSERT INTO breakpoints (id, project_id, name, type, condition, enabled, hit_threshold, hit_count)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [id, data.projectId, data.name, data.type, data.condition, toDbBool(data.enabled !== false), hitThreshold, 0]
  );
  
  if (!breakpoint) {
    throw new Error('Failed to create breakpoint');
  }
  
  return breakpoint;
}

export async function getBreakpointById(id: string): Promise<Breakpoint | null> {
  const row = await queryOne<Breakpoint>('SELECT * FROM breakpoints WHERE id = $1', [id]);
  return row ? normalizeBreakpoint(row) : null;
}

function normalizeBreakpoint(bp: Breakpoint): Breakpoint {
  if (bp.enabled !== undefined) bp.enabled = !!bp.enabled;
  if (bp.hit_threshold !== undefined) bp.hit_threshold = Number(bp.hit_threshold) || 0;
  if (bp.hit_count !== undefined) bp.hit_count = Number(bp.hit_count) || 0;
  return bp;
}

export async function getBreakpointsByProject(projectId: string): Promise<Breakpoint[]> {
  const rows = await query<Breakpoint>(
    'SELECT * FROM breakpoints WHERE project_id = $1 ORDER BY created_at DESC',
    [projectId]
  );
  return rows.map(normalizeBreakpoint);
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
    values.push(toDbBool(data.enabled));
    paramIndex++;
  }

  if (data.hit_threshold !== undefined) {
    fields.push(`hit_threshold = $${paramIndex}`);
    values.push(data.hit_threshold);
    paramIndex++;
  }

  if (data.hit_count !== undefined) {
    fields.push(`hit_count = $${paramIndex}`);
    values.push(data.hit_count);
    paramIndex++;
  }
  
  if (fields.length === 0) {
    return getBreakpointById(id);
  }
  
  const nowExpr = config.dbType === 'sqlite' ? "datetime('now')" : 'NOW()';
  fields.push(`updated_at = ${nowExpr}`);
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
    `UPDATE breakpoints SET enabled = NOT enabled, updated_at = ${config.dbType === 'sqlite' ? "datetime('now')" : 'NOW()'} WHERE id = $1 RETURNING *`,
    [id]
  );
}

export async function checkBreakpoints(projectId: string, context: CheckContext): Promise<Breakpoint[]> {
  const breakpoints = await getBreakpointsByProject(projectId);
  const enabledBreakpoints = breakpoints.filter(bp => bp.enabled);
  const triggered: Breakpoint[] = [];
  
  for (const bp of enabledBreakpoints) {
    let conditionMatched = false;
    
    switch (bp.type) {
      case 'keyword':
        if (context.content) {
          const keywords = bp.condition.split(',').map(k => k.trim().toLowerCase());
          conditionMatched = keywords.some(kw => context.content!.toLowerCase().includes(kw));
        }
        break;
        
      case 'error':
        if (context.error) {
          try {
            const pattern = new RegExp(bp.condition, 'i');
            conditionMatched = pattern.test(context.error);
          } catch {
            conditionMatched = context.error.toLowerCase().includes(bp.condition.toLowerCase());
          }
        }
        break;
        
      case 'latency':
        if (context.latencyMs !== undefined) {
          const threshold = parseInt(bp.condition, 10);
          if (!isNaN(threshold)) {
            conditionMatched = context.latencyMs > threshold;
          }
        }
        break;
        
      case 'custom':
        try {
          const evalFunc = new Function('context', `return ${bp.condition}`);
          conditionMatched = evalFunc(context);
        } catch (e) {
          console.error('Failed to evaluate custom breakpoint condition:', e);
        }
        break;
    }
    
    if (conditionMatched) {
      const newHitCount = bp.hit_count + 1;
      // Check hit_threshold: if > 0, need N hits to trigger; if 0, trigger immediately
      const shouldTrigger = bp.hit_threshold <= 0 || newHitCount >= bp.hit_threshold;
      
      if (shouldTrigger) {
        triggered.push(bp);
        // Reset hit_count after trigger
        await updateBreakpoint(bp.id, { hit_count: 0 });
      } else {
        // Increment hit_count
        await updateBreakpoint(bp.id, { hit_count: newHitCount });
      }
    }
  }
  
  return triggered;
}
