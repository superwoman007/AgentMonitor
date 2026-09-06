import { hostname } from 'os';
import { randomUUID } from 'crypto';
import {
  type EvaluationRun,
  claimRunItem,
  requeueExpiredLeases,
  recoverStaleRunsOnStartup,
  finalizeCancellationIfReady,
  aggregateAndCompleteRun,
  getRunById,
  appendRunEvent,
  countIncompleteRunItems,
  cancelRunItem,
  listRunItems,
} from './evaluation-run.js';
import { processRunItem } from './evaluation-v2-runner.js';
import { getTargetVersionById, type AgentTargetVersion } from './agent-target.js';
import {
  getSuiteVersionById,
  listSuiteMembers,
  type EvaluatorSuiteVersion,
  type EvaluatorSuiteMember,
} from './evaluator-suite.js';
import { reapStaleRunnerSessions } from './runner-session.js';
import { claimDueScheduledRun, triggerScheduledRun } from './scheduled-run.js';
import { runAllSamplingScans } from './trace-sampling.js';
import { evaluateRunAlerts } from './alert-rule.js';

/**
 * Worker 唯一标识：hostname + pid + 随机后缀，便于日志排查。
 */
const WORKER_ID = `${hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`;

/**
 * 轮询周期：500ms 领取一次新任务。
 */
const POLL_INTERVAL_MS = 500;

/**
 * 回收周期：10s 扫描一次过期租约。
 */
const REAP_INTERVAL_MS = 10_000;

/**
 * 定时调度扫描周期：30s 扫描一次到期 ScheduledRun。
 */
const SCHEDULE_INTERVAL_MS = 30_000;

/**
 * Trace 采样回流扫描周期：60s 执行一次采样规则。
 */
const SAMPLING_INTERVAL_MS = 60_000;

/**
 * 单条 RunItem 的租约时长（秒）。心跳按 1/3 周期自动续租。
 */
const LEASE_SECONDS = 300;

/**
 * Worker 配置快照缓存：同一 Run 内重复处理 item 时不重复查库。
 */
interface RunContext {
  run: EvaluationRun;
  target: AgentTargetVersion;
  suite: EvaluatorSuiteVersion;
  members: EvaluatorSuiteMember[];
}

/**
 * EvaluationWorker 单例。负责：
 * - 应用启动时调用 recoverStaleRunsOnStartup 恢复崩溃现场
 * - 周期性 claim RunItem 并通过 processRunItem 执行
 * - 周期性扫描过期租约并重新入队（阶段感知：target 已完成的只补评分）
 * - 每条 item 完成后尝试 cancel-finalize / run-aggregate
 * - 通过 WebSocket 广播 evaluation.run.progress 事件
 *
 * P0 单进程内只启动一个 Worker；SQLite 写锁竞争由 claim 的条件 UPDATE 串行化。
 * 多副本部署时，每个进程独立 Worker，lease_owner 记录 hostname+pid 便于排查。
 */
class EvaluationWorker {
  private pollTimer: NodeJS.Timeout | null = null;
  private reapTimer: NodeJS.Timeout | null = null;
  private scheduleTimer: NodeJS.Timeout | null = null;
  private samplingTimer: NodeJS.Timeout | null = null;
  private running = false;
  private started = false;
  private scheduleRunning = false;
  private samplingRunning = false;
  private contextCache = new Map<string, RunContext>();
  private progressCounter = new Map<string, { completed: number; total: number }>();

