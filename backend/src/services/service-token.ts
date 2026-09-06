import { randomBytes, createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { query, queryOne, run } from '../db/index.js';

/**
 * Service Token 支持的 scope 集合。
 * 与技术方案 §15.1 对齐：
 * - telemetry:write：SDK 上报 Trace/Span
 * - prompts:read：读取 Prompt 与部署版本
 * - datasets:read：读取数据集与版本
 * - targets:read / targets:invoke：读取 Target / 调用 Target
 * - evaluation:run：创建/启动 Run、claim 样本、上传结果
 * - evaluation:read：读取 Run/报告
 * - evaluation:result:write：上传 Target 结果
 */
export const SERVICE_TOKEN_SCOPES = [
  'telemetry:write',
  'prompts:read',
  'datasets:read',
  'targets:read',
  'targets:invoke',
  'evaluation:run',
  'evaluation:read',
  'evaluation:result:write',
] as const;

export type ServiceTokenScope = (typeof SERVICE_TOKEN_SCOPES)[number];

/**
 * Service Token 实体（不含明文 token）。
 */
export interface ServiceToken {
  id: string;
  project_id: string;
  name: string;
  token_hash: string;
  token_prefix: string;
  scopes: ServiceTokenScope[];
  expires_at: Date | null;
  last_used_at: Date | null;
  revoked_at: Date | null;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * 创建 Service Token 时的返回（含一次明文）。
 */
export interface ServiceTokenWithPlain extends ServiceToken {
  /** 明文 token，仅在创建时返回一次 */
  plain_token: string;
}

const TOKEN_PREFIX = 'amt_';

/**
 * 生成随机 Service Token 明文。
 * 格式：amt_<32 chars base62>
 * @returns 明文 token
 */
export function generateServiceToken(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = randomBytes(32);
  let out = TOKEN_PREFIX;
  for (let i = 0; i < 32; i += 1) {
    out += chars[bytes[i] % chars.length];
  }
  return out;
}

/**
 * 计算 token 的 SHA-256 hash。
 * @param token - 明文 token
 * @returns 十六进制 hash
 */
export function hashServiceToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * 规范化并校验 scope 列表。
 * @param scopes - 待校验的 scope
 * @returns 合法的 scope 数组
 */
function normalizeScopes(scopes: string[] | undefined): ServiceTokenScope[] {
  if (!scopes || scopes.length === 0) {
    return ['evaluation:read'];
  }
  const valid = new Set<string>(SERVICE_TOKEN_SCOPES);
  const result: ServiceTokenScope[] = [];
  for (const s of scopes) {
    if (valid.has(s) && !result.includes(s as ServiceTokenScope)) {
      result.push(s as ServiceTokenScope);
    }
  }
  return result;
}

function mapToken(row: Record<string, unknown>): ServiceToken {
  const parseScopes = (raw: unknown): ServiceTokenScope[] => {
    if (Array.isArray(raw)) return raw as ServiceTokenScope[];
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? (parsed as ServiceTokenScope[]) : [];
      } catch {
        return [];
      }
    }
    return [];
  };
  return {
    id: row.id as string,
    project_id: row.project_id as string,
    name: row.name as string,
    token_hash: row.token_hash as string,
    token_prefix: row.token_prefix as string,
    scopes: parseScopes(row.scopes),
    expires_at: row.expires_at ? new Date(row.expires_at as string) : null,
    last_used_at: row.last_used_at ? new Date(row.last_used_at as string) : null,
    revoked_at: row.revoked_at ? new Date(row.revoked_at as string) : null,
    created_by: (row.created_by as string | null) ?? null,
    created_at: new Date(row.created_at as string),
    updated_at: new Date(row.updated_at as string),
  };
}

/**
 * 创建 Service Token。
 * @param projectId - 项目 ID
 * @param name - Token 名称（便于在 UI/CLI 中识别）
 * @param options - scopes、过期时间、创建人
 * @returns 含一次明文的 Token
 */
