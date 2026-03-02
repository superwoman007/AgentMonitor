// PostgreSQL 实现
import pg from 'pg';
import { config } from '../config.js';
import { Database as DbInterface } from './index.js';

const { Pool } = pg;

let pool: pg.Pool | null = null;

function getPoolConfig(): pg.PoolConfig {
  if (config.database.url) {
    return {
      connectionString: config.database.url,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    };
  }
  
  return {
    host: config.database.host,
    port: config.database.port,
    user: config.database.user,
    password: config.database.password,
    database: config.database.database,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  };
}

export async function createPostgresDb(): Promise<DbInterface> {
  if (!pool) {
    pool = new Pool(getPoolConfig());
  }
  
  return {
    async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
      const result = await pool!.query(sql, params);
      return result.rows as T[];
    },
    
    async queryOne<T>(sql: string, params?: unknown[]): Promise<T | null> {
      const result = await pool!.query(sql, params);
      return (result.rows[0] as T) || null;
    },
    
    async run(sql: string, params?: unknown[]): Promise<{ changes: number; lastInsertRowid?: number }> {
      const result = await pool!.query(sql, params);
      return { changes: result.rowCount || 0 };
    },
    
    async close(): Promise<void> {
      if (pool) {
        await pool.end();
        pool = null;
      }
    },
  };
}
