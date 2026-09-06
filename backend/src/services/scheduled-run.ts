import { randomUUID } from 'crypto';
import { toDbBool, SQL_TRUE, query, queryOne, run } from '../db/index.js';
import { getExperimentById } from './evaluation.js';
import { prepareRun, type RunPreparation } from './evaluation-run.js';

/**
 * ScheduledRun 实体：挂在 Experiment 下的定时回归计划。
 * schedule_type=interval 时使用 interval_minutes；schedule_type=cron 时使用 5 段 cron_expr。
 */
export interface ScheduledRun {
  id: string;
  project_id: string;
  experiment_id: string;
  name: string;
  schedule_type: 'interval' | 'cron';
  interval_minutes: number | null;
  cron_expr: string | null;
  enabled: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
  last_run_id: string | null;
  last_status: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * ScheduledRunExecution：一次调度触发尝试的执行记录。
 * 这里记录的是“调度器是否成功创建出 Run”的历史，而不是 Run 自身的评测明细。
 */
export interface ScheduledRunExecution {
  id: string;
  schedule_id: string;
  project_id: string;
  experiment_id: string;
  trigger_mode: 'scheduled' | 'manual';
  status: 'running' | 'created' | 'failed';
  run_id: string | null;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
  next_run_at: string | null;
  created_at: string;
}

/**
 * 创建 ScheduledRun 的输入。
 */
export interface CreateScheduledRunInput {
  projectId: string;
  experimentId: string;
  name: string;
  scheduleType: 'interval' | 'cron';
  intervalMinutes?: number;
  cronExpr?: string;
  enabled?: boolean;
  createdBy?: string;
  firstRunAt?: Date;
}

/**
 * 更新 ScheduledRun 的输入。
 */
export interface UpdateScheduledRunInput {
  name?: string;
  scheduleType?: 'interval' | 'cron';
  intervalMinutes?: number;
  cronExpr?: string;
  enabled?: boolean;
}

/**
 * 单个 cron 字段解析结果：要么是通配，要么是合法分钟/小时/...的数字集合。
 */
type CronField = Set<number> | '*';

/**
 * 解析后的 5 段 cron：minute / hour / dayOfMonth / month / dayOfWeek。
 */
interface ParsedCron {
  minute: CronField;
  hour: CronField;
  dom: CronField;
  month: CronField;
  dow: CronField;
}

const CRON_MIN_INTERVAL_MS = 60_000;

/**
 * 校验调度参数合法性。interval 模式要求 intervalMinutes>=1，cron 模式要求 5 段表达式。
 * @param scheduleType - interval / cron
 * @param intervalMinutes - 间隔分钟
 * @param cronExpr - cron 表达式
 */
function validateSchedule(
  scheduleType: 'interval' | 'cron',
  intervalMinutes: number | undefined,
  cronExpr: string | undefined
): void {
  if (scheduleType === 'interval') {
    if (!intervalMinutes || !Number.isFinite(intervalMinutes) || intervalMinutes < 1) {
      throw new Error('intervalMinutes must be a positive integer when scheduleType=interval');
    }
  } else if (scheduleType === 'cron') {
    if (!cronExpr) throw new Error('cronExpr required when scheduleType=cron');
    parseCron(cronExpr);
  }
}

/**
 * 解析单个 cron 字段。
 * 支持：* / 数字 / 逗号列表 / a-b 区间 / *\/step 与 a-b/step 步长。
 * @param raw - 字段原始文本
 * @param min - 字段下限
 * @param max - 字段上限
 * @returns CronField
 */
function parseField(raw: string, min: number, max: number): CronField {
  const value = raw.trim();
  if (value === '*') return '*';

  const result = new Set<number>();
  for (const part of value.split(',')) {
    const seg = part.trim();
    if (!seg) throw new Error(`empty cron field segment in "${raw}"`);
    let range = seg;
    let step = 1;
    if (seg.includes('/')) {
      const [rangePart, stepPart] = seg.split('/');
      range = rangePart;
      step = Number.parseInt(stepPart, 10);
      if (!Number.isFinite(step) || step < 1) throw new Error(`invalid step in "${seg}"`);
    }
    let from = min;
    let to = max;
    if (range !== '*') {
      if (range.includes('-')) {
        const [a, b] = range.split('-');
        from = Number.parseInt(a, 10);
        to = Number.parseInt(b, 10);
      } else {
        from = Number.parseInt(range, 10);
        to = from;
      }
    }
    if (!Number.isFinite(from) || !Number.isFinite(to) || from < min || to > max || from > to) {
      throw new Error(`cron field "${raw}" out of range [${min},${max}]`);
    }
    for (let n = from; n <= to; n += step) result.add(n);
  }
  return result;
}

/**
 * 解析并校验 5 段 cron 表达式。
 * 字段顺序：minute hour day-of-month month day-of-week。
 * @param expr - 原始 cron 表达式
 * @returns 解析后的 ParsedCron
 */
export function parseCron(expr: string): ParsedCron {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`cron expression must have 5 fields, got ${parts.length}`);
  }
  return {
    minute: parseField(parts[0], 0, 59),
    hour: parseField(parts[1], 0, 23),
    dom: parseField(parts[2], 1, 31),
    month: parseField(parts[3], 1, 12),
    dow: parseField(parts[4], 0, 6),
  };
}