  /**
   * 启动 Worker（幂等）。
   * - 立即执行一次启动恢复
   * - 安装 poll/reaper 定时器
   * @returns 启动后的 Worker 实例
   */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    try {
      const recovered = await recoverStaleRunsOnStartup();
      if (recovered > 0) {
        // eslint-disable-next-line no-console
        console.info(`[evaluation-worker] recovered ${recovered} stale run items on startup`);
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[evaluation-worker] startup recovery failed', error);
    }

    this.pollTimer = setInterval(() => {
      void this.tick().catch((error) => {
        // eslint-disable-next-line no-console
        console.error('[evaluation-worker] tick error', error);
      });
    }, POLL_INTERVAL_MS);
    this.reapTimer = setInterval(() => {
      void this.reap().catch((error) => {
        // eslint-disable-next-line no-console
        console.error('[evaluation-worker] reap error', error);
      });
    }, REAP_INTERVAL_MS);
    this.scheduleTimer = setInterval(() => {
      void this.runDueSchedules().catch((error) => {
        // eslint-disable-next-line no-console
        console.error('[evaluation-worker] schedule error', error);
      });
    }, SCHEDULE_INTERVAL_MS);
    this.samplingTimer = setInterval(() => {
      void this.runSamplingScans().catch((error) => {
        // eslint-disable-next-line no-console
        console.error('[evaluation-worker] sampling error', error);
      });
    }, SAMPLING_INTERVAL_MS);
    // 允许进程退出时不被定时器保活
    if (this.pollTimer.unref) this.pollTimer.unref();
    if (this.reapTimer.unref) this.reapTimer.unref();
    if (this.scheduleTimer.unref) this.scheduleTimer.unref();
    if (this.samplingTimer.unref) this.samplingTimer.unref();
    // eslint-disable-next-line no-console
    console.info(`[evaluation-worker] started workerId=${WORKER_ID}`);
  }

