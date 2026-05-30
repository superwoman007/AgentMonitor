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

function columnExists(db: Database.Database, table: string, column: string): boolean {
  const cols = db.pragma(`table_info(${table})`) as Array<{ name: string }>;
  return cols.some(c => c.name === column);
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
      trace_id TEXT,
      span_id TEXT,
      parent_span_id TEXT,
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
      hit_threshold INTEGER DEFAULT 0,
      hit_count INTEGER DEFAULT 0,
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

    -- 决策表
    CREATE TABLE IF NOT EXISTS decisions (
      id TEXT PRIMARY KEY DEFAULT ('decision_' || lower(hex(randomblob(16)))),
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
      decision_type TEXT NOT NULL,
      context TEXT,
      selected_option TEXT NOT NULL,
      confidence REAL,
      reasoning TEXT,
      decision_maker TEXT,
      latency_ms REAL,
      created_at TEXT DEFAULT (datetime('now')),
      metadata TEXT
    );

    CREATE TABLE IF NOT EXISTS decision_options (
      id TEXT PRIMARY KEY DEFAULT ('option_' || lower(hex(randomblob(16)))),
      decision_id TEXT NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
      option_name TEXT NOT NULL,
      score REAL,
      pros TEXT,
      cons TEXT,
      metadata TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_decisions_project ON decisions(project_id);
    CREATE INDEX IF NOT EXISTS idx_decisions_session ON decisions(session_id);
    CREATE INDEX IF NOT EXISTS idx_decisions_type ON decisions(decision_type);
    CREATE INDEX IF NOT EXISTS idx_decisions_created ON decisions(created_at);
    CREATE INDEX IF NOT EXISTS idx_decision_options_decision ON decision_options(decision_id);

    -- 评测中心：数据集表
    CREATE TABLE IF NOT EXISTS datasets (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      type TEXT DEFAULT 'custom',
      column_schema TEXT,
      item_count INTEGER DEFAULT 0,
      current_version_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- 评测中心：数据集条目表
    CREATE TABLE IF NOT EXISTS dataset_items (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      dataset_id TEXT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
      input TEXT NOT NULL,
      expected_output TEXT,
      fields TEXT,
      metadata TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- 评测中心：数据集版本表
    CREATE TABLE IF NOT EXISTS dataset_versions (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      dataset_id TEXT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
      version_number INTEGER NOT NULL,
      name TEXT,
      description TEXT,
      column_schema TEXT,
      item_data TEXT NOT NULL,
      item_count INTEGER DEFAULT 0,
      created_by TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- 评测中心：评估器表
    CREATE TABLE IF NOT EXISTS evaluators (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      type TEXT NOT NULL,
      config TEXT NOT NULL,
      current_version_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- 评测中心：评估器版本表
    CREATE TABLE IF NOT EXISTS evaluator_versions (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      evaluator_id TEXT NOT NULL REFERENCES evaluators(id) ON DELETE CASCADE,
      version_number INTEGER NOT NULL,
      name TEXT,
      description TEXT,
      type TEXT NOT NULL,
      config TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- 评测中心：评测实验表
    CREATE TABLE IF NOT EXISTS evaluation_experiments (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      dataset_id TEXT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
      model_config TEXT,
      status TEXT DEFAULT 'pending',
      results_summary TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      started_at TEXT,
      completed_at TEXT
    );

    -- 评测中心：评测结果表
    CREATE TABLE IF NOT EXISTS evaluation_results (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      experiment_id TEXT NOT NULL REFERENCES evaluation_experiments(id) ON DELETE CASCADE,
      dataset_item_id TEXT NOT NULL REFERENCES dataset_items(id) ON DELETE CASCADE,
      evaluator_id TEXT REFERENCES evaluators(id) ON DELETE SET NULL,
      output TEXT,
      score REAL,
      passed INTEGER DEFAULT 0,
      details TEXT,
      latency_ms INTEGER,
      calibrated_score REAL,
      calibrated_passed INTEGER,
      calibration_note TEXT,
      calibrated_at TEXT,
      calibrated_by TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- 评测中心：自动评测任务表
    CREATE TABLE IF NOT EXISTS auto_eval_tasks (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      dataset_id TEXT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
      evaluator_id TEXT REFERENCES evaluators(id) ON DELETE SET NULL,
      interval_hours INTEGER DEFAULT 24,
      sample_count INTEGER DEFAULT 10,
      trace_type_filter TEXT,
      enabled INTEGER DEFAULT 1,
      last_run_at TEXT,
      next_run_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- 评测中心索引
    CREATE INDEX IF NOT EXISTS idx_datasets_project ON datasets(project_id);
    CREATE INDEX IF NOT EXISTS idx_dataset_items_dataset ON dataset_items(dataset_id);
    CREATE INDEX IF NOT EXISTS idx_evaluators_project ON evaluators(project_id);
    CREATE INDEX IF NOT EXISTS idx_experiments_project ON evaluation_experiments(project_id);
    CREATE INDEX IF NOT EXISTS idx_experiments_dataset ON evaluation_experiments(dataset_id);
    CREATE INDEX IF NOT EXISTS idx_results_experiment ON evaluation_results(experiment_id);
    CREATE INDEX IF NOT EXISTS idx_results_dataset_item ON evaluation_results(dataset_item_id);

    -- Prompt 工程：Prompt 主表
    CREATE TABLE IF NOT EXISTS prompts (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      content TEXT NOT NULL,
      config TEXT,
      current_version_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Prompt 工程：版本表
    CREATE TABLE IF NOT EXISTS prompt_versions (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      prompt_id TEXT NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      config TEXT,
      version_number INTEGER NOT NULL,
      description TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Prompt 工程：Playground 运行记录
    CREATE TABLE IF NOT EXISTS playground_runs (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      prompt_id TEXT REFERENCES prompts(id) ON DELETE SET NULL,
      prompt_version_id TEXT REFERENCES prompt_versions(id) ON DELETE SET NULL,
      model TEXT NOT NULL,
      input TEXT NOT NULL,
      output TEXT,
      latency_ms INTEGER,
      status TEXT DEFAULT 'success',
      metadata TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Prompt 工程：模型配置表
    CREATE TABLE IF NOT EXISTS model_configs (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      config TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Prompt 工程索引
    CREATE INDEX IF NOT EXISTS idx_prompts_project ON prompts(project_id);
    CREATE INDEX IF NOT EXISTS idx_prompt_versions_prompt ON prompt_versions(prompt_id);
    CREATE INDEX IF NOT EXISTS idx_playground_runs_project ON playground_runs(project_id);
    CREATE INDEX IF NOT EXISTS idx_playground_runs_prompt ON playground_runs(prompt_id);
    CREATE INDEX IF NOT EXISTS idx_model_configs_project ON model_configs(project_id);
  `);

  // 安全地添加缺失的列（幂等）
  if (!columnExists(db, 'api_keys', 'encrypted_key')) {
    db.exec(`ALTER TABLE api_keys ADD COLUMN encrypted_key TEXT`);
  }
  if (!columnExists(db, 'api_keys', 'revoked_at')) {
    db.exec(`ALTER TABLE api_keys ADD COLUMN revoked_at TEXT`);
  }
  if (!columnExists(db, 'api_keys', 'expires_at')) {
    db.exec(`ALTER TABLE api_keys ADD COLUMN expires_at TEXT`);
  }
  if (!columnExists(db, 'traces', 'parent_trace_id')) {
    db.exec(`ALTER TABLE traces ADD COLUMN parent_trace_id TEXT REFERENCES traces(id) ON DELETE SET NULL`);
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_traces_parent ON traces(parent_trace_id)`);

  // 评测中心 schema 迁移
  if (!columnExists(db, 'datasets', 'column_schema')) {
    db.exec(`ALTER TABLE datasets ADD COLUMN column_schema TEXT`);
  }
  if (!columnExists(db, 'datasets', 'current_version_id')) {
    db.exec(`ALTER TABLE datasets ADD COLUMN current_version_id TEXT`);
  }
  if (!columnExists(db, 'dataset_items', 'fields')) {
    db.exec(`ALTER TABLE dataset_items ADD COLUMN fields TEXT`);
  }
  if (!columnExists(db, 'evaluators', 'current_version_id')) {
    db.exec(`ALTER TABLE evaluators ADD COLUMN current_version_id TEXT`);
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_dataset_versions_dataset ON dataset_versions(dataset_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_evaluator_versions_evaluator ON evaluator_versions(evaluator_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_auto_eval_tasks_project ON auto_eval_tasks(project_id)`);

  // Phase 2: 校准字段安全迁移
  if (!columnExists(db, 'evaluation_results', 'calibrated_score')) {
    db.exec(`ALTER TABLE evaluation_results ADD COLUMN calibrated_score REAL`);
  }
  if (!columnExists(db, 'evaluation_results', 'calibrated_passed')) {
    db.exec(`ALTER TABLE evaluation_results ADD COLUMN calibrated_passed INTEGER`);
  }
  if (!columnExists(db, 'evaluation_results', 'calibration_note')) {
    db.exec(`ALTER TABLE evaluation_results ADD COLUMN calibration_note TEXT`);
  }
  if (!columnExists(db, 'evaluation_results', 'calibrated_at')) {
    db.exec(`ALTER TABLE evaluation_results ADD COLUMN calibrated_at TEXT`);
  }
  if (!columnExists(db, 'evaluation_results', 'calibrated_by')) {
    db.exec(`ALTER TABLE evaluation_results ADD COLUMN calibrated_by TEXT`);
  }
  if (!columnExists(db, 'breakpoints', 'hit_threshold')) {
    db.exec(`ALTER TABLE breakpoints ADD COLUMN hit_threshold INTEGER DEFAULT 0`);
  }
  if (!columnExists(db, 'breakpoints', 'hit_count')) {
    db.exec(`ALTER TABLE breakpoints ADD COLUMN hit_count INTEGER DEFAULT 0`);
  }
  if (!columnExists(db, 'traces', 'trace_id')) {
    db.exec(`ALTER TABLE traces ADD COLUMN trace_id TEXT`);
  }
  if (!columnExists(db, 'traces', 'span_id')) {
    db.exec(`ALTER TABLE traces ADD COLUMN span_id TEXT`);
  }
  if (!columnExists(db, 'traces', 'parent_span_id')) {
    db.exec(`ALTER TABLE traces ADD COLUMN parent_span_id TEXT`);
  }
  if (!columnExists(db, 'model_configs', 'api_key')) {
    db.exec(`ALTER TABLE model_configs ADD COLUMN api_key TEXT`);
  }
  if (!columnExists(db, 'model_configs', 'base_url')) {
    db.exec(`ALTER TABLE model_configs ADD COLUMN base_url TEXT`);
  }
  if (!columnExists(db, 'model_configs', 'updated_at')) {
    db.exec(`ALTER TABLE model_configs ADD COLUMN updated_at TEXT`);
  }
  if (!columnExists(db, 'evaluation_experiments', 'prompt_id')) {
    db.exec(`ALTER TABLE evaluation_experiments ADD COLUMN prompt_id TEXT REFERENCES prompts(id) ON DELETE SET NULL`);
  }
  if (!columnExists(db, 'evaluation_experiments', 'prompt_version_id')) {
    db.exec(`ALTER TABLE evaluation_experiments ADD COLUMN prompt_version_id TEXT REFERENCES prompt_versions(id) ON DELETE SET NULL`);
  }
  if (!columnExists(db, 'evaluation_experiments', 'target_model_config_id')) {
    db.exec(`ALTER TABLE evaluation_experiments ADD COLUMN target_model_config_id TEXT REFERENCES model_configs(id) ON DELETE SET NULL`);
  }
  if (!columnExists(db, 'evaluation_experiments', 'run_config')) {
    db.exec(`ALTER TABLE evaluation_experiments ADD COLUMN run_config TEXT`);
  }
  if (!columnExists(db, 'evaluators', 'model_config_id')) {
    db.exec(`ALTER TABLE evaluators ADD COLUMN model_config_id TEXT REFERENCES model_configs(id) ON DELETE SET NULL`);
  }
  if (!columnExists(db, 'traces', 'latest_eval_score')) {
    db.exec(`ALTER TABLE traces ADD COLUMN latest_eval_score REAL`);
  }
  if (!columnExists(db, 'traces', 'latest_eval_passed')) {
    db.exec(`ALTER TABLE traces ADD COLUMN latest_eval_passed INTEGER`);
  }
  if (!columnExists(db, 'traces', 'prompt_id')) {
    db.exec(`ALTER TABLE traces ADD COLUMN prompt_id TEXT REFERENCES prompts(id) ON DELETE SET NULL`);
  }
  if (!columnExists(db, 'traces', 'prompt_version_id')) {
    db.exec(`ALTER TABLE traces ADD COLUMN prompt_version_id TEXT REFERENCES prompt_versions(id) ON DELETE SET NULL`);
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_traces_prompt_id ON traces(prompt_id)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS trace_eval_results (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      trace_id TEXT NOT NULL REFERENCES traces(id) ON DELETE CASCADE,
      span_id TEXT REFERENCES spans(span_id) ON DELETE SET NULL,
      evaluator TEXT,
      score REAL,
      passed INTEGER,
      details TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  if (!columnExists(db, 'trace_eval_results', 'span_id')) {
    db.exec(`ALTER TABLE trace_eval_results ADD COLUMN span_id TEXT REFERENCES spans(span_id) ON DELETE SET NULL`);
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_trace_eval_results_trace ON trace_eval_results(trace_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_trace_eval_results_span ON trace_eval_results(span_id)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS user_feedbacks (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      session_id TEXT,
      message_id TEXT,
      rating INTEGER NOT NULL,
      reason TEXT,
      comment TEXT,
      dimensions TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_user_feedbacks_project ON user_feedbacks(project_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_user_feedbacks_session ON user_feedbacks(session_id)`);

  // P0-01: spans 表迁移
  db.exec(`
    CREATE TABLE IF NOT EXISTS spans (
      span_id TEXT PRIMARY KEY,
      trace_id TEXT NOT NULL,
      parent_span_id TEXT REFERENCES spans(span_id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      trace_type TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      latency_ms REAL,
      input TEXT,
      output TEXT,
      attributes TEXT,
      status TEXT NOT NULL DEFAULT 'unset',
      error TEXT,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_spans_trace_id ON spans(trace_id);
    CREATE INDEX IF NOT EXISTS idx_spans_parent_span_id ON spans(parent_span_id);
    CREATE INDEX IF NOT EXISTS idx_spans_project_id ON spans(project_id);
    CREATE INDEX IF NOT EXISTS idx_spans_session_id ON spans(session_id);
    CREATE INDEX IF NOT EXISTS idx_spans_started_at ON spans(started_at);
  `);

  // P0-01: 历史 traces 数据迁移到 spans（幂等，只执行一次）
  const migrationMarker = db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='_migration_p001_spans'"
  ).get();
  if (!migrationMarker) {
    // 临时禁用外键检查，避免自引用外键冲突
    db.pragma('foreign_keys = OFF');
    db.exec(`
      INSERT OR IGNORE INTO spans (
        span_id, trace_id, parent_span_id, name, trace_type,
        started_at, ended_at, latency_ms, input, output, attributes,
        status, error, project_id, session_id
      )
      SELECT
        COALESCE(span_id, id) as span_id,
        COALESCE(trace_id, id) as trace_id,
        COALESCE(parent_span_id, parent_trace_id) as parent_span_id,
        name, trace_type, started_at, ended_at, latency_ms,
        input, output, metadata as attributes,
        COALESCE(status, 'success') as status, error, project_id, session_id
      FROM traces
      WHERE span_id IS NOT NULL OR trace_id IS NOT NULL;
    `);
    db.pragma('foreign_keys = ON');
    db.exec(`CREATE TABLE _migration_p001_spans (completed_at TEXT DEFAULT (datetime('now')))`);
  }

  // Performance indexes (composite)
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_traces_project_status ON traces(project_id, status);
    CREATE INDEX IF NOT EXISTS idx_traces_project_type ON traces(project_id, trace_type);
    CREATE INDEX IF NOT EXISTS idx_traces_project_started ON traces(project_id, started_at);
    CREATE INDEX IF NOT EXISTS idx_traces_trace_span ON traces(trace_id, span_id);
    CREATE INDEX IF NOT EXISTS idx_spans_trace_span ON spans(trace_id, span_id);
  `);

  console.log('✅ SQLite schema initialized');
}
