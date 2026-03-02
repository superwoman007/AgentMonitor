import { query, queryOne } from '../db/index.js';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config.js';

export interface Project {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  created_at: Date;
  updated_at: Date;
}

export async function createProject(
  userId: string,
  name: string,
  description?: string
): Promise<Project> {
  const projectId = uuidv4();
  
  const project = await queryOne<Project>(
    `INSERT INTO projects (id, user_id, name, description)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [projectId, userId, name, description || null]
  );
  
  if (!project) {
    throw new Error('Failed to create project');
  }
  
  return project;
}

export async function getProjectById(projectId: string): Promise<Project | null> {
  return queryOne<Project>('SELECT * FROM projects WHERE id = $1', [projectId]);
}

export async function getProjectsByUser(
  userId: string,
  options?: {
    limit?: number;
    offset?: number;
  }
): Promise<Project[]> {
  const limit = options?.limit || 50;
  const offset = options?.offset || 0;
  
  return query<Project>(
    `SELECT * FROM projects 
     WHERE user_id = $1 
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );
}

export async function updateProject(
  projectId: string,
  userId: string,
  data: {
    name?: string;
    description?: string;
  }
): Promise<Project | null> {
  const updates: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;
  
  if (data.name !== undefined) {
    updates.push(`name = $${paramIndex}`);
    params.push(data.name);
    paramIndex++;
  }
  
  if (data.description !== undefined) {
    updates.push(`description = $${paramIndex}`);
    params.push(data.description);
    paramIndex++;
  }
  
  if (updates.length === 0) {
    return getProjectById(projectId);
  }
  
  const nowExpr = config.dbType === 'sqlite' ? "datetime('now')" : 'NOW()';
  updates.push(`updated_at = ${nowExpr}`);
  params.push(projectId, userId);
  
  return queryOne<Project>(
    `UPDATE projects 
     SET ${updates.join(', ')} 
     WHERE id = $${paramIndex} AND user_id = $${paramIndex + 1}
     RETURNING *`,
    params
  );
}

export async function deleteProject(projectId: string, userId: string): Promise<boolean> {
  const result = await queryOne<{ id: string }>(
    'DELETE FROM projects WHERE id = $1 AND user_id = $2 RETURNING id',
    [projectId, userId]
  );
  
  return result !== null;
}

export async function getProjectByApiKey(keyHash: string): Promise<Project | null> {
  return queryOne<Project>(
    `SELECT p.* FROM projects p
     JOIN api_keys ak ON p.id = ak.project_id
     WHERE ak.key_hash = $1 AND ak.revoked_at IS NULL`,
    [keyHash]
  );
}
