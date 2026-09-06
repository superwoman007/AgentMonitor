import type { ApiClient, Run } from '../api-client.js';

/**
 * CLI 退出码（与技术方案 §15.3 对齐）：
 * 0=Run 完成且 Gate 通过；1=Gate 未通过；2=参数错误；3=Target/Runner 错误；4=平台/鉴权错误。
 */
export const EXIT_CODES = {
  OK: 0,
  GATE_FAILED: 1,
  INVALID_ARGS: 2,
  TARGET_ERROR: 3,
  PLATFORM_ERROR: 4,
  CANCELLED: 130,
} as const;

export interface EvalRunOptions {
  client: ApiClient;
  /** Experiment ID（也可以是项目内 Experiment 名称，当前仅支持 ID） */
  experimentId: string;
  /** 等待 Run 完成 */
  wait: boolean;
  /** 等待超时（秒） */
  timeoutSec: number;
  /** 触发后仅输出 RunId */
  json: boolean;
}

/**
 * `eval run`：触发一次 V2 Experiment Run。
 */
export async function evalRun(opts: EvalRunOptions): Promise<number> {
  try {
    const res = await opts.client.post<{ run: Run }>(
      `/api/evaluation/experiments/${opts.experimentId}/start`
    );
    if (opts.json) {
      process.stdout.write(JSON.stringify({ runId: res.run.id }) + '\n');
    } else {
      process.stdout.write(`Run created: ${res.run.id}\n`);
    }
    if (!opts.wait) return EXIT_CODES.OK;
    return evalWait({
      client: opts.client,
      runId: res.run.id,
      timeoutSec: opts.timeoutSec,
      json: opts.json,
    });
  } catch (error) {
    return reportPlatformError(error);
  }
}

export interface EvalWaitOptions {
  client: ApiClient;
  runId: string;
  timeoutSec: number;
  json: boolean;
}

/**
 * `eval wait`：轮询直到 Run 进入终态。
 */
export async function evalWait(opts: EvalWaitOptions): Promise<number> {
  const start = Date.now();
  const timeoutMs = opts.timeoutSec * 1000;
  // 初始 1s，最大 5s 轮询
  let interval = 1000;
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await opts.client.get<{ run: Run }>(
        `/api/v2/evaluation/runs/${opts.runId}`
      );
      const run = res.run;
      if (!opts.json) {
        process.stderr.write(`\r[${run.status}] ${run.summary?.completedItems ?? 0}/${run.summary?.totalItems ?? 0}`);
      }
      if (['completed', 'failed', 'cancelled'].includes(run.status)) {
        if (!opts.json) process.stderr.write('\n');
        if (opts.json) {
          process.stdout.write(JSON.stringify(run) + '\n');
        } else {
          printRunSummary(run);
        }
        if (run.status === 'completed') return EXIT_CODES.OK;
        if (run.status === 'cancelled') return EXIT_CODES.CANCELLED;
        return EXIT_CODES.TARGET_ERROR;
      }
    } catch (error) {
      return reportPlatformError(error);
    }
    await new Promise((r) => setTimeout(r, interval));
    interval = Math.min(interval * 1.5, 5000);
  }
  process.stderr.write(`Timed out waiting for run ${opts.runId}\n`);
  return EXIT_CODES.PLATFORM_ERROR;
}

/**
 * `eval report`：输出 Run 的 JSON 报告或 JUnit XML。
 */
export async function evalReport(
  client: ApiClient,
  runId: string,
  options: { output?: string; junit?: boolean }
): Promise<number> {
  try {
    if (options.junit) {
      // JUnit 格式直接从后端 /export?format=junit 获取 XML 文本
      const url = `${client.baseUrl}/api/v2/evaluation/runs/${runId}/export?format=junit`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${client.token}` } });
      if (!res.ok) {
        process.stderr.write(`Failed to fetch JUnit report: HTTP ${res.status}\n`);
        return EXIT_CODES.PLATFORM_ERROR;
      }
      const xml = await res.text();
      if (options.output) {
        const { writeFileSync } = await import('fs');
        writeFileSync(options.output, xml);
        process.stderr.write(`JUnit report written to ${options.output}\n`);
      } else {
        process.stdout.write(xml + '\n');
      }
      return EXIT_CODES.OK;
    }
    const res = await client.get<{ run: Run }>(`/api/v2/evaluation/runs/${runId}`);
    const json = JSON.stringify(res.run, null, 2);
    if (options.output) {
      const { writeFileSync } = await import('fs');
      writeFileSync(options.output, json);
      process.stderr.write(`Report written to ${options.output}\n`);
    } else {
      process.stdout.write(json + '\n');
    }
    return EXIT_CODES.OK;
  } catch (error) {
    return reportPlatformError(error);
  }
}

export interface EvalGateOptions {
  client: ApiClient;
  runId: string;
  minPassRate: number;
}

/**
 * `eval gate`：检查 Run 是否满足质量门禁，返回对应退出码。
 */
export async function evalGate(opts: EvalGateOptions): Promise<number> {
  try {
    const res = await opts.client.get<{ run: Run }>(
      `/api/v2/evaluation/runs/${opts.runId}`
    );
    const run = res.run;
    if (run.status !== 'completed') {
      process.stderr.write(`Run is not completed: ${run.status}\n`);
      return EXIT_CODES.TARGET_ERROR;
    }
    const total = run.summary?.totalItems ?? 0;
    const passed = run.summary?.passedItems ?? 0;
    const passRate = total > 0 ? passed / total : 0;
    if (passRate < opts.minPassRate) {
      process.stderr.write(
        `Gate failed: pass rate ${(passRate * 100).toFixed(2)}% < ${(opts.minPassRate * 100).toFixed(2)}%\n`
      );
      return EXIT_CODES.GATE_FAILED;
    }
    process.stdout.write(
      `Gate passed: ${(passRate * 100).toFixed(2)}% ≥ ${(opts.minPassRate * 100).toFixed(2)}%\n`
    );
    return EXIT_CODES.OK;
  } catch (error) {
    return reportPlatformError(error);
  }
}

function printRunSummary(run: Run): void {
  const s = run.summary;
  process.stdout.write(`Run ${run.id} [${run.status}]\n`);
  if (s) {
    process.stdout.write(
      `  passed=${s.passedItems} failed=${s.failedItems} total=${s.totalItems} avgScore=${s.avgScore ?? '-'}\n`
    );
  }
}

function reportPlatformError(error: unknown): number {
  const msg = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Platform error: ${msg}\n`);
  return EXIT_CODES.PLATFORM_ERROR;
}
