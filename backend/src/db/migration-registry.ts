import Database from 'better-sqlite3';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

/**
 * PostgreSQL 迁移执行器最小接口
 * @returns 提供 query 能力的数据库执行器
 */
export interface PostgresMigrationExecutor {
  /**
   * 执行 SQL 并返回结果
   * @param sql - 待执行的 SQL
   * @param params - SQL 参数
   * @returns 返回包含 rows 的查询结果
   */
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

/**
 * 迁移定义
 * @returns 描述同编号迁移在不同数据库上的执行逻辑
 */
interface MigrationDefinition {
  id: string;
  description: string;
  /**
   * 执行 SQLite 迁移
   * @param db - SQLite 原生连接
   * @returns 无返回值
   */
  applySqlite: (db: Database.Database) => void | Promise<void>;
  /**
   * 执行 PostgreSQL 迁移
   * @param db - PostgreSQL 执行器
   * @returns 无返回值
   */
  applyPostgres: (db: PostgresMigrationExecutor) => Promise<void>;
}

/**
 * 创建 SQLite 的迁移记录表
 * @param db - SQLite 原生连接
 * @returns 无返回值
 */
function ensureSqliteMigrationTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      description TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

/**
 * 创建 PostgreSQL 的迁移记录表
 * @param db - PostgreSQL 执行器
 * @returns 无返回值
 */
async function ensurePostgresMigrationTable(db: PostgresMigrationExecutor): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id VARCHAR(128) PRIMARY KEY,
      description TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

/**
 * 读取 PostgreSQL 基线 schema
 * @returns 返回 schema.sql 文本内容
 */
function readPostgresBaselineSchema(): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  return readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
}

/**
 * 构造 PostgreSQL 兼容基线 schema
 * @returns 返回可直接执行的 PostgreSQL 基线 SQL
 */
function buildPostgresLegacyBootstrapSchema(): string {
  // 基线 schema.sql 的 traces 表内联外键引用了 prompts/prompt_versions，
  // 而这两张表在基线之后才创建。剥离这两列的内联 REFERENCES 子句，
  // 列与索引保持不变，外键约束在 prompts 表创建后通过 ALTER TABLE 补加。
  const baselineSchema = readPostgresBaselineSchema()
    .replace(
      /prompt_id UUID REFERENCES prompts\(id\) ON DELETE SET NULL,/,
      'prompt_id UUID,',
    )
    .replace(
      /prompt_version_id UUID REFERENCES prompt_versions\(id\) ON DELETE SET NULL,/,
      'prompt_version_id UUID,',
    );

  return `
    -- 第一步：执行基线 schema.sql（创建 users/projects/traces 等核心表）
${baselineSchema}

    -- 第二步：创建 Prompt 工程表（补齐历史遗漏的前置表）
    CREATE TABLE IF NOT EXISTS prompts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      content TEXT NOT NULL,
      config JSONB,
      current_version_id UUID,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_prompts_project_id ON prompts(project_id);

    CREATE TABLE IF NOT EXISTS prompt_versions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      prompt_id UUID NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      config JSONB,
      version_number INTEGER NOT NULL,
      description TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_prompt_versions_prompt_id ON prompt_versions(prompt_id);

    -- 第三步：traces 在基线中已创建 prompt_id/prompt_version_id 列，但建表时
    -- prompts 表尚不存在，此处补加外键约束（仅在约束缺失时执行）
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'fk_traces_prompts'
      ) THEN
        ALTER TABLE traces ADD CONSTRAINT fk_traces_prompts
          FOREIGN KEY (prompt_id) REFERENCES prompts(id) ON DELETE SET NULL;
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'fk_traces_prompt_versions'
      ) THEN
        ALTER TABLE traces ADD CONSTRAINT fk_traces_prompt_versions
          FOREIGN KEY (prompt_version_id) REFERENCES prompt_versions(id) ON DELETE SET NULL;
      END IF;
    END $$;

    -- 第四步：补齐其余历史上遗漏的表
    CREATE TABLE IF NOT EXISTS model_configs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      provider VARCHAR(100) NOT NULL,
      model VARCHAR(255) NOT NULL,
      api_key TEXT,
      base_url TEXT,
      config JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_model_configs_project_id ON model_configs(project_id);

    CREATE TABLE IF NOT EXISTS playground_runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      prompt_id UUID REFERENCES prompts(id) ON DELETE SET NULL,
      prompt_version_id UUID REFERENCES prompt_versions(id) ON DELETE SET NULL,
      model VARCHAR(255) NOT NULL,
      input TEXT NOT NULL,
      output TEXT,
      latency_ms INTEGER,
      status VARCHAR(20) NOT NULL DEFAULT 'success',
      metadata JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_playground_runs_project_id ON playground_runs(project_id);
    CREATE INDEX IF NOT EXISTS idx_playground_runs_prompt_id ON playground_runs(prompt_id);

    -- 第五步：补齐评测/Telemetry 领域历史遗留表（与 SQLite 基线 sqlite.ts 对齐）
    -- 说明：以下表仅存在于 SQLite 隐式初始化逻辑中，PostgreSQL 迁移链历史上遗漏，
    -- 全新 PG 部署会因缺表无法启动，此处统一补齐。类型沿用 PG 约定：UUID 主键、JSONB 文档列。

    -- Telemetry：Span 表（自引用 parent_span_id）
    CREATE TABLE IF NOT EXISTS spans (
      span_id VARCHAR(255) PRIMARY KEY,
      trace_id VARCHAR(255) NOT NULL,
      parent_span_id VARCHAR(255) REFERENCES spans(span_id) ON DELETE SET NULL,
      name VARCHAR(255) NOT NULL,
      trace_type VARCHAR(50) NOT NULL,
      started_at TIMESTAMPTZ NOT NULL,
      ended_at TIMESTAMPTZ,
      latency_ms DOUBLE PRECISION,
      input JSONB,
      output JSONB,
      attributes JSONB,
      status VARCHAR(20) NOT NULL DEFAULT 'unset',
      error TEXT,
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_spans_trace_id ON spans(trace_id);
    CREATE INDEX IF NOT EXISTS idx_spans_parent_span_id ON spans(parent_span_id);
    CREATE INDEX IF NOT EXISTS idx_spans_project_id ON spans(project_id);
    CREATE INDEX IF NOT EXISTS idx_spans_session_id ON spans(session_id);
    CREATE INDEX IF NOT EXISTS idx_spans_started_at ON spans(started_at);

    -- 评测中心：数据集
    CREATE TABLE IF NOT EXISTS datasets (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      type VARCHAR(50) DEFAULT 'custom',
      column_schema JSONB,
      item_count INTEGER DEFAULT 0,
      current_version_id UUID,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_datasets_project ON datasets(project_id);

    -- 评测中心：数据集条目
    CREATE TABLE IF NOT EXISTS dataset_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      dataset_id UUID NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
      input JSONB NOT NULL,
      expected_output JSONB,
      fields JSONB,
      metadata JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_dataset_items_dataset ON dataset_items(dataset_id);

    -- 评测中心：数据集不可变版本
    CREATE TABLE IF NOT EXISTS dataset_versions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      dataset_id UUID NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
      version_number INTEGER NOT NULL,
      name VARCHAR(255),
      description TEXT,
      column_schema JSONB,
      item_data JSONB NOT NULL,
      item_count INTEGER DEFAULT 0,
      created_by UUID,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- 评测中心：评估器
    CREATE TABLE IF NOT EXISTS evaluators (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      type VARCHAR(100) NOT NULL,
      config JSONB NOT NULL,
      current_version_id UUID,
      model_config_id UUID REFERENCES model_configs(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_evaluators_project ON evaluators(project_id);

    -- 评测中心：评估器不可变版本
    CREATE TABLE IF NOT EXISTS evaluator_versions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      evaluator_id UUID NOT NULL REFERENCES evaluators(id) ON DELETE CASCADE,
      version_number INTEGER NOT NULL,
      name VARCHAR(255),
      description TEXT,
      type VARCHAR(100) NOT NULL,
      config JSONB NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- 评测中心：评测实验
    CREATE TABLE IF NOT EXISTS evaluation_experiments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      dataset_id UUID NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
      dataset_version_id UUID,
      target_version_id UUID,
      evaluator_suite_version_id UUID,
      lifecycle_status VARCHAR(50) DEFAULT 'draft',
      default_run_config JSONB,
      default_gate_config JSONB,
      model_config JSONB,
      run_config JSONB,
      prompt_id UUID REFERENCES prompts(id) ON DELETE SET NULL,
      prompt_version_id UUID REFERENCES prompt_versions(id) ON DELETE SET NULL,
      target_model_config_id UUID REFERENCES model_configs(id) ON DELETE SET NULL,
      evaluator_id UUID REFERENCES evaluators(id) ON DELETE SET NULL,
      status VARCHAR(50) DEFAULT 'pending',
      results_summary JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_experiments_project ON evaluation_experiments(project_id);
    CREATE INDEX IF NOT EXISTS idx_experiments_dataset ON evaluation_experiments(dataset_id);

    -- 评测中心：评测结果（旧版逐结果表）
    CREATE TABLE IF NOT EXISTS evaluation_results (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      experiment_id UUID NOT NULL REFERENCES evaluation_experiments(id) ON DELETE CASCADE,
      dataset_item_id UUID NOT NULL REFERENCES dataset_items(id) ON DELETE CASCADE,
      evaluator_id UUID REFERENCES evaluators(id) ON DELETE SET NULL,
      output JSONB,
      score DOUBLE PRECISION,
      passed BOOLEAN DEFAULT false,
      details JSONB,
      latency_ms INTEGER,
      calibrated_score DOUBLE PRECISION,
      calibrated_passed BOOLEAN,
      calibration_note TEXT,
      calibrated_at TIMESTAMPTZ,
      calibrated_by UUID,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_results_experiment ON evaluation_results(experiment_id);
    CREATE INDEX IF NOT EXISTS idx_results_dataset_item ON evaluation_results(dataset_item_id);

    -- 评测中心：自动评测任务
    CREATE TABLE IF NOT EXISTS auto_eval_tasks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      dataset_id UUID NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
      evaluator_id UUID REFERENCES evaluators(id) ON DELETE SET NULL,
      interval_hours INTEGER DEFAULT 24,
      sample_count INTEGER DEFAULT 10,
      trace_type_filter VARCHAR(100),
      enabled BOOLEAN DEFAULT true,
      last_run_at TIMESTAMPTZ,
      next_run_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- 评测中心：Trace 自动评估结果
    CREATE TABLE IF NOT EXISTS trace_eval_results (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      trace_id UUID NOT NULL REFERENCES traces(id) ON DELETE CASCADE,
      span_id VARCHAR(255) REFERENCES spans(span_id) ON DELETE SET NULL,
      evaluator VARCHAR(255),
      score DOUBLE PRECISION,
      passed BOOLEAN,
      details JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_trace_eval_results_trace ON trace_eval_results(trace_id);
    CREATE INDEX IF NOT EXISTS idx_trace_eval_results_span ON trace_eval_results(span_id);

    -- 用户反馈
    CREATE TABLE IF NOT EXISTS user_feedbacks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      session_id UUID,
      message_id UUID,
      rating INTEGER NOT NULL,
      reason TEXT,
      comment TEXT,
      dimensions JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_user_feedbacks_project ON user_feedbacks(project_id);
    CREATE INDEX IF NOT EXISTS idx_user_feedbacks_session ON user_feedbacks(session_id);
  `;
}

