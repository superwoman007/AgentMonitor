import {
  type EvaluationRun,
  type RunSummary,
  type RunPreparation,
  type ClaimedRunItem,
  appendRunEvent,
  completeRun,
  failRun,
  listRunItems,
  markRunItemFinal,
  markRunRunning,
  recordTargetResult,
  upsertScore,
  setRunItemPhase,
  failRunItem,
  clearLease,
  isRunCancelling,
  LeaseExpiredError,
  heartbeatRunItem,
} from './evaluation-run.js';
import { invokeTarget } from './target-adapter.js';
import type { TargetInvokeResult } from './agent-target.js';
import { evaluateOutput } from './evaluation-runner.js';
import { getEvaluatorVersionById } from './evaluation.js';
import { getModelConfigById } from './prompts.js';
import { aggregateScores } from './evaluator-suite.js';
import type { AgentTargetVersion } from './agent-target.js';
import type { EvaluatorSuiteVersion, EvaluatorSuiteMember } from './evaluator-suite.js';

/**
 * 默认租约时长（秒）。HTTP Target 可能较慢，给 5 分钟；心跳按租约 1/3 周期续租。
 */
const DEFAULT_LEASE_SECONDS = 300;

/**
 * 默认 Target 瞬时失败重试次数（仅对网络/超时/5xx 等可重试错误生效）。
 */
const DEFAULT_TARGET_MAX_RETRIES = 2;

/**
 * 从输入快照中抽取用户输入字符串。
 * P0 兼容：优先 input.query，其次 messages 最后一条 user 内容，否则 JSON 序列化。
 * @param inputSnapshot - DatasetVersionItem.input_data 快照
 * @returns 可直接传给 Target 的字符串输入
 */
export function extractInputText(inputSnapshot: Record<string, unknown>): string {
  if (typeof inputSnapshot.query === 'string') return inputSnapshot.query;
  if (Array.isArray(inputSnapshot.messages)) {
    const last = [...inputSnapshot.messages].reverse().find(
      (m) => m && typeof m === 'object' && (m as Record<string, unknown>).role === 'user'
    );
    if (last && typeof (last as Record<string, unknown>).content === 'string') {
      return (last as Record<string, unknown>).content as string;
    }
  }
  return JSON.stringify(inputSnapshot);
}

/**
 * 从期望快照中抽取 expected 字符串。
 * @param expected - DatasetVersionItem.expected_data 快照
 * @returns 字符串期望（可能为空串）
 */
export function extractExpectedText(expected: Record<string, unknown> | null): string {
  if (!expected) return '';
  if (typeof expected.answer === 'string') return expected.answer;
  if (typeof expected.text === 'string') return expected.text;
  return JSON.stringify(expected);
}

/**
 * 判断 Target 调用错误是否可重试（网络/超时/5xx）。
 * @param error - invokeTarget 抛出的错误
 * @returns 是否应重试
 */
function isRetryableTargetError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  if (error.name === 'AbortError') return true;
  if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('abort')) return true;
  if (msg.includes('network') || msg.includes('econnrefused') || msg.includes('enotfound')) return true;
  if (/\b5\d{2}\b/.test(msg)) return true;
  return false;
}

/**
 * 启动心跳定时器，按租约 1/3 周期续租。
 * @param runItemId - RunItem ID
 * @param leaseToken - 租约 token
 * @param leaseSeconds - 租约秒数
 * @returns 关闭函数（clearInterval）
 */
function startHeartbeat(runItemId: string, leaseToken: string, leaseSeconds: number): () => void {
  const intervalMs = Math.max(5_000, Math.floor((leaseSeconds * 1000) / 3));
  const timer = setInterval(() => {
    heartbeatRunItem(runItemId, leaseToken, leaseSeconds).catch((error) => {
      if (!(error instanceof LeaseExpiredError)) {
        // eslint-disable-next-line no-console
        console.warn('[evaluation-worker] heartbeat failed', {
          runItemId,
          error: (error as Error).message,
        });
      }
    });
  }, intervalMs);
  return () => clearInterval(timer);
}

/**
 * 带瞬时重试的 Target 调用。
 * @param target - 目标版本
 * @param inputText - 输入
 * @param runContext - 运行上下文
 * @param maxRetries - 最大重试次数（不含首次）
 * @returns Target 调用结果；若全部失败则抛出最后一次错误
 */
