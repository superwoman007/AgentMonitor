// PostgreSQL 迁移
import pg from 'pg';
import { config } from '../config.js';
import { applyPostgresMigrations } from './migration-registry.js';

const { Pool } = pg;

/**
 * 执行 PostgreSQL 显式迁移
 * @returns 无返回值
 */
export async function runPostgresMigrations(): Promise<void> {
  const pool = new Pool({
    connectionString: config.database.url,
    host: config.database.host,
    port: config.database.port,
    user: config.database.user,
    password: config.database.password,
    database: config.database.database,
  });

  try {
    await applyPostgresMigrations({
      async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }> {
        const result = await pool.query<T & pg.QueryResultRow>(sql, params as never[]);
        return { rows: result.rows as T[] };
      },
    });
    console.log('✅ PostgreSQL migrations completed');
  } catch (error) {
    console.error('Migration error:', error);
    throw error;
  } finally {
    await pool.end();
  }
}
