import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import type { ApiClient } from '../api-client.js';
import { EXIT_CODES } from './eval-v2.js';

/**
 * `runner start` 实现：以 External Runner 身份加入一个 Run，
 * 周期性 claim 样本，通过子进程（STDIO NDJSON）调用本地 Agent，上传结果，
 * 直到 Run 完成或子进程退出。
 *
 * 本地 Agent 协议（每行使一个 JSON）：
 *   stdin  → { type: 'invoke', caseKey, input, expected? }
 *   stdout ← { type: 'result', caseKey, output, error?, traceId?, latencyMs?, tokenUsage? }
 *   stderr 仅作为日志透传
 */
export interface RunnerStartOptions {
  client: ApiClient;
  runId: string;
  /** 调用本地 Agent 的命令，如 ['python', 'eval_adapter.py'] */
  command: string[];
  /** Runner 标识，便于平台日志排查 */
  runnerId?: string;
  /** 单样本超时（毫秒） */
  timeoutMs?: number;
  /** 心跳周期（毫秒） */
  heartbeatMs?: number;
}

interface InvokeResponse {
  type: 'result';
  caseKey: string;
  output?: string;
  error?: string;
  traceId?: string;
  latencyMs?: number;
  tokenUsage?: Record<string, unknown>;
}

export async function runnerStart(opts: RunnerStartOptions): Promise<number> {
  if (opts.command.length === 0) {
    process.stderr.write('command is required\n');
    return EXIT_CODES.INVALID_ARGS;
  }
  const runnerId = opts.runnerId || `cli-${process.pid}`;

  // 创建 Runner Session
  let sessionId: string;
  try {
    const res = await opts.client.post<{ session: { id: string } }>(
      '/api/v2/evaluation/runner-sessions',
      {
        runId: opts.runId,
        runnerId,
        capabilities: { protocol: 'stdio_ndjson', command: opts.command },
      }
    );
    sessionId = res.session.id;
  } catch (error) {
    process.stderr.write(`Failed to create runner session: ${(error as Error).message}\n`);
    return EXIT_CODES.PLATFORM_ERROR;
  }

  process.stderr.write(`Runner session ${sessionId} started for run ${opts.runId}\n`);

  // 启动子进程
  const child = spawn(opts.command[0], opts.command.slice(1), {
    stdio: ['pipe', 'pipe', 'inherit'],
  });

  let buffer = '';
  const pending = new Map<
    string,
    { resolve: (r: InvokeResponse) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
  >();

  child.stdout.setEncoding('utf-8');
  child.stdout.on('data', (chunk: string) => {
    buffer += chunk;
    let idx: number;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line) as InvokeResponse;
        if (msg.type === 'result' && pending.has(msg.caseKey)) {
          const p = pending.get(msg.caseKey)!;
          clearTimeout(p.timer);
          pending.delete(msg.caseKey);
          p.resolve(msg);
        }
      } catch (error) {
        process.stderr.write(`[runner] invalid JSON from agent: ${line}\n`);
      }
    }
  });

  child.on('exit', (code) => {
    for (const [caseKey, p] of pending) {
      clearTimeout(p.timer);
      p.reject(new Error(`Agent exited with code ${code} before completing ${caseKey}`));
    }
    pending.clear();
  });

  const heartbeatTimer = setInterval(async () => {
    try {
      await opts.client.post(`/api/v2/evaluation/runner-sessions/${sessionId}/heartbeat`);
    } catch {
      // 心跳失败不致命，下轮继续
    }
  }, opts.heartbeatMs ?? 15_000);
  heartbeatTimer.unref();

  const invokeAgent = (caseKey: string, input: unknown, expected: unknown): Promise<InvokeResponse> => {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(caseKey);
        reject(new Error(`Timeout after ${opts.timeoutMs ?? 60_000}ms for ${caseKey}`));
      }, opts.timeoutMs ?? 60_000);
      pending.set(caseKey, { resolve, reject, timer });
      child.stdin.write(
        JSON.stringify({ type: 'invoke', caseKey, input, expected }) + '\n'
      );
    });
  };

  try {
    // 主循环：claim → invoke → upload
    while (true) {
      const claim = await opts.client.post<{
        claimed: boolean;
        runItem?: { id: string; caseKey: string; input: unknown; expected: unknown };
        leaseToken?: string;
      }>(`/api/v2/evaluation/runner-sessions/${sessionId}/claim`);
      if (!claim.claimed || !claim.runItem) {
        // 检查 Run 是否已完成
        const runRes = await opts.client.get<{ run: { status: string } }>(
          `/api/v2/evaluation/runs-for-runner/${opts.runId}`
        );
        if (['completed', 'failed', 'cancelled'].includes(runRes.run.status)) {
          process.stderr.write(`Run ${opts.runId} is ${runRes.run.status}\n`);
          break;
        }
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }

      const { id: runItemId, caseKey, input, expected } = claim.runItem;
      process.stderr.write(`Claimed ${caseKey}\n`);

      try {
        const result = await invokeAgent(caseKey, input, expected);
        if (result.error) {
          await opts.client.post(`/api/v2/evaluation/run-items/${runItemId}/fail`, {
            leaseToken: claim.leaseToken,
            error: result.error,
          });
        } else {
          await opts.client.post(`/api/v2/evaluation/run-items/${runItemId}/target-result`, {
            leaseToken: claim.leaseToken,
            output: result.output ?? '',
            traceId: result.traceId,
            latencyMs: result.latencyMs,
            tokenUsage: result.tokenUsage,
          });
        }
      } catch (error) {
        try {
          await opts.client.post(`/api/v2/evaluation/run-items/${runItemId}/fail`, {
            leaseToken: claim.leaseToken,
            error: (error as Error).message,
          });
        } catch {
          // 上传失败也继续下一项
        }
      }
    }
  } finally {
    clearInterval(heartbeatTimer);
    try {
      child.stdin.end();
    } catch {
      // noop
    }
    child.kill('SIGTERM');
    try {
      await opts.client.post(`/api/v2/evaluation/runner-sessions/${sessionId}/close`);
    } catch {
      // noop
    }
  }

  return EXIT_CODES.OK;
}
