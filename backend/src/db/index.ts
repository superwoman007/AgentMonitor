// 数据库抽象层 - 支持 SQLite 和 PostgreSQL 切换
import { config } from '../config.js';

export interface DbResult {
  rows: Record<string, unknown>[];
  rowCount: number;
}

export interface Database {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  queryOne<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null>;
  run(sql: string, params?: unknown[]): Promise<{ changes: number; lastInsertRowid?: number }>;
  close(): Promise<void>;
}

let db: Database | null = null;

export async function getDb(): Promise<Database> {
  if (db) return db;
  
  if (config.dbType === 'sqlite') {
    const { createSqliteDb } = await import('./sqlite.js');
    db = await createSqliteDb();
  } else {
    const { createPostgresDb } = await import('./postgres.js');
    db = await createPostgresDb();
  }
  
  return db;
}

// 便捷方法
export async function query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
  const database = await getDb();
  return database.query<T>(sql, params);
}

/**
 * 将待写入 JSON/JSONB 列的值序列化为当前数据库驱动可接受的形式。
 * SQLite 以 TEXT 存储，返回 JSON 字符串；PostgreSQL 的 JSONB 列需直接传 JS 值（驱动自动序列化）。
 * @param value 任意可 JSON 序列化的值
 * @returns SQLite 返回 JSON 字符串，PostgreSQL 返回值本身，空值统一返回 null
 */
export function toDbJson(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  return config.dbType === 'sqlite' ? JSON.stringify(value) : value;
}

/**
 * 将数据库读出的 JSON/JSONB 列归一化为 JS 值。
 * SQLite 返回 JSON 字符串需解析；PostgreSQL 的 JSONB 已由驱动解析为对象/数组。
 * @param value 数据库读出的原始值
 * @returns 解析后的 JS 值；无法解析时原样返回，空值返回 null
 */
export function fromDbJson(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

/**
 * 将数据库读出的布尔列归一化为 JS 布尔值。
 * SQLite 以整数 0/1 存储布尔；PostgreSQL 的 BOOLEAN 列由驱动返回 true/false。
 * @param value 数据库读出的原始值（number/boolean/string/null）
 * @returns 归一化后的布尔值；空值返回 null
 */
export function fromDbBool(value: unknown): boolean | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return value === 'true' || value === '1' || value === 't';
  return Boolean(value);
}

/**
 * 将写入布尔列的 JS 值转换为当前数据库驱动可接受的形式。
 * better-sqlite3 无法绑定 JS 布尔（仅接受 number/string/bigint/buffer/null），故 SQLite 转 0/1；
 * PostgreSQL 的 BOOLEAN 列需直接传 JS 布尔值（传整数会报 boolean = integer 类型错误）。
 * @param value 任意布尔语义值
 * @returns SQLite 返回 0/1/null，PostgreSQL 返回 true/false/null
 */
export function toDbBool(value: unknown): number | boolean | null {
  if (value === undefined || value === null) return null;
  const bool = typeof value === 'boolean' ? value : Boolean(value);
  return config.dbType === 'sqlite' ? (bool ? 1 : 0) : bool;
}

/**
 * 返回当前数据库 SQL 语句中可直接拼接的布尔真值字面量。
 * SQLite 以整数 1/0 表示布尔，PostgreSQL 使用 TRUE/FALSE；
 * 跨库写死 TRUE/FALSE 或 1/0 都可能在另一侧触发类型错误（如 boolean = integer）。
 */
export const SQL_TRUE = config.dbType === 'sqlite' ? '1' : 'TRUE';
export const SQL_FALSE = config.dbType === 'sqlite' ? '0' : 'FALSE';

export async function queryOne<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null> {
  const database = await getDb();
  return database.queryOne<T>(sql, params);
}

export async function run(sql: string, params?: unknown[]): Promise<{ changes: number; lastInsertRowid?: number }> {
  const database = await getDb();
  return database.run(sql, params);
}

export async function closeDb(): Promise<void> {
  if (db) {
    await db.close();
    db = null;
  }
}