  /**
   * 停止 Worker（主要给测试使用）。
   */
  stop(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.reapTimer) clearInterval(this.reapTimer);
    if (this.scheduleTimer) clearInterval(this.scheduleTimer);
    if (this.samplingTimer) clearInterval(this.samplingTimer);
    this.pollTimer = null;
    this.reapTimer = null;
    this.scheduleTimer = null;
    this.samplingTimer = null;
    this.started = false;
    this.running = false;
  }

  /**
   * 立即触发一次领取-处理循环（测试 / 外部唤醒用）。
   * @returns 本轮是否领取到任务
   */
  async tick(): Promise<boolean> {
    if (this.running) return false;
    this.running = true;
    try {
      // 优先处理取消：把所有 cancelling Run 的 pending 项置 cancelled，并尝试终态化
      await this.finalizeCancellingRuns();

      let claimedAny = false;
      // 一次 tick 最多连续领取 8 条，避免长循环阻塞事件循环
      for (let i = 0; i < 8; i += 1) {
        const claimed = await claimRunItem(WORKER_ID, LEASE_SECONDS);
        if (!claimed) break;
        claimedAny = true;
        await this.handleClaimed(claimed);
      }
      return claimedAny;
    } finally {
      this.running = false;
    }
  }

  /**
   * 扫描所有 status='cancelling' 的 Run，把其 pending 项置 cancelled，并尝试终态化。
   * 解决：Run 在 queued 阶段被取消、从未被 Worker claim 过的场景。
   */
  private async finalizeCancellingRuns(): Promise<void> {
    const rows = await import('../db/index.js').then((m) =>
      m.query<{ id: string }>(`SELECT id FROM evaluation_runs WHERE status = 'cancelling'`)
    );
    for (const row of rows) {
      await cancelPendingItemsForRun(row.id);
      await finalizeCancellationIfReady(row.id);
    }
  }

  /**
   * 立即触发一次过期租约回收 + Runner Session 回收。
   * @returns 被回收的租约项数
   */
  async reap(): Promise<number> {
    await reapStaleRunnerSessions().catch(() => {
      /* 避免 reaper 单次失败影响租约回收 */
    });
    return requeueExpiredLeases();
  }

  /**
   * 扫描到期的 ScheduledRun 并触发 prepareRun。
   * 每轮最多连续触发 10 条，防止长循环阻塞事件循环；触发后立即 poke 让 item 处理尽快开始。
   * @returns 本轮触发的调度数
   */
  async runDueSchedules(): Promise<number> {
    if (this.scheduleRunning) return 0;
    this.scheduleRunning = true;
    let triggered = 0;
    try {
      for (let i = 0; i < 10; i += 1) {
        const due = await claimDueScheduledRun();
        if (!due) break;
        const prep = await triggerScheduledRun(due);
        if (prep) triggered += 1;
      }
      if (triggered > 0) this.poke();
      return triggered;
    } finally {
      this.scheduleRunning = false;
    }
  }

  /**
   * 执行一轮 Trace 采样回流：遍历所有启用规则，把命中线上 Trace 回流到目标 Dataset。
   * @returns 本轮总回流样本数
   */
  async runSamplingScans(): Promise<number> {
    if (this.samplingRunning) return 0;
    this.samplingRunning = true;
    try {
      const results = await runAllSamplingScans();
      return results.reduce((sum, r) => sum + r.sampled, 0);
    } finally {
      this.samplingRunning = false;
    }
  }

  /**
   * 处理一条已 claim 的 RunItem：加载上下文、执行、完成时汇总/取消终态化、广播进度。
   */
  private async handleClaimed(claimed: Awaited<ReturnType<typeof claimRunItem>> extends infer T
    ? Exclude<T, null>
    : never): Promise<void> {
    const { item, run } = claimed;
    try {
      const ctx = await this.loadContext(run);
      if (!ctx) {
        // 上下文加载失败（Target/Suite 被删除等）：把 item 标 failed
        const { failRunItem } = await import('./evaluation-run.js');
        await failRunItem(item.id, 'Run context (target/suite) not found', claimed.leaseToken);
        return;
      }

      const totalItems = await this.ensureTotalCount(run.id);
      const result = await processRunItem(claimed, {
        target: ctx.target,
        suite: ctx.suite,
        members: ctx.members,
        leaseSeconds: LEASE_SECONDS,
        onItemProgress: (payload) => {
          const counter = this.progressCounter.get(run.id) ?? { completed: 0, total: totalItems };
          counter.completed += 1;
          this.progressCounter.set(run.id, counter);
          void this.broadcastProgress(run, counter.completed, counter.total, payload);
        },
      });

      if (result.status === 'cancelled') {
        // 当前 item 已被置 cancelled；同 Run 其它 pending item 由 cancelPendingItemsForRun 兜底取消
        await cancelPendingItemsForRun(run.id);
        await finalizeCancellationIfReady(run.id);
        return;
      }

      // 非终态情况：尝试完成 Run 聚合 / 取消终态化
      const incomplete = await countIncompleteRunItems(run.id);
      if (incomplete === 0) {
        // 若在执行过程中收到了取消请求，把仍处于 pending 的项（如果有）全部取消
        await cancelPendingItemsForRun(run.id);
        const finalizedCancelled = await finalizeCancellationIfReady(run.id);
        if (!finalizedCancelled) {
          await aggregateAndCompleteRun(run.id);
          this.contextCache.delete(run.id);
          this.progressCounter.delete(run.id);
          await this.evaluateAlertsForRun(run.id);
        }
      }
    } catch (error) {
      // processRunItem 已把 item 标 failed；这里只做 Run 级兜底
      // eslint-disable-next-line no-console
      console.error('[evaluation-worker] handleClaimed error', {
        runItemId: item.id,
        runId: run.id,
        error: (error as Error).message,
      });
      const incomplete = await countIncompleteRunItems(run.id);
      if (incomplete === 0) {
        await aggregateAndCompleteRun(run.id);
        await this.evaluateAlertsForRun(run.id);
      }
    }
  }

  /**
   * Run 进入终态后评估持久化告警规则（run_completed/run_regression/run_failed）。
   * 读取最终 Run 状态与 summary 通过率，失败不影响主流程。
   * @param runId - Run ID
   */
  private async evaluateAlertsForRun(runId: string): Promise<void> {
    try {
      const run = await getRunById(runId);
      if (!run) return;
      const gate = run.gate_result as { passed?: boolean; passRate?: number } | null;
      const summary = run.summary as { totalItems?: number; passedItems?: number } | null;
      const experiment = await import('../db/index.js').then((m) =>
        m.queryOne<{ name: string }>('SELECT name FROM evaluation_experiments WHERE id = $1', [run.experiment_id])
      );
      await evaluateRunAlerts(run.project_id, {
        runId: run.id,
        runNumber: run.run_number,
        experimentId: run.experiment_id,
        experimentName: experiment?.name,
        status: run.status,
        // gate_result.passRate 为 0~1 量纲
        passRate: gate?.passRate,
        totalItems: summary?.totalItems,
        passedItems: summary?.passedItems,
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[evaluation-worker] alert evaluation failed', {
        runId,
        error: (error as Error).message,
      });
    }
  }

  /**
   * 加载（并缓存）Run 执行所需的 Target / Suite / Member 快照。
   */
  private async loadContext(run: EvaluationRun): Promise<RunContext | null> {
    const cached = this.contextCache.get(run.id);
    if (cached) return cached;

    const cfg = run.config_snapshot as {
      experiment?: { targetVersionId?: string; suiteVersionId?: string };
    } | null;
    const targetVersionId = cfg?.experiment?.targetVersionId;
    const suiteVersionId = cfg?.experiment?.suiteVersionId;
    if (!targetVersionId || !suiteVersionId) return null;

    const target = await getTargetVersionById(targetVersionId);
    const suite = await getSuiteVersionById(suiteVersionId);
    if (!target || !suite) return null;
    const members = await listSuiteMembers(suiteVersionId);

    const ctx: RunContext = { run, target, suite, members };
    this.contextCache.set(run.id, ctx);
    return ctx;
  }

  /**
   * 获取 Run 的总项数（用于进度广播的分母）。
   */
  private async ensureTotalCount(runId: string): Promise<number> {
    const cached = this.progressCounter.get(runId);
    if (cached) return cached.total;
    const { listRunItems } = await import('./evaluation-run.js');
    const all = await listRunItems(runId);
    this.progressCounter.set(runId, { completed: 0, total: all.length });
    return all.length;
  }

  /**
   * 广播 evaluation.run.progress 到项目 WebSocket 频道。
   * 动态导入 ws 模块，避免与业务服务形成硬依赖环。
   */
  private async broadcastProgress(
    run: EvaluationRun,
    completed: number,
    total: number,
    payload: Record<string, unknown>
  ): Promise<void> {
    try {
      const ws = await import('../routes/ws.js');
      ws.broadcastToProject(run.project_id, {
        type: 'evaluation.run.progress',
        projectId: run.project_id,
        runId: run.id,
        experimentId: run.experiment_id,
        current: completed,
        total,
        completionRate: total > 0 ? Math.round((completed / total) * 10000) / 100 : 0,
        timestamp: new Date().toISOString(),
        ...payload,
      });
    } catch {
      // ws 未注册时静默忽略
    }
  }

  /**
   * 测试辅助：等待 Worker 清空队列（无 pending/running 项）。
   * @param runId - Run ID
   * @param timeoutMs - 最长等待
   */
  async waitForRun(runId: string, timeoutMs = 30_000): Promise<EvaluationRun | null> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const run = await getRunById(runId);
      if (!run) return null;
      if (['completed', 'failed', 'cancelled'].includes(run.status)) return run;
      // 主动触发一次 tick，加速测试
      await this.tick();
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return getRunById(runId);
  }

  /**
   * 允许外部在 Run 创建后主动唤醒一次轮询，减少首次任务的 500ms 延迟。
   */
  poke(): void {
    void this.tick().catch(() => {
      /* noop */
    });
  }
}

