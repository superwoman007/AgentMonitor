import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { applySqliteMigrations, getRegisteredMigrations } from '../src/db/migration-registry.js';
import { initSqliteSchema } from '../src/db/sqlite.js';

describe('Database Migration Infrastructure (PR-01 + PR-07)', () => {
  let db: Database.Database | null = null;

  afterEach(() => {
    if (db) {
      db.close();
      db = null;
    }
  });

  it('should bootstrap migration ledger on fresh sqlite schema', async () => {
    db = new Database(':memory:');

    await initSqliteSchema(db);
    await applySqliteMigrations(db);

    const table = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
      .get() as { name: string } | undefined;
    const rows = db
      .prepare('SELECT id, description FROM schema_migrations ORDER BY id')
      .all() as Array<{ id: string; description: string }>;

    expect(table?.name).toBe('schema_migrations');
    expect(rows).toEqual([
      {
        id: 'p001_legacy_bootstrap',
        description: '建立 schema_migrations 并接管历史基线',
      },
      {
        id: 'p002_telemetry_v2',
        description: 'Telemetry V2：事件幂等台账与 traces.trace_id 唯一索引',
      },
      {
        id: 'p003_target_domain',
        description: 'Target 领域：agent_targets 与不可变 agent_target_versions',
      },
      {
        id: 'p004_dataset_items_and_suites',
        description: 'PR-07：DatasetVersionItem 逐样本快照与 Evaluator Suite/Version/Member',
      },
      {
        id: 'p005_experiment_run_separation',
        description: 'PR-08：Experiment/Run 分离，新增 evaluation_runs/run_items/scores/run_events 与 Experiment 新列',
      },
      {
        id: 'p006_service_tokens_runner_sessions',
        description: 'PR-10：Service Token（scopes）与 Runner Session 表',
      },
      {
        id: 'p007_prompt_deployments',
        description: 'PR-12：Prompt Deployment（project+prompt+environment → promptVersionId）与 Runtime 指针',
      },
      {
        id: 'p008_scheduled_runs',
        description: 'PR-13：Scheduled Run 定时回归调度表（interval/cron + next_run_at 到期扫描）',
      },
      {
        id: 'p009_trace_sampling_rules',
        description: 'PR-13：Trace Sampling 采样规则与采样回流台账（trace 去重水位）',
      },
      {
        id: 'p010_persistent_alert_rules',
        description: 'PR-13：持久化 Alert Rule（Run 回归/失败/Webhook）与 alert_events 投递台账',
      },
      {
        id: 'p011_trace_annotations',
        description: 'P1：Trace 人工标注（根因分类 prompt/model/tool/retrieval/data/evaluator/unknown + 结论）',
      },
      {
        id: 'p012_prompt_ab_variants',
        description: 'P1：Prompt A/B 实验流量分桶（project+prompt+environment 多 variant + 权重）',
      },
      {
        id: 'p013_scheduled_run_executions',
        description: 'DoD-11：Scheduled Run 执行历史表（started/completed/status/error/next_run_at 快照）',
      },
      {
        id: 'p014_telemetry_id_varchar',
        description: 'Telemetry 主键/外键放宽为 VARCHAR：兼容 SDK 自定义字符串 sessionId/traceId',
      },
      {
        id: 'p015_stats_performance_indexes',
        description: '统计性能：为 traces/sessions 高频聚合补齐复合索引',
      },
    ]);
  });

  it('should upgrade legacy sqlite schema idempotently', async () => {
    db = new Database(':memory:');

    // 模拟升级路径：旧库只有历史 schema，没有 schema_migrations 台账
    await initSqliteSchema(db);

    await applySqliteMigrations(db);
    await applySqliteMigrations(db);

    const rows = db
      .prepare('SELECT id FROM schema_migrations ORDER BY id')
      .all() as Array<{ id: string }>;

    expect(rows.map((row) => row.id)).toEqual([
      'p001_legacy_bootstrap',
      'p002_telemetry_v2',
      'p003_target_domain',
      'p004_dataset_items_and_suites',
      'p005_experiment_run_separation',
      'p006_service_tokens_runner_sessions',
      'p007_prompt_deployments',
      'p008_scheduled_runs',
      'p009_trace_sampling_rules',
      'p010_persistent_alert_rules',
      'p011_trace_annotations',
      'p012_prompt_ab_variants',
      'p013_scheduled_run_executions',
      'p014_telemetry_id_varchar',
      'p015_stats_performance_indexes',
    ]);
  });

  it('should expose ordered migration registry metadata', () => {
    expect(getRegisteredMigrations().map((m) => m.id)).toEqual([
      'p001_legacy_bootstrap',
      'p002_telemetry_v2',
      'p003_target_domain',
      'p004_dataset_items_and_suites',
      'p005_experiment_run_separation',
      'p006_service_tokens_runner_sessions',
      'p007_prompt_deployments',
      'p008_scheduled_runs',
      'p009_trace_sampling_rules',
      'p010_persistent_alert_rules',
      'p011_trace_annotations',
      'p012_prompt_ab_variants',
      'p013_scheduled_run_executions',
      'p014_telemetry_id_varchar',
      'p015_stats_performance_indexes',
    ]);
  });

  it('p004 为历史 DatasetVersion 回填逐样本快照，并保证 (version_id, case_key) 唯一', async () => {
    db = new Database(':memory:');
    await initSqliteSchema(db);

    // 构造一个项目、数据集与一条历史 DatasetVersion（老 item_data 数组）
    db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)").run('u-1', 'a@b.c', 'x');
    db.prepare("INSERT INTO projects (id, user_id, name) VALUES (?, ?, ?)").run('proj-1', 'u-1', 'P');
    db.prepare("INSERT INTO datasets (id, project_id, name) VALUES (?, ?, ?)").run('ds-1', 'proj-1', 'DS');
    const legacyItems = [
      { id: 'case-a', input: '问题A', expected_output: '答案A', fields: null, metadata: null },
      { id: 'case-b', input: '问题B', expected_output: null, fields: { tag: 'x' }, metadata: null },
    ];
    db.prepare(
      `INSERT INTO dataset_versions (id, dataset_id, version_number, item_data, item_count)
       VALUES (?, ?, 1, ?, ?)`
    ).run('dv-1', 'ds-1', JSON.stringify(legacyItems), legacyItems.length);

    await applySqliteMigrations(db);

    const items = db
      .prepare(
        `SELECT case_key, input_data, expected_data, content_hash, ordinal
           FROM dataset_version_items WHERE dataset_version_id = ? ORDER BY ordinal`
      )
      .all('dv-1') as Array<{
        case_key: string;
        input_data: string;
        expected_data: string | null;
        content_hash: string;
        ordinal: number;
      }>;

    expect(items).toHaveLength(2);
    expect(items[0].case_key).toBe('case-a');
    expect(JSON.parse(items[0].input_data)).toEqual({ query: '问题A' });
    expect(JSON.parse(items[0].expected_data!)).toEqual({ answer: '答案A' });
    expect(items[0].ordinal).toBe(0);
    expect(items[0].content_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(items[1].case_key).toBe('case-b');
    expect(items[1].expected_data).toBeNull();

    // 重新执行迁移不报错、不重复插入
    await expect(applySqliteMigrations(db)).resolves.toBeUndefined();
    const count = db
      .prepare('SELECT COUNT(*) as c FROM dataset_version_items WHERE dataset_version_id = ?')
      .get('dv-1') as { c: number };
    expect(count.c).toBe(2);
  });
});
