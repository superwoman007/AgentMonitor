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
