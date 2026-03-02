// SQLite 实现
import Database from 'better-sqlite3';
import { config } from '../config.js';
import { Database as DbInterface } from './index.js';
import { mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';

let sqliteDb: Database.Database | null = null;

function convertParams(sql: string, params?: unknown[]): { sql: string; params: unknown[] } {
  // 将 PostgreSQL 风格的 $1, $2 转换为 SQLite 的 ?
  if (!params || params.length === 0) return { sql, params: [] };
  
  let idx = 0;
  const convertedSql = sql.replace(/\$(\d+)/g, () => {
    idx++;
    return '?';
  });
  
  return { sql: convertedSql, params };
}

export async function createSqliteDb(): Promise<DbInterface> {
  if (!sqliteDb) {
    const dbPath = config.database.sqlitePath;
    const dir = dirname(dbPath);
    
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    
    sqliteDb = new Database(dbPath);
    sqliteDb.pragma('journal_mode = WAL');
    
    // 初始化表结构
    await initSchema(sqliteDb);
  }
  
  return {
    async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
      const { sql: convertedSql, params: convertedParams } = convertParams(sql, params);
      try {
        const stmt = sqliteDb!.prepare(convertedSql);
        return stmt.all(...convertedParams) as T[];
      } catch (error) {
        console.error('SQLite query error:', error, { sql: convertedSql, params: convertedParams });
        throw error;
      }
    },
    
    async queryOne<T>(sql: string, params?: unknown[]): Promise<T | null> {
      const { sql: convertedSql, params: convertedParams } = convertParams(sql, params);
      try {
        const stmt = sqliteDb!.prepare(convertedSql);
        return (stmt.get(...convertedParams) as T) || null;
      } catch (error) {
        console.error('SQLite queryOne error:', error, { sql: convertedSql, params: convertedParams });
        throw error;
      }
    },
    
    async run(sql: string, params?: unknown[]): Promise<{ changes: number; lastInsertRowid?: number }> {
      const { sql: convertedSql, params: convertedParams } = convertParams(sql, params);
      try {
        const stmt = sqliteDb!.prepare(convertedSql);
        const result = stmt.run(...convertedParams);
        return { changes: result.changes, lastInsertRowid: Number(result.lastInsertRowid) };
      } catch (error) {
        console.error('SQLite run error:', error, { sql: convertedSql, params: convertedParams });
        throw error;
      }
    },
    
    async close(): Promise<void> {
      if (sqliteDb) {
        sqliteDb.close();
        sqliteDb = null;
      }
    },
  };
}

async function initSchema(db: Database.Database): Promise<void> {
  // SQLite 版本的 schema（与 PostgreSQL 兼容）
  db.exec(`
    -- 用户表
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- 项目表
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- API Keys 表
    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      key_hash TEXT NOT NULL,
      prefix TEXT NOT NULL,
      last_used_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- 会话表
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      agent_id TEXT,
      user_id TEXT,
      status TEXT DEFAULT 'active',
      metadata TEXT,
      started_at TEXT DEFAULT (datetime('now')),
      ended_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- 消息表
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata TEXT,
      timestamp TEXT DEFAULT (datetime('now')),
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- 工具调用表
    CREATE TABLE IF NOT EXISTS tool_calls (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
      tool_name TEXT NOT NULL,
      input TEXT,
      output TEXT,
      status TEXT DEFAULT 'pending',
      started_at TEXT DEFAULT (datetime('now')),
      ended_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Traces 表
    CREATE TABLE IF NOT EXISTS traces (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
      agent_id TEXT,
      trace_type TEXT NOT NULL,
      name TEXT NOT NULL,
      input TEXT,
      output TEXT,
      metadata TEXT,
      started_at TEXT DEFAULT (datetime('now')),
      ended_at TEXT,
      latency_ms INTEGER,
      status TEXT DEFAULT 'pending',
      error TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- 断点表
    CREATE TABLE IF NOT EXISTS breakpoints (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      condition TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- 快照表
    CREATE TABLE IF NOT EXISTS snapshots (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      breakpoint_id TEXT REFERENCES breakpoints(id) ON DELETE SET NULL,
      trigger_reason TEXT NOT NULL,
      state TEXT NOT NULL,
      timestamp TEXT DEFAULT (datetime('now')),
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- 告警表
    CREATE TABLE IF NOT EXISTS alerts (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      condition TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      last_triggered_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- 创建索引
    CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);
    CREATE INDEX IF NOT EXISTS idx_api_keys_project_id ON api_keys(project_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_project_id ON sessions(project_id);
    CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);
    CREATE INDEX IF NOT EXISTS idx_tool_calls_session_id ON tool_calls(session_id);
    CREATE INDEX IF NOT EXISTS idx_traces_project_id ON traces(project_id);
    CREATE INDEX IF NOT EXISTS idx_traces_session_id ON traces(session_id);
    CREATE INDEX IF NOT EXISTS idx_breakpoints_project_id ON breakpoints(project_id);
    CREATE INDEX IF NOT EXISTS idx_snapshots_session_id ON snapshots(session_id);
    CREATE INDEX IF NOT EXISTS idx_alerts_project_id ON alerts(project_id);
  `);
  
  console.log('✅ SQLite schema initialized');
}