/**
 * 把指定 Run 下所有仍处于 pending 的 RunItem 置为 cancelled（不等待它们被 claim）。
 * 用于 Worker 在执行过程中收到取消请求后，对未领取项做快速终态化。
 * @param runId - Run ID
 */
async function cancelPendingItemsForRun(runId: string): Promise<void> {
  const items = await listRunItems(runId);
  for (const item of items) {
    if (item.status === 'pending') {
      const updated = await cancelRunItem(item.id);
      if (updated) {
        await appendRunEvent(runId, 'item_cancelled', {
          runItemId: item.id,
          caseKey: item.case_key,
        });
      }
    }
  }
}

// 单例
let workerInstance: EvaluationWorker | null = null;

/**
 * 获取全局 EvaluationWorker 单例。
 * @returns Worker 单例
 */
export function getEvaluationWorker(): EvaluationWorker {
  if (!workerInstance) {
    workerInstance = new EvaluationWorker();
  }
  return workerInstance;
}

/**
 * 启动全局 Worker。应用启动时调用一次。
 */
export async function startEvaluationWorker(): Promise<void> {
  await getEvaluationWorker().start();
}

/**
 * 停止全局 Worker（测试 / 优雅关停）。
 */
export function stopEvaluationWorker(): void {
  getEvaluationWorker().stop();
}

export { WORKER_ID, appendRunEvent };
