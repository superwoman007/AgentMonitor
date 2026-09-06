import { describe, expect, it } from 'vitest';
import {
  computeNextRun,
  nextCronDate,
  parseCron,
  type ScheduledRun,
} from '../src/services/scheduled-run.js';

/**
 * 构造 ScheduledRun 草稿，仅供 computeNextRun 测试使用。
 * @param overrides - 覆盖字段
 * @returns ScheduledRun 样例
 */
function makeSchedule(overrides: Partial<ScheduledRun> = {}): ScheduledRun {
  return {
    id: 'sched-test',
    project_id: 'proj-1',
    experiment_id: 'exp-1',
    name: 'test',
    schedule_type: 'interval',
    interval_minutes: 30,
    cron_expr: null,
    enabled: true,
    last_run_at: null,
    next_run_at: null,
    last_run_id: null,
    last_status: null,
    created_by: null,
    created_at: new Date('2026-01-01T00:00:00Z').toISOString(),
    updated_at: new Date('2026-01-01T00:00:00Z').toISOString(),
    ...overrides,
  };
}

describe('PR-13a：cron 表达式解析与下次运行时间计算', () => {
  it('parseCron 支持 * 与数字区间', () => {
    const cron = parseCron('0 9 * * 1-5');
    expect(cron.minute).toEqual(new Set([0]));
    expect(cron.hour).toEqual(new Set([9]));
    expect(cron.dom).toBe('*');
    expect(cron.month).toBe('*');
    expect(cron.dow).toEqual(new Set([1, 2, 3, 4, 5]));
  });

  it('parseCron 支持步长 */15 与 */2', () => {
    const cron = parseCron('*/15 */2 * * *');
    expect(cron.minute).toEqual(new Set([0, 15, 30, 45]));
    expect(cron.hour).toEqual(new Set([0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22]));
  });

  it('parseCron 拒绝非法字段数与越界值', () => {
    expect(() => parseCron('* * *')).toThrow(/5 fields/);
    expect(() => parseCron('99 * * * *')).toThrow(/out of range/);
    expect(() => parseCron('* 25 * * *')).toThrow(/out of range/);
  });

  it('nextCronDate：每天 02:30 从当天 01:00 起算命中当天 02:30', () => {
    const cron = parseCron('30 2 * * *');
    const next = nextCronDate(cron, new Date('2026-03-10T01:00:00Z'));
    expect(next.toISOString()).toBe('2026-03-10T02:30:00.000Z');
  });

  it('nextCronDate：周一至周五 09:00，周六起算跳到下周一', () => {
    const cron = parseCron('0 9 * * 1-5');
    // 2026-03-14 是周六（UTC）
    const next = nextCronDate(cron, new Date('2026-03-14T10:00:00Z'));
    expect(next.toISOString()).toBe('2026-03-16T09:00:00.000Z');
  });

  it('nextCronDate：每月 1 号 00:00，1 月中起算跳到 2 月 1 号', () => {
    const cron = parseCron('0 0 1 * *');
    const next = nextCronDate(cron, new Date('2026-01-15T12:00:00Z'));
    expect(next.toISOString()).toBe('2026-02-01T00:00:00.000Z');
  });

  it('computeNextRun：interval 首次运行为基准 + 间隔', () => {
    const schedule = makeSchedule({ interval_minutes: 15 });
    const next = computeNextRun(schedule, new Date('2026-03-10T00:00:00Z'));
    expect(next.getTime()).toBe(new Date('2026-03-10T00:15:00Z').getTime());
  });

  it('computeNextRun：interval 以上次运行为基准滚动', () => {
    const schedule = makeSchedule({
      interval_minutes: 60,
      last_run_at: '2026-03-10T08:00:00.000Z',
    });
    const next = computeNextRun(schedule, new Date('2026-03-10T08:05:00Z'));
    expect(next.toISOString()).toBe('2026-03-10T09:00:00.000Z');
  });

  it('computeNextRun：cron 类型按表达式计算', () => {
    const schedule = makeSchedule({
      schedule_type: 'cron',
      interval_minutes: null,
      cron_expr: '0 10 * * *',
    });
    const next = computeNextRun(schedule, new Date('2026-03-10T03:00:00Z'));
    expect(next.toISOString()).toBe('2026-03-10T10:00:00.000Z');
  });
});
