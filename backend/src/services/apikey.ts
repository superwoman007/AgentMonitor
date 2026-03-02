import { query, queryOne, run } from '../db/index.js';
import { config } from '../config.js';
import { v4 as uuidv4 } from 'uuid';
import { encrypt, decrypt, hashApiKey, generateApiKey } from '../utils/crypto.js';

export interface ApiKey {
  id: string;
  project_id: string;
  name: string;
  key_hash: string;
  prefix: string;
  encrypted_key: string | null;  // 加密存储的完整 Key
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface ApiKeyWithPlain extends ApiKey {
  plain_key?: string;
}

export async function createApiKey(
  projectId: string,
  name: string
): Promise<ApiKeyWithPlain> {
  const plainKey = generateApiKey();
  const keyHash = hashApiKey(plainKey);
  const encryptedKey = encrypt(plainKey);
  const prefix = plainKey.slice(0, 10) + '...';
  const keyId = uuidv4();
  
  await run(
    `INSERT INTO api_keys (id, project_id, name, key_hash, prefix, encrypted_key)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [keyId, projectId, name, keyHash, prefix, encryptedKey]
  );
  
  const apiKey = await queryOne<ApiKey>(
    'SELECT * FROM api_keys WHERE id = $1',
    [keyId]
  );
  
  if (!apiKey) {
    throw new Error('Failed to create API key');
  }
  
  return {
    ...apiKey,
    key: plainKey,  // 测试期望 key 字段
  } as any;
}

export async function getApiKeysByProject(projectId: string): Promise<ApiKey[]> {
  const keys = await query<ApiKey>(
    `SELECT id, project_id, name, prefix as key_prefix, last_used_at, revoked_at, created_at, encrypted_key
     FROM api_keys
     WHERE project_id = $1
     ORDER BY created_at DESC`,
    [projectId]
  );
  
  // ���加 is_active 字段
  return keys.map(key => ({
    ...key,
    is_active: !key.revoked_at
  })) as any;
}

export async function getApiKeyById(keyId: string): Promise<ApiKey | null> {
  return queryOne<ApiKey>(
    'SELECT * FROM api_keys WHERE id = $1',
    [keyId]
  );
}

/**
 * 解密并返回完整的 API Key
 */
export async function getDecryptedApiKey(keyId: string, userId: string): Promise<string | null> {
  const apiKey = await queryOne<ApiKey>(
    `SELECT ak.encrypted_key 
     FROM api_keys ak
     JOIN projects p ON ak.project_id = p.id
     WHERE ak.id = $1 AND p.user_id = $2 AND ak.revoked_at IS NULL`,
    [keyId, userId]
  );
  
  if (!apiKey?.encrypted_key) {
    return null;
  }
  
  try {
    return decrypt(apiKey.encrypted_key);
  } catch {
    return null;
  }
}

export async function revokeApiKey(keyId: string, userId: string): Promise<{ success: boolean; alreadyRevoked?: boolean }> {
  // 先检查 Key 是否存在且属于该用户
  const apiKey = await queryOne<ApiKey>(
    `SELECT ak.id, ak.revoked_at
     FROM api_keys ak
     JOIN projects p ON ak.project_id = p.id
     WHERE ak.id = $1 AND p.user_id = $2`,
    [keyId, userId]
  );
  
  if (!apiKey) {
    return { success: false };
  }
  
  if (apiKey.revoked_at) {
    return { success: false, alreadyRevoked: true };
  }
  
  const nowExpr = config.dbType === 'sqlite' ? "datetime('now')" : 'NOW()';
  
  await run(
    `UPDATE api_keys SET revoked_at = ${nowExpr} WHERE id = $1`,
    [keyId]
  );
  
  return { success: true };
}

export async function verifyApiKey(plainKey: string): Promise<{ valid: boolean; projectId?: string }> {
  if (!plainKey.startsWith('am_')) {
    return { valid: false };
  }
  
  const keyHash = hashApiKey(plainKey);
  
  const apiKey = await queryOne<ApiKey>(
    `SELECT ak.*, p.id as project_id
     FROM api_keys ak
     JOIN projects p ON ak.project_id = p.id
     WHERE ak.key_hash = $1 AND ak.revoked_at IS NULL`,
    [keyHash]
  );
  
  if (!apiKey) {
    return { valid: false };
  }
  
  const nowExpr = config.dbType === 'sqlite' ? "datetime('now')" : 'NOW()';
  await run(
    `UPDATE api_keys SET last_used_at = ${nowExpr} WHERE id = $1`,
    [apiKey.id]
  );
  
  return { valid: true, projectId: apiKey.project_id };
}

export async function getProjectIdByKeyHash(keyHash: string): Promise<string | null> {
  const apiKey = await queryOne<ApiKey>(
    'SELECT project_id FROM api_keys WHERE key_hash = $1 AND revoked_at IS NULL',
    [keyHash]
  );
  
  return apiKey?.project_id || null;
}
