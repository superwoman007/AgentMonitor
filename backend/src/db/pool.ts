import pg, { QueryResultRow } from 'pg';
import { config } from '../config.js';

const { Pool } = pg;

// 连接池参数统一来自 config（可由 DB_POOL_MAX / DB_POOL_IDLE_TIMEOUT 环境变量覆盖），
// 避免此前写死 max=20 导致环境变量不生效。
function getPoolConfig(): pg.PoolConfig {
  const poolConfig = {
    max: config.database.poolMax,
    idleTimeoutMillis: config.database.poolIdleTimeout,
    connectionTimeoutMillis: 5000,
  };
  if (config.database.url) {
    return {
      connectionString: config.database.url,
      ...poolConfig,
    };
  }

  return {
    host: config.database.host,
    port: config.database.port,
    user: config.database.user,
    password: config.database.password,
    database: config.database.database,
    ...poolConfig,
  };
}

export const pool = new Pool(getPoolConfig());

export async function query<T extends QueryResultRow = QueryResultRow>(
  sql: string, 
  params?: unknown[]
): Promise<T[]> {
  const result = await pool.query<T>(sql, params);
  return result.rows;
}

export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  sql: string, 
  params?: unknown[]
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] || null;
}

export async function transaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}