/**
 * 判断字段是否命中。
 * @param field - 解析后的字段
 * @param value - 当前时间分量
 * @returns 是否匹配
 */
function matches(field: CronField, value: number): boolean {
  return field === '*' || field.has(value);
}

/**
 * 从给定时间向后查找下一次 cron 触发时刻（UTC，精确到分钟）。
 * 最多扫描 366 * 24 * 60 个分钟点，找不到抛错。
 * @param cron - 解析后的 cron
 * @param from - 起始时间（默认当前）
 * @returns 下一次触发时间
 */
export function nextCronDate(cron: ParsedCron, from: Date = new Date()): Date {
  const d = new Date(from.getTime());
  d.setUTCSeconds(0, 0);
  if (d.getTime() <= from.getTime()) d.setUTCMinutes(d.getUTCMinutes() + 1);

  const maxIterations = 366 * 24 * 60;
  for (let i = 0; i < maxIterations; i += 1) {
    if (
      matches(cron.month, d.getUTCMonth() + 1) &&
      matches(cron.dom, d.getUTCDate()) &&
      matches(cron.dow, d.getUTCDay()) &&
      matches(cron.hour, d.getUTCHours()) &&
      matches(cron.minute, d.getUTCMinutes())
    ) {
      return new Date(d.getTime());
    }
    d.setUTCMinutes(d.getUTCMinutes() + 1);
  }
  throw new Error('unable to compute next cron date within a year window');
}

/**
 * 计算下一次运行时间。
 * - interval: last + intervalMin；首次为 base + intervalMin
 * - cron: 从 base 向后解析
 * @param schedule - 调度记录
 * @param base - 基准时间
 * @returns 下一次运行时间
 */
export function computeNextRun(schedule: ScheduledRun, base: Date = new Date()): Date {
  if (schedule.schedule_type === 'interval') {
    const minutes = schedule.interval_minutes ?? 0;
    if (minutes < 1) throw new Error('interval schedule has invalid interval_minutes');
    const baseMs = schedule.last_run_at ? new Date(schedule.last_run_at).getTime() : base.getTime();
    let next = baseMs + minutes * 60_000;
    if (next < base.getTime() + CRON_MIN_INTERVAL_MS) next = base.getTime() + CRON_MIN_INTERVAL_MS;
    return new Date(next);
  }
  if (!schedule.cron_expr) throw new Error('cron schedule missing cron_expr');
  return nextCronDate(parseCron(schedule.cron_expr), base);
}

/**
 * 列出项目下所有 ScheduledRun。
 * @param projectId - 项目 ID
 * @returns 调度列表
 */
export async function listScheduledRuns(projectId: string): Promise<ScheduledRun[]> {
  return query<ScheduledRun>(
    `SELECT * FROM scheduled_runs
      WHERE project_id = $1
      ORDER BY created_at DESC`,
    [projectId]
  );
}