export async function createServiceToken(
  projectId: string,
  name: string,
  options: {
    scopes?: string[];
    expiresAt?: Date | null;
    createdBy?: string | null;
  } = {}
): Promise<ServiceTokenWithPlain> {
  const plain = generateServiceToken();
  const hash = hashServiceToken(plain);
  const prefix = plain.slice(0, 10) + '...';
  const scopes = normalizeScopes(options.scopes);
  const id = uuidv4();

  await run(
    `INSERT INTO service_tokens
       (id, project_id, name, token_hash, token_prefix, scopes, expires_at, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      id,
      projectId,
      name,
      hash,
      prefix,
      JSON.stringify(scopes),
      options.expiresAt ? options.expiresAt.toISOString() : null,
      options.createdBy ?? null,
    ]
  );

  const row = await queryOne<Record<string, unknown>>('SELECT * FROM service_tokens WHERE id = $1', [id]);
  if (!row) throw new Error('Failed to reload service token after insert');
  return { ...mapToken(row), plain_token: plain };
}

/**
 * 列出项目下的 Service Token（不含 hash 与明文）。
 * @param projectId - 项目 ID
 * @returns Token 列表
 */
export async function listServiceTokens(projectId: string): Promise<ServiceToken[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT id, project_id, name, token_prefix, scopes, expires_at, last_used_at,
            revoked_at, created_by, created_at, updated_at, token_hash
       FROM service_tokens
      WHERE project_id = $1
      ORDER BY created_at DESC`,
    [projectId]
  );
  return rows.map(mapToken);
}

/**
 * 按 ID 读取 Service Token。
 * @param tokenId - Token ID
 * @returns Token 或 null
 */
export async function getServiceTokenById(tokenId: string): Promise<ServiceToken | null> {
  const row = await queryOne<Record<string, unknown>>('SELECT * FROM service_tokens WHERE id = $1', [tokenId]);
  return row ? mapToken(row) : null;
}

/**
 * 撤销（revoke）一个 Service Token。
 * @param tokenId - Token ID
 * @returns 是否成功撤销（已经撤销过返回 false）
 */
export async function revokeServiceToken(tokenId: string): Promise<boolean> {
  const result = await run(
    `UPDATE service_tokens
        SET revoked_at = datetime('now'), updated_at = datetime('now')
      WHERE id = $1 AND revoked_at IS NULL`,
    [tokenId]
  );
  return result.changes > 0;
}

/**
 * 校验明文 Service Token：未撤销、未过期则返回 Token 实体，并更新 last_used_at。
 * @param plainToken - 明文 token
 * @returns 校验结果：valid、token、projectId
 */
export async function verifyServiceToken(plainToken: string): Promise<{
  valid: boolean;
  token?: ServiceToken;
  projectId?: string;
  expired?: boolean;
}> {
  if (!plainToken.startsWith(TOKEN_PREFIX)) return { valid: false };
  const hash = hashServiceToken(plainToken);
  const row = await queryOne<Record<string, unknown>>(
    'SELECT * FROM service_tokens WHERE token_hash = $1',
    [hash]
  );
  if (!row) return { valid: false };
  const token = mapToken(row);
  if (token.revoked_at) return { valid: false };
  if (token.expires_at && token.expires_at.getTime() < Date.now()) {
    return { valid: false, expired: true };
  }
  await run(
    `UPDATE service_tokens SET last_used_at = datetime('now'), updated_at = datetime('now') WHERE id = $1`,
    [token.id]
  );
  return { valid: true, token, projectId: token.project_id };
}

/**
 * 判断 Token 是否拥有指定 scope。
 * @param token - Service Token
 * @param scope - 需要的 scope
 * @returns 是否拥有
 */
export function tokenHasScope(token: ServiceToken, scope: ServiceTokenScope): boolean {
  return token.scopes.includes(scope);
}