const MIGRATIONS: MigrationDefinition[] = [
  {
    id: 'p001_legacy_bootstrap',
    description: '建立 schema_migrations 并接管历史基线',
    /**
     * SQLite 基线迁移
     * @param _db - SQLite 原生连接（当前迁移只建立迁移台账，无额外结构变更）
     * @returns 无返回值
     */
    applySqlite: (_db: Database.Database) => {
      // SQLite 历史 schema 仍由 sqlite.ts 的 initSqliteSchema 负责创建；
      // 该迁移只负责把“隐式初始化”纳入显式迁移台账。
    },
    /**
     * PostgreSQL 基线迁移
     * @param db - PostgreSQL 执行器
     * @returns 无返回值
     */
    applyPostgres: async (db: PostgresMigrationExecutor) => {
      await db.query(buildPostgresLegacyBootstrapSchema());
    },
  },
  {
    id: 'p002_telemetry_v2',
    description: 'Telemetry V2：事件幂等台账与 traces.trace_id 唯一索引',
    /**
     * SQLite 迁移：创建事件回执表并为 trace_id 建唯一索引
     * @param db - SQLite 原生连接
     * @returns 无返回值
     */
    applySqlite: (db: Database.Database) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS telemetry_event_receipts (
          event_id TEXT PRIMARY KEY,
          event_type TEXT NOT NULL,
          project_id TEXT,
          entity_type TEXT,
          entity_id TEXT,
          accepted_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);

      // 历史上 V1 接口允许 trace.start 与 trace.end 双写，可能产生重复 trace_id；
      // 在唯一索引建立前先按 trace_id 归并：保留最新一行，并把 spans 外键迁到保留行。
      db.exec(`
        DELETE FROM traces
        WHERE trace_id IS NOT NULL
          AND id NOT IN (
            SELECT keeper_id FROM (
              SELECT trace_id AS dup_trace_id,
                     (SELECT id FROM traces t2
                       WHERE t2.trace_id = traces.trace_id
                       ORDER BY t2.created_at DESC
                       LIMIT 1) AS keeper_id
              FROM traces
              WHERE trace_id IS NOT NULL
              GROUP BY trace_id
              HAVING COUNT(*) > 1
            )
          )
      `);

      db.exec(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_traces_trace_id_unique ON traces(trace_id) WHERE trace_id IS NOT NULL`
      );
    },
    /**
     * PostgreSQL 迁移：创建事件回执表并为 trace_id 建唯一索引
     * @param db - PostgreSQL 执行器
     * @returns 无返回值
     */
    applyPostgres: async (db: PostgresMigrationExecutor) => {
      await db.query(`
        CREATE TABLE IF NOT EXISTS telemetry_event_receipts (
          event_id VARCHAR(128) PRIMARY KEY,
          event_type VARCHAR(64) NOT NULL,
          project_id UUID,
          entity_type VARCHAR(32),
          entity_id UUID,
          accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      // 历史 V1 双写可能导致重复 trace_id，先归并为单行再建唯一索引
      await db.query(`
        DELETE FROM traces
        WHERE trace_id IS NOT NULL
          AND id NOT IN (
            SELECT DISTINCT ON (trace_id) id
            FROM traces
            WHERE trace_id IS NOT NULL
            ORDER BY trace_id, COALESCE(updated_at, created_at) DESC, created_at DESC
          )
      `);

      await db.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_traces_trace_id_unique ON traces(trace_id) WHERE trace_id IS NOT NULL`
      );
    },
  },
  {
    id: 'p003_target_domain',
    description: 'Target 领域：agent_targets 与不可变 agent_target_versions',
    /**
     * SQLite 迁移：创建 Target 主表与版本表
     * @param db - SQLite 原生连接
     * @returns 无返回值
     */
    applySqlite: (db: Database.Database) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS agent_targets (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          description TEXT,
          target_type TEXT NOT NULL,
          current_version_id TEXT,
          enabled INTEGER NOT NULL DEFAULT 1,
          created_by TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(project_id, name)
        )
      `);
      db.exec(`
        CREATE TABLE IF NOT EXISTS agent_target_versions (
          id TEXT PRIMARY KEY,
          target_id TEXT NOT NULL REFERENCES agent_targets(id) ON DELETE CASCADE,
          version_number INTEGER NOT NULL,
          target_type TEXT NOT NULL,
          invocation_config TEXT NOT NULL,
          input_mapping TEXT,
          output_mapping TEXT,
          source_revision TEXT,
          created_by TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(target_id, version_number)
        )
      `);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_targets_project ON agent_targets(project_id)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_target_versions_target ON agent_target_versions(target_id)`);
    },
    /**
     * PostgreSQL 迁移：创建 Target 主表与版本表
     * @param db - PostgreSQL 执行器
     * @returns 无返回值
     */
    applyPostgres: async (db: PostgresMigrationExecutor) => {
      await db.query(`
        CREATE TABLE IF NOT EXISTS agent_targets (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          name VARCHAR(255) NOT NULL,
          description TEXT,
          target_type VARCHAR(64) NOT NULL,
          current_version_id UUID,
          enabled BOOLEAN NOT NULL DEFAULT true,
          created_by UUID,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE(project_id, name)
        )
      `);
      await db.query(`
        CREATE TABLE IF NOT EXISTS agent_target_versions (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          target_id UUID NOT NULL REFERENCES agent_targets(id) ON DELETE CASCADE,
          version_number INTEGER NOT NULL,
          target_type VARCHAR(64) NOT NULL,
          invocation_config JSONB NOT NULL,
          input_mapping JSONB,
          output_mapping JSONB,
          source_revision JSONB,
          created_by UUID,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE(target_id, version_number)
        )
      `);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_agent_targets_project ON agent_targets(project_id)`);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_agent_target_versions_target ON agent_target_versions(target_id)`);
    },
  },
  {
    id: 'p004_dataset_items_and_suites',
    description: 'PR-07：DatasetVersionItem 逐样本快照与 Evaluator Suite/Version/Member',
    /**
     * SQLite 迁移：创建四张新表并为已有 DatasetVersion 回填逐样本快照
     * @param db - SQLite 原生连接
     * @returns 无返回值
     */
    applySqlite: (db: Database.Database) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS dataset_version_items (
          id TEXT PRIMARY KEY,
          dataset_version_id TEXT NOT NULL REFERENCES dataset_versions(id) ON DELETE CASCADE,
          dataset_item_id TEXT,
          case_key TEXT NOT NULL,
          input_data TEXT NOT NULL,
          expected_data TEXT,
          context_data TEXT,
          fields TEXT,
          metadata TEXT,
          tags TEXT,
          content_hash TEXT NOT NULL,
          ordinal INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(dataset_version_id, case_key)
        )
      `);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_dataset_version_items_version ON dataset_version_items(dataset_version_id)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_dataset_version_items_case_key ON dataset_version_items(case_key)`);

      db.exec(`
        CREATE TABLE IF NOT EXISTS evaluator_suites (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          description TEXT,
          current_version_id TEXT,
          created_by TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(project_id, name)
        )
      `);
      db.exec(`
        CREATE TABLE IF NOT EXISTS evaluator_suite_versions (
          id TEXT PRIMARY KEY,
          suite_id TEXT NOT NULL REFERENCES evaluator_suites(id) ON DELETE CASCADE,
          version_number INTEGER NOT NULL,
          description TEXT,
          aggregation_config TEXT NOT NULL,
          created_by TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(suite_id, version_number)
        )
      `);
      db.exec(`
        CREATE TABLE IF NOT EXISTS evaluator_suite_members (
          id TEXT PRIMARY KEY,
          suite_version_id TEXT NOT NULL REFERENCES evaluator_suite_versions(id) ON DELETE CASCADE,
          evaluator_version_id TEXT NOT NULL REFERENCES evaluator_versions(id) ON DELETE CASCADE,
          alias TEXT NOT NULL,
          weight REAL NOT NULL DEFAULT 1.0,
          required INTEGER NOT NULL DEFAULT 1,
          pass_threshold REAL,
          ordinal INTEGER NOT NULL DEFAULT 0,
          UNIQUE(suite_version_id, alias)
        )
      `);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_evaluator_suites_project ON evaluator_suites(project_id)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_evaluator_suite_versions_suite ON evaluator_suite_versions(suite_id)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_evaluator_suite_members_version ON evaluator_suite_members(suite_version_id)`);

      backfillSqliteDatasetVersionItems(db);
    },
    /**
     * PostgreSQL 迁移：创建四张新表并回填已有 DatasetVersion 的逐样本快照
     * @param db - PostgreSQL 执行器
     * @returns 无返回值
     */
    applyPostgres: async (db: PostgresMigrationExecutor) => {
      await db.query(`
        CREATE TABLE IF NOT EXISTS dataset_version_items (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          dataset_version_id UUID NOT NULL REFERENCES dataset_versions(id) ON DELETE CASCADE,
          dataset_item_id UUID,
          case_key VARCHAR(255) NOT NULL,
          input_data JSONB NOT NULL,
          expected_data JSONB,
          context_data JSONB,
          fields JSONB,
          metadata JSONB,
          tags JSONB,
          content_hash VARCHAR(128) NOT NULL,
          ordinal INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE(dataset_version_id, case_key)
        )
      `);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_dataset_version_items_version ON dataset_version_items(dataset_version_id)`);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_dataset_version_items_case_key ON dataset_version_items(case_key)`);

      await db.query(`
        CREATE TABLE IF NOT EXISTS evaluator_suites (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          name VARCHAR(255) NOT NULL,
          description TEXT,
          current_version_id UUID,
          created_by UUID,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE(project_id, name)
        )
      `);
      await db.query(`
        CREATE TABLE IF NOT EXISTS evaluator_suite_versions (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          suite_id UUID NOT NULL REFERENCES evaluator_suites(id) ON DELETE CASCADE,
          version_number INTEGER NOT NULL,
          description TEXT,
          aggregation_config JSONB NOT NULL,
          created_by UUID,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE(suite_id, version_number)
        )
      `);
      await db.query(`
        CREATE TABLE IF NOT EXISTS evaluator_suite_members (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          suite_version_id UUID NOT NULL REFERENCES evaluator_suite_versions(id) ON DELETE CASCADE,
          evaluator_version_id UUID NOT NULL REFERENCES evaluator_versions(id) ON DELETE CASCADE,
          alias VARCHAR(255) NOT NULL,
          weight DOUBLE PRECISION NOT NULL DEFAULT 1.0,
          required BOOLEAN NOT NULL DEFAULT true,
          pass_threshold DOUBLE PRECISION,
          ordinal INTEGER NOT NULL DEFAULT 0,
          UNIQUE(suite_version_id, alias)
        )
      `);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_evaluator_suites_project ON evaluator_suites(project_id)`);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_evaluator_suite_versions_suite ON evaluator_suite_versions(suite_id)`);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_evaluator_suite_members_version ON evaluator_suite_members(suite_version_id)`);

      await backfillPostgresDatasetVersionItems(db);
    },
  },
  {
    id: 'p005_experiment_run_separation',
    description: 'PR-08：Experiment/Run 分离，新增 evaluation_runs/run_items/scores/run_events 与 Experiment 新列',
    /**
     * SQLite 迁移：为已有 evaluation_experiments 补齐新列，并创建 Run 体系四张表
     * @param db - SQLite 原生连接
     * @returns 无返回值
     */
    applySqlite: (db: Database.Database) => {
      const experimentColumns = db.prepare("PRAGMA table_info(evaluation_experiments)").all() as Array<{ name: string }>;
      const experimentColumnNames = new Set(experimentColumns.map((c) => c.name));
      const addExperimentColumn = (name: string, ddl: string): void => {
        if (!experimentColumnNames.has(name)) {
          db.exec(`ALTER TABLE evaluation_experiments ADD COLUMN ${name} ${ddl}`);
        }
      };
      addExperimentColumn('dataset_version_id', 'TEXT');
      addExperimentColumn('target_version_id', 'TEXT');
      addExperimentColumn('evaluator_suite_version_id', 'TEXT');
      addExperimentColumn('lifecycle_status', "TEXT NOT NULL DEFAULT 'draft'");
      addExperimentColumn('default_run_config', 'TEXT');
      addExperimentColumn('default_gate_config', 'TEXT');

      db.exec(`
        CREATE TABLE IF NOT EXISTS evaluation_runs (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          experiment_id TEXT NOT NULL REFERENCES evaluation_experiments(id) ON DELETE CASCADE,
          run_number INTEGER NOT NULL,
          trigger_type TEXT NOT NULL DEFAULT 'manual',
          trigger_ref TEXT,
          baseline_run_id TEXT,
          retry_of_run_id TEXT,
          status TEXT NOT NULL DEFAULT 'queued',
          status_reason TEXT,
          requested_by TEXT,
          idempotency_key TEXT,
          source_revision TEXT,
          config_snapshot TEXT,
          gate_snapshot TEXT,
          summary TEXT,
          gate_result TEXT,
          queued_at TEXT NOT NULL DEFAULT (datetime('now')),
          started_at TEXT,
          completed_at TEXT,
          cancel_requested_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(experiment_id, run_number)
        )
      `);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_eval_runs_experiment ON evaluation_runs(experiment_id)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_eval_runs_project_status ON evaluation_runs(project_id, status)`);

      db.exec(`
        CREATE TABLE IF NOT EXISTS evaluation_run_items (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL REFERENCES evaluation_runs(id) ON DELETE CASCADE,
          dataset_version_item_id TEXT NOT NULL,
          case_key TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          phase TEXT NOT NULL DEFAULT 'queued',
          attempt_count INTEGER NOT NULL DEFAULT 0,
          lease_owner TEXT,
          lease_token_hash TEXT,
          lease_expires_at TEXT,
          input_snapshot TEXT,
          expected_snapshot TEXT,
          target_output TEXT,
          target_error TEXT,
          trace_id TEXT,
          session_id TEXT,
          latency_ms INTEGER,
          token_usage TEXT,
          cost REAL,
          started_at TEXT,
          completed_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(run_id, dataset_version_item_id)
        )
      `);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_eval_run_items_run ON evaluation_run_items(run_id)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_eval_run_items_status_lease ON evaluation_run_items(status, lease_expires_at)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_eval_run_items_trace ON evaluation_run_items(trace_id)`);

      db.exec(`
        CREATE TABLE IF NOT EXISTS evaluation_scores (
          id TEXT PRIMARY KEY,
          run_item_id TEXT NOT NULL REFERENCES evaluation_run_items(id) ON DELETE CASCADE,
          evaluator_version_id TEXT,
          evaluator_alias TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          score REAL,
          passed INTEGER,
          label TEXT,
          reasoning TEXT,
          details TEXT,
          error TEXT,
          raw_output TEXT,
          latency_ms INTEGER,
          token_usage TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          completed_at TEXT,
          UNIQUE(run_item_id, evaluator_alias)
        )
      `);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_eval_scores_run_item ON evaluation_scores(run_item_id)`);

      db.exec(`
        CREATE TABLE IF NOT EXISTS evaluation_run_events (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL REFERENCES evaluation_runs(id) ON DELETE CASCADE,
          sequence INTEGER NOT NULL,
          event_type TEXT NOT NULL,
          payload TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(run_id, sequence)
        )
      `);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_eval_run_events_run ON evaluation_run_events(run_id, sequence)`);
    },
    /**
     * PostgreSQL 迁移：为已有 evaluation_experiments 补齐新列，并创建 Run 体系四张表
     * @param db - PostgreSQL 执行器
     * @returns 无返回值
     */
    applyPostgres: async (db: PostgresMigrationExecutor) => {
      await db.query(`ALTER TABLE evaluation_experiments ADD COLUMN IF NOT EXISTS dataset_version_id UUID`);
      await db.query(`ALTER TABLE evaluation_experiments ADD COLUMN IF NOT EXISTS target_version_id UUID`);
      await db.query(`ALTER TABLE evaluation_experiments ADD COLUMN IF NOT EXISTS evaluator_suite_version_id UUID`);
      await db.query(`ALTER TABLE evaluation_experiments ADD COLUMN IF NOT EXISTS lifecycle_status VARCHAR(32) NOT NULL DEFAULT 'draft'`);
      await db.query(`ALTER TABLE evaluation_experiments ADD COLUMN IF NOT EXISTS default_run_config JSONB`);
      await db.query(`ALTER TABLE evaluation_experiments ADD COLUMN IF NOT EXISTS default_gate_config JSONB`);

      await db.query(`
        CREATE TABLE IF NOT EXISTS evaluation_runs (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          experiment_id UUID NOT NULL REFERENCES evaluation_experiments(id) ON DELETE CASCADE,
          run_number INTEGER NOT NULL,
          trigger_type VARCHAR(32) NOT NULL DEFAULT 'manual',
          trigger_ref TEXT,
          baseline_run_id UUID,
          retry_of_run_id UUID,
          status VARCHAR(32) NOT NULL DEFAULT 'queued',
          status_reason TEXT,
          requested_by UUID,
          idempotency_key VARCHAR(128),
          source_revision JSONB,
          config_snapshot JSONB,
          gate_snapshot JSONB,
          summary JSONB,
          gate_result JSONB,
          queued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          started_at TIMESTAMPTZ,
          completed_at TIMESTAMPTZ,
          cancel_requested_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE(experiment_id, run_number),
          UNIQUE(project_id, idempotency_key)
        )
      `);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_eval_runs_experiment ON evaluation_runs(experiment_id)`);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_eval_runs_project_status ON evaluation_runs(project_id, status)`);

      await db.query(`
        CREATE TABLE IF NOT EXISTS evaluation_run_items (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          run_id UUID NOT NULL REFERENCES evaluation_runs(id) ON DELETE CASCADE,
          dataset_version_item_id UUID NOT NULL,
          case_key VARCHAR(255) NOT NULL,
          status VARCHAR(32) NOT NULL DEFAULT 'pending',
          phase VARCHAR(32) NOT NULL DEFAULT 'queued',
          attempt_count INTEGER NOT NULL DEFAULT 0,
          lease_owner VARCHAR(128),
          lease_token_hash VARCHAR(128),
          lease_expires_at TIMESTAMPTZ,
          input_snapshot JSONB NOT NULL,
          expected_snapshot JSONB,
          target_output TEXT,
          target_error TEXT,
          trace_id VARCHAR(128),
          session_id VARCHAR(128),
          latency_ms INTEGER,
          token_usage JSONB,
          cost DOUBLE PRECISION,
          started_at TIMESTAMPTZ,
          completed_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE(run_id, dataset_version_item_id)
        )
      `);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_eval_run_items_run ON evaluation_run_items(run_id)`);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_eval_run_items_status_lease ON evaluation_run_items(status, lease_expires_at)`);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_eval_run_items_trace ON evaluation_run_items(trace_id)`);

      await db.query(`
        CREATE TABLE IF NOT EXISTS evaluation_scores (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          run_item_id UUID NOT NULL REFERENCES evaluation_run_items(id) ON DELETE CASCADE,
          evaluator_version_id UUID,
          evaluator_alias VARCHAR(255) NOT NULL,
          status VARCHAR(32) NOT NULL DEFAULT 'pending',
          score DOUBLE PRECISION,
          passed BOOLEAN,
          label VARCHAR(64),
          reasoning TEXT,
          details JSONB,
          error TEXT,
          raw_output TEXT,
          latency_ms INTEGER,
          token_usage JSONB,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          completed_at TIMESTAMPTZ,
          UNIQUE(run_item_id, evaluator_alias)
        )
      `);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_eval_scores_run_item ON evaluation_scores(run_item_id)`);

      await db.query(`
        CREATE TABLE IF NOT EXISTS evaluation_run_events (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          run_id UUID NOT NULL REFERENCES evaluation_runs(id) ON DELETE CASCADE,
          sequence INTEGER NOT NULL,
          event_type VARCHAR(64) NOT NULL,
          payload JSONB,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE(run_id, sequence)
        )
      `);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_eval_run_events_run ON evaluation_run_events(run_id, sequence)`);
    },
  },
  {
    id: 'p006_service_tokens_runner_sessions',
    description: 'PR-10：Service Token（scopes）与 Runner Session 表',
    applySqlite: (db: Database.Database) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS service_tokens (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          token_hash TEXT NOT NULL UNIQUE,
          token_prefix TEXT NOT NULL,
          scopes TEXT NOT NULL DEFAULT '[]',
          expires_at TEXT,
          last_used_at TEXT,
          revoked_at TEXT,
          created_by TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_service_tokens_project ON service_tokens(project_id)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_service_tokens_hash ON service_tokens(token_hash)`);

      db.exec(`
        CREATE TABLE IF NOT EXISTS runner_sessions (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          run_id TEXT REFERENCES evaluation_runs(id) ON DELETE CASCADE,
          token_id TEXT REFERENCES service_tokens(id) ON DELETE SET NULL,
          runner_id TEXT NOT NULL,
          capabilities TEXT NOT NULL DEFAULT '{}',
          status TEXT NOT NULL DEFAULT 'active',
          last_heartbeat_at TEXT,
          closed_at TEXT,
          metadata TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_runner_sessions_run ON runner_sessions(run_id)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_runner_sessions_project_status ON runner_sessions(project_id, status)`);
    },
    applyPostgres: async (db: PostgresMigrationExecutor) => {
      await db.query(`
        CREATE TABLE IF NOT EXISTS service_tokens (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          name VARCHAR(255) NOT NULL,
          token_hash VARCHAR(128) NOT NULL UNIQUE,
          token_prefix VARCHAR(32) NOT NULL,
          scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
          expires_at TIMESTAMPTZ,
          last_used_at TIMESTAMPTZ,
          revoked_at TIMESTAMPTZ,
          created_by UUID,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_service_tokens_project ON service_tokens(project_id)`);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_service_tokens_hash ON service_tokens(token_hash)`);

      await db.query(`
        CREATE TABLE IF NOT EXISTS runner_sessions (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          run_id UUID REFERENCES evaluation_runs(id) ON DELETE CASCADE,
          token_id UUID REFERENCES service_tokens(id) ON DELETE SET NULL,
          runner_id VARCHAR(128) NOT NULL,
          capabilities JSONB NOT NULL DEFAULT '{}'::jsonb,
          status VARCHAR(32) NOT NULL DEFAULT 'active',
          last_heartbeat_at TIMESTAMPTZ,
          closed_at TIMESTAMPTZ,
          metadata JSONB,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_runner_sessions_run ON runner_sessions(run_id)`);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_runner_sessions_project_status ON runner_sessions(project_id, status)`);
    },
  },
  {
    id: 'p007_prompt_deployments',
    description: 'PR-12：Prompt Deployment（project+prompt+environment → promptVersionId）与 Runtime 指针',
    applySqlite: (db: Database.Database) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS prompt_deployments (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          prompt_id TEXT NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
          environment TEXT NOT NULL,
          prompt_version_id TEXT NOT NULL REFERENCES prompt_versions(id) ON DELETE RESTRICT,
          deployed_by TEXT,
          note TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(project_id, prompt_id, environment)
        )
      `);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_prompt_deployments_prompt ON prompt_deployments(prompt_id)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_prompt_deployments_project_env ON prompt_deployments(project_id, environment)`);
    },
    applyPostgres: async (db: PostgresMigrationExecutor) => {
      await db.query(`
        CREATE TABLE IF NOT EXISTS prompt_deployments (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          prompt_id UUID NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
          environment VARCHAR(64) NOT NULL,
          prompt_version_id UUID NOT NULL REFERENCES prompt_versions(id) ON DELETE RESTRICT,
          deployed_by UUID,
          note TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE(project_id, prompt_id, environment)
        )
      `);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_prompt_deployments_prompt ON prompt_deployments(prompt_id)`);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_prompt_deployments_project_env ON prompt_deployments(project_id, environment)`);
    },
  },
  {
    id: 'p008_scheduled_runs',
    description: 'PR-13：Scheduled Run 定时回归调度表（interval/cron + next_run_at 到期扫描）',
    applySqlite: (db: Database.Database) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS scheduled_runs (
          id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          experiment_id TEXT NOT NULL REFERENCES evaluation_experiments(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          schedule_type TEXT NOT NULL DEFAULT 'interval',
          interval_minutes INTEGER,
          cron_expr TEXT,
          enabled INTEGER NOT NULL DEFAULT 1,
          last_run_at TEXT,
          next_run_at TEXT,
          last_run_id TEXT REFERENCES evaluation_runs(id) ON DELETE SET NULL,
          last_status TEXT,
          created_by TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_scheduled_runs_due ON scheduled_runs(enabled, next_run_at)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_scheduled_runs_project ON scheduled_runs(project_id)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_scheduled_runs_experiment ON scheduled_runs(experiment_id)`);
    },
    applyPostgres: async (db: PostgresMigrationExecutor) => {
      await db.query(`
        CREATE TABLE IF NOT EXISTS scheduled_runs (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          experiment_id UUID NOT NULL REFERENCES evaluation_experiments(id) ON DELETE CASCADE,
          name VARCHAR(256) NOT NULL,
          schedule_type VARCHAR(16) NOT NULL DEFAULT 'interval',
          interval_minutes INTEGER,
          cron_expr VARCHAR(128),
          enabled BOOLEAN NOT NULL DEFAULT TRUE,
          last_run_at TIMESTAMPTZ,
          next_run_at TIMESTAMPTZ,
          last_run_id UUID REFERENCES evaluation_runs(id) ON DELETE SET NULL,
          last_status VARCHAR(32),
          created_by UUID,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_scheduled_runs_due ON scheduled_runs(enabled, next_run_at)`);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_scheduled_runs_project ON scheduled_runs(project_id)`);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_scheduled_runs_experiment ON scheduled_runs(experiment_id)`);
    },
  },
  {
    id: 'p009_trace_sampling_rules',
    description: 'PR-13：Trace Sampling 采样规则与采样回流台账（trace 去重水位）',
    applySqlite: (db: Database.Database) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS sampling_rules (
          id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          target_dataset_id TEXT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
          trace_type_filter TEXT,
          name_contains TEXT,
          status_filter TEXT,
          error_only INTEGER NOT NULL DEFAULT 0,
          sample_rate REAL NOT NULL DEFAULT 1.0,
          max_items_total INTEGER,
          enabled INTEGER NOT NULL DEFAULT 1,
          matched_count INTEGER NOT NULL DEFAULT 0,
          sampled_count INTEGER NOT NULL DEFAULT 0,
          last_scanned_at TEXT,
          created_by TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
      db.exec(`
        CREATE TABLE IF NOT EXISTS sampled_traces (
          id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
          rule_id TEXT NOT NULL REFERENCES sampling_rules(id) ON DELETE CASCADE,
          trace_id TEXT NOT NULL,
          dataset_item_id TEXT,
          sampled_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(rule_id, trace_id)
        )
      `);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_sampling_rules_project ON sampling_rules(project_id, enabled)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_sampled_traces_rule ON sampled_traces(rule_id)`);
    },
    applyPostgres: async (db: PostgresMigrationExecutor) => {
      await db.query(`
        CREATE TABLE IF NOT EXISTS sampling_rules (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          name VARCHAR(256) NOT NULL,
          target_dataset_id UUID NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
          trace_type_filter VARCHAR(64),
          name_contains VARCHAR(256),
          status_filter VARCHAR(32),
          error_only BOOLEAN NOT NULL DEFAULT FALSE,
          sample_rate DOUBLE PRECISION NOT NULL DEFAULT 1.0,
          max_items_total INTEGER,
          enabled BOOLEAN NOT NULL DEFAULT TRUE,
          matched_count INTEGER NOT NULL DEFAULT 0,
          sampled_count INTEGER NOT NULL DEFAULT 0,
          last_scanned_at TIMESTAMPTZ,
          created_by UUID,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await db.query(`
        CREATE TABLE IF NOT EXISTS sampled_traces (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          rule_id UUID NOT NULL REFERENCES sampling_rules(id) ON DELETE CASCADE,
          trace_id UUID NOT NULL,
          dataset_item_id UUID,
          sampled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE(rule_id, trace_id)
        )
      `);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_sampling_rules_project ON sampling_rules(project_id, enabled)`);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_sampled_traces_rule ON sampled_traces(rule_id)`);
    },
  },
  {
    id: 'p010_persistent_alert_rules',
    description: 'PR-13：持久化 Alert Rule（Run 回归/失败/Webhook）与 alert_events 投递台账',
    applySqlite: (db: Database.Database) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS alert_rules (
          id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          event_type TEXT NOT NULL,
          condition TEXT,
          threshold REAL,
          webhook_url TEXT,
          channels TEXT NOT NULL DEFAULT '["web"]',
          enabled INTEGER NOT NULL DEFAULT 1,
          cooldown_minutes INTEGER NOT NULL DEFAULT 60,
          last_triggered_at TEXT,
          created_by TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
      db.exec(`
        CREATE TABLE IF NOT EXISTS alert_events (
          id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
          rule_id TEXT REFERENCES alert_rules(id) ON DELETE SET NULL,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          event_type TEXT NOT NULL,
          severity TEXT NOT NULL DEFAULT 'warning',
          title TEXT NOT NULL,
          message TEXT NOT NULL,
          payload TEXT,
          fingerprint TEXT NOT NULL,
          delivery_status TEXT NOT NULL DEFAULT 'pending',
          delivered_at TEXT,
          delivery_error TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_alert_rules_project ON alert_rules(project_id, enabled, event_type)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_alert_events_project ON alert_events(project_id, created_at)`);
      db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_alert_events_fingerprint ON alert_events(rule_id, fingerprint)`);
    },
    applyPostgres: async (db: PostgresMigrationExecutor) => {
      await db.query(`
        CREATE TABLE IF NOT EXISTS alert_rules (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          name VARCHAR(256) NOT NULL,
          event_type VARCHAR(64) NOT NULL,
          condition VARCHAR(64),
          threshold DOUBLE PRECISION,
          webhook_url TEXT,
          channels JSONB NOT NULL DEFAULT '["web"]'::jsonb,
          enabled BOOLEAN NOT NULL DEFAULT TRUE,
          cooldown_minutes INTEGER NOT NULL DEFAULT 60,
          last_triggered_at TIMESTAMPTZ,
          created_by UUID,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await db.query(`
        CREATE TABLE IF NOT EXISTS alert_events (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          rule_id UUID REFERENCES alert_rules(id) ON DELETE SET NULL,
          project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          event_type VARCHAR(64) NOT NULL,
          severity VARCHAR(16) NOT NULL DEFAULT 'warning',
          title VARCHAR(512) NOT NULL,
          message TEXT NOT NULL,
          payload JSONB,
          fingerprint VARCHAR(128) NOT NULL,
          delivery_status VARCHAR(32) NOT NULL DEFAULT 'pending',
          delivered_at TIMESTAMPTZ,
          delivery_error TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_alert_rules_project ON alert_rules(project_id, enabled, event_type)`);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_alert_events_project ON alert_events(project_id, created_at)`);
      await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_alert_events_fingerprint ON alert_events(rule_id, fingerprint)`);
    },
  },
  {
    id: 'p011_trace_annotations',
    description: 'P1：Trace 人工标注（根因分类 prompt/model/tool/retrieval/data/evaluator/unknown + 结论）',
    applySqlite: (db: Database.Database) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS trace_annotations (
          id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          trace_id TEXT NOT NULL,
          run_item_id TEXT,
          root_cause TEXT,
          verdict TEXT,
          note TEXT,
          tags TEXT NOT NULL DEFAULT '[]',
          created_by TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(project_id, trace_id)
        )
      `);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_trace_annotations_project ON trace_annotations(project_id, created_at)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_trace_annotations_cause ON trace_annotations(root_cause)`);
    },
    applyPostgres: async (db: PostgresMigrationExecutor) => {
      await db.query(`
        CREATE TABLE IF NOT EXISTS trace_annotations (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          trace_id TEXT NOT NULL,
          run_item_id UUID,
          root_cause VARCHAR(32),
          verdict VARCHAR(16),
          note TEXT,
          tags JSONB NOT NULL DEFAULT '[]'::jsonb,
          created_by UUID,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE(project_id, trace_id)
        )
      `);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_trace_annotations_project ON trace_annotations(project_id, created_at)`);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_trace_annotations_cause ON trace_annotations(root_cause)`);
    },
  },
  {
    id: 'p012_prompt_ab_variants',
    description: 'P1：Prompt A/B 实验流量分桶（project+prompt+environment 多 variant + 权重）',
    applySqlite: (db: Database.Database) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS prompt_ab_variants (
          id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          prompt_id TEXT NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
          environment TEXT NOT NULL,
          variant_key TEXT NOT NULL,
          prompt_version_id TEXT NOT NULL REFERENCES prompt_versions(id) ON DELETE RESTRICT,
          weight INTEGER NOT NULL DEFAULT 0,
          note TEXT,
          enabled INTEGER NOT NULL DEFAULT 1,
          created_by TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(project_id, prompt_id, environment, variant_key)
        )
      `);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_prompt_ab_lookup ON prompt_ab_variants(project_id, prompt_id, environment, enabled)`);
    },
    applyPostgres: async (db: PostgresMigrationExecutor) => {
      await db.query(`
        CREATE TABLE IF NOT EXISTS prompt_ab_variants (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          prompt_id UUID NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
          environment VARCHAR(64) NOT NULL,
          variant_key VARCHAR(64) NOT NULL,
          prompt_version_id UUID NOT NULL REFERENCES prompt_versions(id) ON DELETE RESTRICT,
          weight INTEGER NOT NULL DEFAULT 0,
          note TEXT,
          enabled BOOLEAN NOT NULL DEFAULT TRUE,
          created_by UUID,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE(project_id, prompt_id, environment, variant_key)
        )
      `);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_prompt_ab_lookup ON prompt_ab_variants(project_id, prompt_id, environment, enabled)`);
    },
  },
  {
    id: 'p013_scheduled_run_executions',
    description: 'DoD-11：Scheduled Run 执行历史表（started/completed/status/error/next_run_at 快照）',
    applySqlite: (db: Database.Database) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS scheduled_run_executions (
          id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
          schedule_id TEXT NOT NULL REFERENCES scheduled_runs(id) ON DELETE CASCADE,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          experiment_id TEXT NOT NULL REFERENCES evaluation_experiments(id) ON DELETE CASCADE,
          trigger_mode TEXT NOT NULL DEFAULT 'scheduled',
          status TEXT NOT NULL DEFAULT 'running',
          run_id TEXT REFERENCES evaluation_runs(id) ON DELETE SET NULL,
          error_message TEXT,
          started_at TEXT NOT NULL DEFAULT (datetime('now')),
          completed_at TEXT,
          next_run_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_sched_exec_schedule_started ON scheduled_run_executions(schedule_id, started_at DESC)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_sched_exec_project_started ON scheduled_run_executions(project_id, started_at DESC)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_sched_exec_run ON scheduled_run_executions(run_id)`);
    },
    applyPostgres: async (db: PostgresMigrationExecutor) => {
      await db.query(`
        CREATE TABLE IF NOT EXISTS scheduled_run_executions (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          schedule_id UUID NOT NULL REFERENCES scheduled_runs(id) ON DELETE CASCADE,
          project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          experiment_id UUID NOT NULL REFERENCES evaluation_experiments(id) ON DELETE CASCADE,
          trigger_mode VARCHAR(16) NOT NULL DEFAULT 'scheduled',
          status VARCHAR(32) NOT NULL DEFAULT 'running',
          run_id UUID REFERENCES evaluation_runs(id) ON DELETE SET NULL,
          error_message TEXT,
          started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          completed_at TIMESTAMPTZ,
          next_run_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_sched_exec_schedule_started ON scheduled_run_executions(schedule_id, started_at DESC)`);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_sched_exec_project_started ON scheduled_run_executions(project_id, started_at DESC)`);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_sched_exec_run ON scheduled_run_executions(run_id)`);
    },
  },
  {
    id: 'p014_telemetry_id_varchar',
    description: 'Telemetry 主键/外键放宽为 VARCHAR：兼容 SDK 自定义字符串 sessionId/traceId',
    /**
     * SQLite 对主键类型天然宽容（TEXT 即可容纳任意字符串），无需调整。
     * @param _db - SQLite 原生连接（未使用）
     * @returns 无返回值
     */
    applySqlite: (_db: Database.Database) => {
      // SQLite 的 session/trace 主键本就是 TEXT，无需迁移
    },
    /**
     * PostgreSQL 迁移：把 telemetry 相关表的 ID 列由 UUID 放宽为 VARCHAR(255)，
     * 以兼容外部 SDK 传入的自定义字符串会话 ID（如 `game:xxx:seat:1:werewolf`）。
     * 已有的 UUID 值对 VARCHAR 完全兼容，转换无损；仅当当前类型为 uuid 时才执行。
     * @param db - PostgreSQL 执行器
     * @returns 无返回值
     */
    applyPostgres: async (db: PostgresMigrationExecutor) => {
      // 仅会话 ID 由外部 SDK 传入（可能是 `game:xxx:seat:1:werewolf` 这类字符串）；
      // traces.id / messages.id 等主键仍由平台 uuidv4 生成，保持 UUID 不变。
      // sessions.id 被多张 telemetry 表外键引用，需先删除外键、改类型、再重建。

      // 1. 删除所有引用 sessions(id) 或 decisions(id) 的外键约束
      //    （主键类型变更前，必须先移除引用它的外键）
      const fkResult = await db.query<{ constraint_name: string; table_name: string }>(
        `SELECT tc.constraint_name, kcu.table_name
           FROM information_schema.table_constraints tc
           JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
           JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
          WHERE tc.constraint_type = 'FOREIGN KEY' AND ccu.table_name IN ('sessions', 'decisions')`,
      );
      for (const fk of fkResult.rows) {
        await db.query(`ALTER TABLE ${fk.table_name} DROP CONSTRAINT IF EXISTS ${fk.constraint_name}`);
      }

      // 2. 放宽 telemetry 相关 ID 列为 VARCHAR(255)（仅当当前为 uuid 时执行，幂等）。
      //    既包括外部 SDK 可传入的 session_id，也包括使用业务前缀的 decisions/decision_options 主键。
      const columns: Array<[string, string]> = [
        ['sessions', 'id'],
        ['decisions', 'id'],
        ['decisions', 'session_id'],
        ['decision_options', 'id'],
        ['decision_options', 'decision_id'],
        ['messages', 'session_id'],
        ['traces', 'session_id'],
        ['tool_calls', 'session_id'],
        ['spans', 'session_id'],
      ];
      for (const [table, column] of columns) {
        const result = await db.query<{ is_uuid: boolean }>(
          `SELECT EXISTS (
             SELECT 1 FROM information_schema.columns
             WHERE table_name = $1 AND column_name = $2 AND data_type = 'uuid'
           ) AS is_uuid`,
          [table, column],
        );
        if (result.rows[0]?.is_uuid) {
          await db.query(`ALTER TABLE ${table} ALTER COLUMN ${column} TYPE VARCHAR(255) USING ${column}::text`);
        }
      }

      // 3. 重建子表到 sessions(id) 的外键（NO ACTION，字符串/UUID 会话 ID 均可）
      const sessionChildren: Array<[string, string]> = [
        ['messages', 'session_id'],
        ['traces', 'session_id'],
        ['tool_calls', 'session_id'],
        ['decisions', 'session_id'],
        ['spans', 'session_id'],
      ];
      for (const [table, column] of sessionChildren) {
        await db.query(
          `DO $$ BEGIN
             IF NOT EXISTS (
               SELECT 1 FROM information_schema.table_constraints
               WHERE constraint_name = 'fk_${table}_sessions' AND constraint_type = 'FOREIGN KEY'
             ) THEN
               ALTER TABLE ${table} ADD CONSTRAINT fk_${table}_sessions
                 FOREIGN KEY (${column}) REFERENCES sessions(id);
             END IF;
           END $$;`,
        );
      }

      // 4. 重建 decision_options 到 decisions(id) 的外键
      await db.query(
        `DO $$ BEGIN
           IF NOT EXISTS (
             SELECT 1 FROM information_schema.table_constraints
             WHERE constraint_name = 'fk_decision_options_decisions' AND constraint_type = 'FOREIGN KEY'
           ) THEN
             ALTER TABLE decision_options ADD CONSTRAINT fk_decision_options_decisions
               FOREIGN KEY (decision_id) REFERENCES decisions(id) ON DELETE CASCADE;
           END IF;
         END $$;`,
      );
    },
  },
  {
    id: 'p015_stats_performance_indexes',
    description: '统计性能：为 traces/sessions 高频聚合补齐复合索引',
    /**
     * SQLite 迁移：复合索引已在 initSqliteSchema 中以 CREATE INDEX IF NOT EXISTS 创建，此处幂等跳过。
     * @param _db - SQLite 原生连接（未使用）
     * @returns 无返回值
     */
    applySqlite: (_db: Database.Database) => {
      // 索引由 sqlite.ts 的 initSqliteSchema 统一创建，迁移台账仅记录版本。
    },
    /**
     * PostgreSQL 迁移：补齐按项目过滤后按时间/状态/类型聚合的复合索引。
     * @param db - PostgreSQL 执行器
     * @returns 无返回值
     */
    applyPostgres: async (db: PostgresMigrationExecutor) => {
      await db.query(`CREATE INDEX IF NOT EXISTS idx_traces_project_started ON traces(project_id, started_at DESC)`);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_traces_project_status ON traces(project_id, status)`);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_traces_project_type ON traces(project_id, trace_type)`);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_sessions_project_started ON sessions(project_id, started_at DESC)`);
    },
  },
];

/**
 * 为 SQLite 中已存在的 dataset_versions 回填逐样本快照。
 * 解析老版本 item_data（DatasetItem 数组），按稳定顺序生成 case_key 与 content_hash。
 * @param db - SQLite 原生连接
 * @returns 无返回值
 */
function backfillSqliteDatasetVersionItems(db: Database.Database): void {
  const versions = db.prepare('SELECT id, item_data FROM dataset_versions').all() as Array<{ id: string; item_data: string }>;
  const insert = db.prepare(`
    INSERT OR IGNORE INTO dataset_version_items
      (id, dataset_version_id, dataset_item_id, case_key, input_data, expected_data, fields, metadata, content_hash, ordinal)
    VALUES (lower(hex(randomblob(16))), @versionId, @itemId, @caseKey, @input, @expected, @fields, @metadata, @hash, @ordinal)
  `);
  for (const version of versions) {
    let items: Array<Record<string, unknown>> = [];
    try {
      items = JSON.parse(version.item_data) as Array<Record<string, unknown>>;
    } catch {
      continue;
    }
    if (!Array.isArray(items)) continue;
    items.forEach((item, index) => {
      const input = item.input as string;
      const expected = (item.expected_output as string | null) ?? null;
      const fields = item.fields ? JSON.stringify(item.fields) : null;
      const metadata = item.metadata ? JSON.stringify(item.metadata) : null;
      const hash = createHash('sha256').update(`${input}\u0000${expected ?? ''}`).digest('hex');
      const caseKey = (item.id as string) ?? `case_${index + 1}`;
      insert.run({
        versionId: version.id,
        itemId: (item.id as string) ?? null,
        caseKey,
        input: JSON.stringify({ query: input }),
        expected: expected ? JSON.stringify({ answer: expected }) : null,
        fields,
        metadata,
        hash,
        ordinal: index,
      });
    });
  }
}

/**
 * 为 PostgreSQL 中已存在的 dataset_versions 回填逐样本快照。
 * @param db - PostgreSQL 执行器
 * @returns 无返回值
 */
async function backfillPostgresDatasetVersionItems(db: PostgresMigrationExecutor): Promise<void> {
  const versions = await db.query<{ id: string; item_data: unknown }>('SELECT id, item_data FROM dataset_versions');
  for (const version of versions.rows) {
    const raw = version.item_data;
    let items: Array<Record<string, unknown>> = [];
    try {
      items = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Array<Record<string, unknown>>;
    } catch {
      continue;
    }
    if (!Array.isArray(items)) continue;
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      const input = item.input as string;
      const expected = (item.expected_output as string | null) ?? null;
      const fields = item.fields ? JSON.stringify(item.fields) : null;
      const metadata = item.metadata ? JSON.stringify(item.metadata) : null;
      const hash = createHash('sha256').update(`${input}\u0000${expected ?? ''}`).digest('hex');
      const caseKey = (item.id as string) ?? `case_${index + 1}`;
      await db.query(
        `INSERT INTO dataset_version_items
           (dataset_version_id, dataset_item_id, case_key, input_data, expected_data, fields, metadata, content_hash, ordinal)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, $8, $9)
         ON CONFLICT (dataset_version_id, case_key) DO NOTHING`,
        [
          version.id,
          (item.id as string) ?? null,
          caseKey,
          JSON.stringify({ query: input }),
          expected ? JSON.stringify({ answer: expected }) : null,
          fields,
          metadata,
          hash,
          index,
        ]
      );
    }
  }
}

/**
 * 执行 SQLite 迁移
 * @param db - SQLite 原生连接
 * @returns 无返回值
 */
export async function applySqliteMigrations(db: Database.Database): Promise<void> {
  ensureSqliteMigrationTable(db);

  for (const migration of MIGRATIONS) {
    const applied = db
      .prepare('SELECT 1 FROM schema_migrations WHERE id = ?')
      .get(migration.id) as { 1: number } | undefined;
    if (applied) {
      continue;
    }

    const applyMigration = db.transaction(() => {
      migration.applySqlite(db);
      db.prepare('INSERT INTO schema_migrations (id, description) VALUES (?, ?)').run(
        migration.id,
        migration.description
      );
    });
    applyMigration();
  }
}

/**
 * 执行 PostgreSQL 迁移
 * @param db - PostgreSQL 执行器
 * @returns 无返回值
 */
export async function applyPostgresMigrations(db: PostgresMigrationExecutor): Promise<void> {
  await ensurePostgresMigrationTable(db);

  for (const migration of MIGRATIONS) {
    const result = await db.query<{ id: string }>('SELECT id FROM schema_migrations WHERE id = $1', [migration.id]);
    if (result.rows.length > 0) {
      continue;
    }

    await db.query('BEGIN');
    try {
      await migration.applyPostgres(db);
      await db.query('INSERT INTO schema_migrations (id, description) VALUES ($1, $2)', [
        migration.id,
        migration.description,
      ]);
      await db.query('COMMIT');
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    }
  }
}

/**
 * 获取已注册迁移列表
 * @returns 返回迁移元数据数组
 */
export function getRegisteredMigrations(): Array<{ id: string; description: string }> {
  return MIGRATIONS.map(({ id, description }) => ({ id, description }));
}