/**
 * 列出某条 ScheduledRun 的执行历史，按 started_at 倒序返回。
 * @param projectId - 项目 ID
 * @param scheduleId - 调度 ID
 * @param limit - 返回条数上限
 * @returns 执行历史
 */
export async function listScheduledRunExecutions(
  projectId: string,
  scheduleId: string,
  limit = 20
): Promise<ScheduledRunExecution[]> {
  const safeLimit = Math.max(1, Math.min(limit, 100));
  return query<ScheduledRunExecution>(
    `SELECT * FROM scheduled_run_executions
      WHERE project_id = $1 AND schedule_id = $2
      ORDER BY started_at DESC
      LIMIT ${safeLimit}`,
    [projectId, scheduleId]
  );
}

/**
 * 按 Experiment 列出 ScheduledRun。
 * @param projectId - 项目 ID
 * @param experimentId - 实验 ID
 * @returns 调度列表
 */
export async function listScheduledRunsByExperiment(
  projectId: string,
  experimentId: string
): Promise<ScheduledRun[]> {
  return query<ScheduledRun>(
    `SELECT * FROM scheduled_runs
      WHERE project_id = $1 AND experiment_id = $2
      ORDER BY created_at DESC`,
    [projectId, experimentId]
  );
}

/**
 * 读取单个 ScheduledRun。
 * @param projectId - 项目 ID
 * @param id - 调度 ID
 * @returns ScheduledRun 或 null
 */
export async function getScheduledRun(projectId: string, id: string): Promise<ScheduledRun | null> {
  return queryOne<ScheduledRun>(
    `SELECT * FROM scheduled_runs WHERE project_id = $1 AND id = $2`,
    [projectId, id]
  );
}

/**
 * 创建 ScheduledRun。会根据调度参数预计算 next_run_at。
 * @param input - 创建参数
 * @returns 新的 ScheduledRun
 */