async function invokeTargetWithRetry(
  target: AgentTargetVersion,
  inputText: string,
  runContext: { runId: string; runItemId: string; experimentId: string },
  maxRetries: number
): Promise<TargetInvokeResult> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, Math.min(5000, 250 * 2 ** attempt)));
      }
      return await invokeTarget(target, inputText, runContext);
    } catch (error) {
      lastError = error;
      if (!isRetryableTargetError(error) || attempt === maxRetries) break;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/**
 * 处理一条被 claim 的 RunItem：调用 Target（含重试）→ 跑 Evaluator Suite → 聚合 → 写终态。
 *
 * 阶段感知：item.phase='target' 或 target_output 为空时调用 Target；
 * 否则跳过 Target，直接补做评分（Worker 崩溃恢复）。
 *
 * 取消检查：进入前、Target 后、每个 Evaluator 之前都检查 Run 是否处于 cancelling；
 * 命中取消时把当前 item 置 cancelled，释放租约。
 *
 * @param claimed - claimRunItem 返回的结果
 * @param context - Target/Suite/Member 快照
 * @returns 该 item 的执行结果
 */
export async function processRunItem(
  claimed: ClaimedRunItem,
  context: {
    target: AgentTargetVersion;
    suite: EvaluatorSuiteVersion;
    members: EvaluatorSuiteMember[];
    leaseSeconds?: number;
    targetMaxRetries?: number;
    onItemProgress?: (payload: Record<string, unknown>) => void;
  }
): Promise<{
  status: 'succeeded' | 'failed' | 'cancelled';
  compositeScore: number | null;
  passed: boolean;
}> {
  const { item, run, leaseToken } = claimed;
  const leaseSeconds = context.leaseSeconds ?? DEFAULT_LEASE_SECONDS;
  const targetMaxRetries = context.targetMaxRetries ?? DEFAULT_TARGET_MAX_RETRIES;
  const stopHeartbeat = startHeartbeat(item.id, leaseToken, leaseSeconds);

  try {
    if (await isRunCancelling(run.id)) {
      await cancelItemWithLease(item.id, leaseToken);
      return { status: 'cancelled', compositeScore: null, passed: false };
    }

    let targetOutput: string;
    let targetError: string | null = item.target_error;
    let traceId: string | null = item.trace_id;
    let latencyMs: number | null = item.latency_ms;
    let tokenUsage: Record<string, unknown> | null = item.token_usage ?? null;

    if (!item.target_output) {
      await setRunItemPhase(item.id, 'target', leaseToken);
      const inputText = extractInputText(item.input_snapshot);
      try {
        if (context.target.target_type === 'trace_replay') {
          // trace_replay：不重新执行 Agent，直接把历史 Trace 输出（expected 快照）
          // 作为被测输出进入评分流水线，用于线上 Trace 抽样回放评测。
          const replayOutput = extractExpectedText(item.expected_snapshot);
          if (!replayOutput) {
            throw new Error('trace_replay target requires expected snapshot (historical trace output)');
          }
          targetOutput = replayOutput;
          targetError = null;
          latencyMs = 0;
          await recordTargetResult(item.id, {
            output: targetOutput,
            error: null,
            traceId: item.trace_id ?? null,
            latencyMs: 0,
            tokenUsage: null,
          });
          await setRunItemPhase(item.id, 'evaluators', leaseToken);
        } else {
        const result = await invokeTargetWithRetry(
          context.target,
          inputText,
          { runId: run.id, runItemId: item.id, experimentId: run.experiment_id },
          targetMaxRetries
        );
        targetOutput = result.output;
        targetError = result.error ?? null;
        traceId = result.traceId ?? null;
        latencyMs = result.latencyMs;
        tokenUsage = result.tokenUsage ?? null;

        await recordTargetResult(item.id, {
          output: targetOutput,
          error: targetError,
          traceId,
          latencyMs: latencyMs ?? undefined,
          tokenUsage,
        });
        await setRunItemPhase(item.id, 'evaluators', leaseToken);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await appendRunEvent(run.id, 'item_failed', {
          runItemId: item.id,
          caseKey: item.case_key,
          phase: 'target',
          error: message,
        });
        await failRunItem(item.id, message, leaseToken);
        return { status: 'failed', compositeScore: null, passed: false };
      }
    } else {
      targetOutput = item.target_output;
    }

    if (targetError) {
      await appendRunEvent(run.id, 'item_failed', {
        runItemId: item.id,
        caseKey: item.case_key,
        phase: 'target',
        error: targetError,
      });
      await markRunItemFinal(item.id, 'failed');
      return { status: 'failed', compositeScore: null, passed: false };
    }

    if (await isRunCancelling(run.id)) {
      await cancelItemWithLease(item.id, leaseToken);
      return { status: 'cancelled', compositeScore: null, passed: false };
    }

    const expectedText = extractExpectedText(item.expected_snapshot);
    const scoreInputs: Array<{ alias: string; score: number | null; passed: boolean | null }> = [];
    for (const member of context.members) {
      if (await isRunCancelling(run.id)) {
        await cancelItemWithLease(item.id, leaseToken);
        return { status: 'cancelled', compositeScore: null, passed: false };
      }

      const evaluatorVersion = await getEvaluatorVersionById(member.evaluator_version_id);
      if (!evaluatorVersion) {
        await upsertScore(item.id, {
          evaluatorVersionId: member.evaluator_version_id,
          evaluatorAlias: member.alias,
          status: 'failed',
          error: `Evaluator version ${member.evaluator_version_id} not found`,
        });
        scoreInputs.push({ alias: member.alias, score: null, passed: false });
        continue;
      }

      let judgeModelConfig:
        | { provider: string; model: string; api_key: string; base_url: string | null }
        | undefined;
      if (evaluatorVersion.type === 'llm_judge') {
        const cfg = evaluatorVersion.config as { model_config_id?: string };
        if (cfg?.model_config_id) {
          const modelCfg = await getModelConfigById(cfg.model_config_id);
          if (modelCfg?.api_key) {
            judgeModelConfig = {
              provider: modelCfg.provider,
              model: modelCfg.model,
              api_key: modelCfg.api_key,
              base_url: modelCfg.base_url,
            };
          }
        }
      }

      const evaluation = await evaluateOutput(
        targetOutput,
        expectedText,
        evaluatorVersion.type,
        evaluatorVersion.config as Record<string, unknown>,
        judgeModelConfig
      );

      await upsertScore(item.id, {
        evaluatorVersionId: member.evaluator_version_id,
        evaluatorAlias: member.alias,
        status: 'completed',
        score: evaluation.score,
        passed: evaluation.passed,
        details: evaluation.details,
      });
      scoreInputs.push({
        alias: member.alias,
        score: evaluation.score,
        passed: evaluation.passed,
      });
    }

    if (await isRunCancelling(run.id)) {
      await cancelItemWithLease(item.id, leaseToken);
      return { status: 'cancelled', compositeScore: null, passed: false };
    }

    const aggregated = aggregateScores(context.suite, context.members, scoreInputs);
    const finalStatus: 'succeeded' | 'failed' = aggregated.passed ? 'succeeded' : 'failed';
    await markRunItemFinal(item.id, finalStatus);
    await appendRunEvent(run.id, 'item_completed', {
      runItemId: item.id,
      caseKey: item.case_key,
      passed: aggregated.passed,
      compositeScore: aggregated.compositeScore,
    });
    context.onItemProgress?.({
      runItemId: item.id,
      caseKey: item.case_key,
      status: finalStatus,
      compositeScore: aggregated.compositeScore,
    });
    return {
      status: finalStatus,
      compositeScore: aggregated.compositeScore,
      passed: aggregated.passed,
    };
  } finally {
    stopHeartbeat();
    try {
      await clearLease(item.id, leaseToken);
    } catch {
      // 租约已被回收：忽略
    }
  }
}

/**
 * 在租约保护下把当前 RunItem 标记为 cancelled，并写 item_cancelled 事件。
 */
async function cancelItemWithLease(runItemId: string, leaseToken: string): Promise<void> {
  const { cancelRunItem, appendRunEvent } = await import('./evaluation-run.js');
  const updated = await cancelRunItem(runItemId, leaseToken);
  if (updated) {
    await appendRunEvent(updated.run_id, 'item_cancelled', {
      runItemId,
      caseKey: updated.case_key,
    });
  }
}

/**
 * @deprecated 请使用 evaluation-worker 的 claim 循环 + processRunItem。
 * 保留用于 start 路由不经过 Worker 时的同步执行回退与历史测试。
 *
 * 执行一个已 prepare 的 Run（内联最小 Worker，不走 claim/lease）：
 * 直接遍历 RunItem、调用 Target、评分、写 Score 与 RunEvent、汇总。
 *
 * @param prep - prepareRun 返回的 Run 与版本快照
 * @param onProgress - 每条样本完成后的进度回调
 * @returns 最终 Run 实体
 */
export async function executePreparedRun(
  prep: RunPreparation,
  onProgress?: (current: number, total: number, payload: Record<string, unknown>) => void
): Promise<EvaluationRun> {
  const { run, target, suite, members } = prep;
  const startedRun = await markRunRunning(run.id);
  if (!startedRun) {
    throw new Error(`Run ${run.id} cannot be started (status mismatch)`);
  }
  await appendRunEvent(run.id, 'run_started', { runNumber: run.run_number });

  const items = await listRunItems(run.id);
  let passedCount = 0;
  let failedCount = 0;
  let totalScore = 0;
  let scoredCount = 0;
  let totalLatency = 0;
  let totalTokens = 0;

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const inputText = extractInputText(item.input_snapshot);
    const expectedText = extractExpectedText(item.expected_snapshot);

    try {
      const targetResult = await invokeTargetWithRetry(
        target as AgentTargetVersion,
        inputText,
        { runId: run.id, runItemId: item.id, experimentId: run.experiment_id },
        DEFAULT_TARGET_MAX_RETRIES
      );

      await recordTargetResult(item.id, {
        output: targetResult.output,
        error: targetResult.error ?? null,
        traceId: targetResult.traceId ?? null,
        latencyMs: targetResult.latencyMs,
        tokenUsage: targetResult.tokenUsage ?? null,
      });

      if (targetResult.tokenUsage?.totalTokens) {
        totalTokens += targetResult.tokenUsage.totalTokens;
      }
      totalLatency += targetResult.latencyMs;

      if (targetResult.error) {
        await appendRunEvent(run.id, 'item_failed', {
          runItemId: item.id,
          caseKey: item.case_key,
          error: targetResult.error,
        });
        await markRunItemFinal(item.id, 'failed');
        failedCount += 1;
        onProgress?.(index + 1, items.length, {
          runItemId: item.id,
          caseKey: item.case_key,
          status: 'failed',
        });
        continue;
      }

      const scoreInputs: Array<{ alias: string; score: number | null; passed: boolean | null }> = [];
      for (const member of members) {
        const evaluatorVersion = await getEvaluatorVersionById(member.evaluator_version_id);
        if (!evaluatorVersion) {
          await upsertScore(item.id, {
            evaluatorVersionId: member.evaluator_version_id,
            evaluatorAlias: member.alias,
            status: 'failed',
            error: `Evaluator version ${member.evaluator_version_id} not found`,
          });
          scoreInputs.push({ alias: member.alias, score: null, passed: false });
          continue;
        }

        let judgeModelConfig:
          | { provider: string; model: string; api_key: string; base_url: string | null }
          | undefined;
        if (evaluatorVersion.type === 'llm_judge') {
          const cfg = evaluatorVersion.config as { model_config_id?: string };
          if (cfg?.model_config_id) {
            const modelCfg = await getModelConfigById(cfg.model_config_id);
            if (modelCfg?.api_key) {
              judgeModelConfig = {
                provider: modelCfg.provider,
                model: modelCfg.model,
                api_key: modelCfg.api_key,
                base_url: modelCfg.base_url,
              };
            }
          }
        }

        const evaluation = await evaluateOutput(
          targetResult.output,
          expectedText,
          evaluatorVersion.type,
          evaluatorVersion.config as Record<string, unknown>,
          judgeModelConfig
        );

        await upsertScore(item.id, {
          evaluatorVersionId: member.evaluator_version_id,
          evaluatorAlias: member.alias,
          status: 'completed',
          score: evaluation.score,
          passed: evaluation.passed,
          details: evaluation.details,
        });
        scoreInputs.push({ alias: member.alias, score: evaluation.score, passed: evaluation.passed });
      }

      const aggregated = aggregateScores(suite, members, scoreInputs);
      if (aggregated.compositeScore !== null) {
        totalScore += aggregated.compositeScore;
        scoredCount += 1;
      }
      if (aggregated.passed) {
        passedCount += 1;
        await markRunItemFinal(item.id, 'succeeded');
      } else {
        failedCount += 1;
        await markRunItemFinal(item.id, 'failed');
      }

      await appendRunEvent(run.id, 'item_completed', {
        runItemId: item.id,
        caseKey: item.case_key,
        passed: aggregated.passed,
        compositeScore: aggregated.compositeScore,
      });
      onProgress?.(index + 1, items.length, {
        runItemId: item.id,
        caseKey: item.case_key,
        status: aggregated.passed ? 'succeeded' : 'failed',
        compositeScore: aggregated.compositeScore,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await appendRunEvent(run.id, 'item_failed', {
        runItemId: item.id,
        caseKey: item.case_key,
        error: message,
      });
      await markRunItemFinal(item.id, 'failed');
      failedCount += 1;
      onProgress?.(index + 1, items.length, {
        runItemId: item.id,
        caseKey: item.case_key,
        status: 'failed',
        error: message,
      });
    }
  }

  const summary: RunSummary = {
    totalItems: items.length,
    completedItems: passedCount + failedCount,
    passedItems: passedCount,
    failedItems: failedCount,
    avgScore: scoredCount > 0 ? Number((totalScore / scoredCount).toFixed(4)) : null,
    avgLatencyMs: items.length > 0 ? Math.round(totalLatency / items.length) : null,
    totalTokens,
  };
  const gateResult = {
    passed: failedCount === 0,
    passRate: items.length > 0 ? passedCount / items.length : 0,
  };
  await appendRunEvent(run.id, 'run_completed', summary as unknown as Record<string, unknown>);
  const completed = await completeRun(run.id, summary, gateResult);
  if (!completed) {
    return failRun(run.id, 'Failed to persist run completion') as Promise<EvaluationRun>;
  }
  return completed;
}