export async function createScheduledRun(input: CreateScheduledRunInput): Promise<ScheduledRun> {
  validateSchedule(input.scheduleType, input.intervalMinutes, input.cronExpr);
  const experiment = await getExperimentById(input.experimentId);
  if (!experiment || experiment.project_id !== input.projectId) {
    throw new Error('Experiment not found');
  }

  const id = randomUUID();
  const now = new Date();
  const base = input.firstRunAt ?? now;
  const enabled = input.enabled ?? true;

  const draft: ScheduledRun = {
    id,
    project_id: input.projectId,
    experiment_id: input.experimentId,
    name: input.name.trim(),
    schedule_type: input.scheduleType,
    interval_minutes: input.scheduleType === 'interval' ? input.intervalMinutes! : null,
    cron_expr: input.scheduleType === 'cron' ? input.cronExpr!.trim() : null,
    enabled,
    last_run_at: null,
    next_run_at: null,
    last_run_id: null,
    last_status: null,
    created_by: input.createdBy ?? null,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
  };
  const nextRun = enabled ? computeNextRun(draft, base) : null;
  draft.next_run_at = nextRun ? nextRun.toISOString() : null;

  await run(
    `INSERT INTO scheduled_runs
       (id, project_id, experiment_id, name, schedule_type, interval_minutes, cron_expr,
        enabled, last_run_at, next_run_at, last_run_id, last_status, created_by, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [
      draft.id,
      draft.project_id,
      draft.experiment_id,
      draft.name,
      draft.schedule_type,
      draft.interval_minutes,
      draft.cron_expr,
      toDbBool(draft.enabled),
      draft.last_run_at,
      draft.next_run_at,
      draft.last_run_id,
      draft.last_status,
      draft.created_by,
      draft.created_at,
      draft.updated_at,
    ]
  );
  return draft;
}

/**
 * 更新 ScheduledRun 的可变字段，并在调度规则或启用状态变化时重算 next_run_at。
 * @param projectId - 项目 ID
 * @param id - 调度 ID
 * @param patch - 更新字段
 * @returns 更新后的 ScheduledRun，不存在返回 null
 */
export async function updateScheduledRun(
  projectId: string,
  id: string,
  patch: UpdateScheduledRunInput
): Promise<ScheduledRun | null> {
  const existing = await getScheduledRun(projectId, id);
  if (!existing) return null;

  const merged: ScheduledRun = { ...existing };
  let recompute = false;
  if (patch.name !== undefined) merged.name = patch.name.trim();
  if (patch.scheduleType !== undefined) {
    merged.schedule_type = patch.scheduleType;
    recompute = true;
  }
  if (patch.intervalMinutes !== undefined) {
    merged.interval_minutes = patch.intervalMinutes;
    recompute = true;
  }
  if (patch.cronExpr !== undefined) {
    merged.cron_expr = patch.cronExpr;
    recompute = true;
  }
  if (patch.enabled !== undefined) {
    merged.enabled = patch.enabled;
    recompute = true;
  }
  validateSchedule(merged.schedule_type, merged.interval_minutes ?? undefined, merged.cron_expr ?? undefined);

  if (recompute) {
    merged.next_run_at = merged.enabled ? computeNextRun(merged, new Date()).toISOString() : null;
  }
  merged.updated_at = new Date().toISOString();

  await run(
    `UPDATE scheduled_runs
        SET name = $3,
            schedule_type = $4,
            interval_minutes = $5,
            cron_expr = $6,
            enabled = $7,
            next_run_at = $8,
            updated_at = $9
      WHERE id = $1 AND project_id = $2`,
    [
      merged.id,
      merged.project_id,
      merged.name,
      merged.schedule_type,
      merged.interval_minutes,
      merged.cron_expr,
      toDbBool(merged.enabled),
      merged.next_run_at,
      merged.updated_at,
    ]
  );
  return merged;
}

/**
 * 删除 ScheduledRun。
 * @param projectId - 项目 ID
 * @param id - 调度 ID
 * @returns 是否删除成功
 */
export async function deleteScheduledRun(projectId: string, id: string): Promise<boolean> {
  const result = await run(
    `DELETE FROM scheduled_runs WHERE project_id = $1 AND id = $2`,
    [projectId, id]
  );
  return result.changes > 0;
}

/**
 * 原子地领取一条到期调度：通过条件 UPDATE 将 next_run_at 设为下一次时间，
 * 同时返回该调度。配合 SQLite/Postgres 行锁可防止多 Worker 重复触发。
 * @param now - 当前时间
 * @returns 被领取的调度，没有到期项返回 null
 */
export async function claimDueScheduledRun(now: Date = new Date()): Promise<ScheduledRun | null> {
  const due = await queryOne<ScheduledRun>(
    `SELECT * FROM scheduled_runs
      WHERE enabled = ${SQL_TRUE} AND next_run_at IS NOT NULL AND next_run_at <= $1
      ORDER BY next_run_at ASC
      LIMIT 1`,
    [now.toISOString()]
  );
  if (!due) return null;

  let nextAt: Date;
  try {
    nextAt = computeNextRun(due, now);
  } catch {
    nextAt = new Date(now.getTime() + 60_000);
  }

  const claimed = await queryOne<ScheduledRun>(
    `UPDATE scheduled_runs
        SET next_run_at = $3,
            last_run_at = $4,
            last_status = 'running',
            updated_at = $4
      WHERE id = $1 AND next_run_at = $2
      RETURNING *`,
    [due.id, due.next_run_at, nextAt.toISOString(), now.toISOString()]
  );
  return claimed;
}

/**
 * 记录一次调度触发结果。
 * @param scheduleId - 调度 ID
 * @param runId - 触发产生的 Run ID
 * @param status - 结果状态
 * @param now - 时间戳
 */
export async function recordScheduledRunOutcome(
  scheduleId: string,
  runId: string | null,
  status: 'created' | 'failed',
  now: Date = new Date()
): Promise<void> {
  await run(
    `UPDATE scheduled_runs
        SET last_run_id = $2, last_status = $3, updated_at = $4
      WHERE id = $1`,
    [scheduleId, runId, status, now.toISOString()]
  );
}

/**
 * 创建一条执行历史，表示本次调度触发已经开始。
 * @param schedule - 调度记录
 * @param triggerMode - 触发来源：自动调度 / 立即运行
 * @param startedAt - 开始时间
 * @returns 新建的执行记录
 */
export async function startScheduledRunExecution(
  schedule: ScheduledRun,
  triggerMode: 'scheduled' | 'manual',
  startedAt: Date = new Date()
): Promise<ScheduledRunExecution> {
  const id = randomUUID();
  const timestamp = startedAt.toISOString();
  const row = await queryOne<ScheduledRunExecution>(
    `INSERT INTO scheduled_run_executions
       (id, schedule_id, project_id, experiment_id, trigger_mode, status, run_id,
        error_message, started_at, completed_at, next_run_at, created_at)
     VALUES ($1, $2, $3, $4, $5, 'running', NULL, NULL, $6, NULL, $7, $6)
     RETURNING *`,
    [
      id,
      schedule.id,
      schedule.project_id,
      schedule.experiment_id,
      triggerMode,
      timestamp,
      schedule.next_run_at,
    ]
  );
  if (!row) {
    throw new Error('Failed to create scheduled run execution');
  }
  return row;
}

/**
 * 完成一条执行历史，回填 Run ID / 错误信息 / 最终状态。
 * @param executionId - 执行历史 ID
 * @param input - 完成信息
 * @param completedAt - 完成时间
 */
export async function completeScheduledRunExecution(
  executionId: string,
  input: {
    status: 'created' | 'failed';
    runId?: string | null;
    errorMessage?: string | null;
    nextRunAt?: string | null;
  },
  completedAt: Date = new Date()
): Promise<void> {
  await run(
    `UPDATE scheduled_run_executions
        SET status = $2,
            run_id = $3,
            error_message = $4,
            completed_at = $5,
            next_run_at = $6
      WHERE id = $1`,
    [
      executionId,
      input.status,
      input.runId ?? null,
      input.errorMessage ?? null,
      completedAt.toISOString(),
      input.nextRunAt ?? null,
    ]
  );
}

/**
 * 触发一次调度：调用 prepareRun 生成 V2 Run，并把结果回写到 scheduled_runs。
 * @param schedule - 已领取的调度
 * @returns prepareRun 的结果，失败返回 null
 */
export async function triggerScheduledRun(
  schedule: ScheduledRun,
  triggerMode: 'scheduled' | 'manual' = 'scheduled'
): Promise<RunPreparation | null> {
  const execution = await startScheduledRunExecution(schedule, triggerMode);
  try {
    const prep = await prepareRun(schedule.experiment_id, {
      triggerType: 'scheduled',
      triggerRef: schedule.id,
      idempotencyKey: `sched-${schedule.id}-${Date.now()}`,
    });
    await recordScheduledRunOutcome(schedule.id, prep.run.id, 'created');
    await completeScheduledRunExecution(execution.id, {
      status: 'created',
      runId: prep.run.id,
      nextRunAt: schedule.next_run_at,
    });
    return prep;
  } catch (error) {
    await recordScheduledRunOutcome(schedule.id, null, 'failed').catch(() => {
      /* 状态回写失败不影响主流程 */
    });
    await completeScheduledRunExecution(execution.id, {
      status: 'failed',
      errorMessage: error instanceof Error ? error.message : String(error),
      nextRunAt: schedule.next_run_at,
    }).catch(() => {
      /* 执行历史写失败不影响主流程 */
    });
    // eslint-disable-next-line no-console
    console.error('[scheduled-run] trigger failed', {
      scheduleId: schedule.id,
      experimentId: schedule.experiment_id,
      error: (error as Error).message,
    });
    return null;
  }
}

/**
 * 仅供测试：清空 scheduled_runs 表。
 */
export async function __clearScheduledRunsForTests(): Promise<void> {
  await run('DELETE FROM scheduled_run_executions', []);
  await run('DELETE FROM scheduled_runs', []);
}
