import { v4 as uuidv4 } from 'uuid';
import { query, queryOne, run as dbRun } from '../db/index.js';
import {
  type EvaluationRunItem,
  type EvaluationRun,
  claimRunItem,
  getRunById,
  listRunItems,
  recordTargetResult,
  markRunItemFinal,
  appendRunEvent,
  generateLeaseToken,
  hashLeaseToken,
  countIncompleteRunItems,
  aggregateAndCompleteRun,
  finalizeCancellationIfReady,
} from './evaluation-run.js';
import type { ServiceToken } from './service-token.js';

/**
 * Runner Session：外部 Runner（CLI/CI/本地进程）与平台的一次连接。
 * 一个 Session 绑定到一个 Run，并由 Service Token 鉴权。
 */
export interface RunnerSession {
  id: string;
  project_id: string;
  run_id: string;
  token_id: string | null;
  runner_id: string;
  capabilities: Record<string, unknown>;
  status: 'active' | 'closed';
  last_heartbeat_at: Date | null;
  closed_at: Date | null;
  metadata: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Claim 结果：包含 RunItem、明文 leaseToken 和样本快照。
 */
export interface RunnerClaim {
  runItem: EvaluationRunItem;
  run: EvaluationRun;
  leaseToken: string;
  sample: {
    caseKey: string;
    input: Record<string, unknown>;
    expected: Record<string, unknown> | null;
    metadata: Record<string, unknown> | null;
  };
}

function mapSession(row: Record<string, unknown>): RunnerSession {
  const parseJson = <T>(value: unknown): T | null => {
    if (value === null || value === undefined) return null;
    if (typeof value === 'object') return value as T;
    if (typeof value !== 'string') return null;
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  };
  return {
    id: row.id as string,
    project_id: row.project_id as string,
    run_id: row.run_id as string,
    token_id: (row.token_id as string | null) ?? null,
    runner_id: row.runner_id as string,
    capabilities: parseJson<Record<string, unknown>>(row.capabilities) ?? {},
    status: row.status as RunnerSession['status'],
    last_heartbeat_at: row.last_heartbeat_at ? new Date(row.last_heartbeat_at as string) : null,
    closed_at: row.closed_at ? new Date(row.closed_at as string) : null,
    metadata: parseJson<Record<string, unknown>>(row.metadata),
    created_at: new Date(row.created_at as string),
    updated_at: new Date(row.updated_at as string),
  };
}

/**
 * 创建 Runner Session。要求 Run 属于同一项目，且没有其它 active session。
 * @param projectId - 项目 ID
 * @param runId - Run ID
 * @param token - 创建 Session 的 Service Token
 * @param options - runner 标识与能力
 */
export async function createRunnerSession(
  projectId: string,
  runId: string,
  token: ServiceToken,
  options: {
    runnerId: string;
    capabilities?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }
): Promise<RunnerSession> {
  const run = await getRunById(runId);
  if (!run || run.project_id !== projectId) {
    throw new Error('Run not found in project');
  }
  if (['completed', 'failed', 'cancelled'].includes(run.status)) {
    throw new Error(`Run is already in terminal state: ${run.status}`);
  }

  // 同一 Run 只允许一个 active session
  const existing = await queryOne<{ id: string }>(
    `SELECT id FROM runner_sessions WHERE run_id = $1 AND status = 'active' LIMIT 1`,
    [runId]
  );
  if (existing) {
    throw new Error('An active runner session already exists for this run');
  }

  const id = uuidv4();
  await dbRun(
    `INSERT INTO runner_sessions
       (id, project_id, run_id, token_id, runner_id, capabilities, metadata, status, last_heartbeat_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', datetime('now'))`,
    [
      id,
      projectId,
      runId,
      token.id,
      options.runnerId,
      JSON.stringify(options.capabilities ?? {}),
      options.metadata ? JSON.stringify(options.metadata) : null,
    ]
  );
  const row = await queryOne<Record<string, unknown>>('SELECT * FROM runner_sessions WHERE id = $1', [id]);
  if (!row) throw new Error('Failed to reload runner session');
  return mapSession(row);
}

/**
 * 关闭 Runner Session。
 * @param sessionId - Session ID
 * @param token - 鉴权 Token（必须是创建者）
 */
export async function closeRunnerSession(
  sessionId: string,
  token: ServiceToken
): Promise<RunnerSession | null> {
  const row = await queryOne<Record<string, unknown>>(
    `UPDATE runner_sessions
        SET status = 'closed', closed_at = datetime('now'), updated_at = datetime('now')
      WHERE id = $1 AND token_id = $2 AND status = 'active'
      RETURNING *`,
    [sessionId, token.id]
  );
  return row ? mapSession(row) : null;
}

/**
 * Session 心跳：更新 last_heartbeat_at。
 * @param sessionId - Session ID
 * @param token - 鉴权 Token
 */
export async function heartbeatRunnerSession(
  sessionId: string,
  token: ServiceToken
): Promise<RunnerSession | null> {
  const row = await queryOne<Record<string, unknown>>(
    `UPDATE runner_sessions
        SET last_heartbeat_at = datetime('now'), updated_at = datetime('now')
      WHERE id = $1 AND token_id = $2 AND status = 'active'
      RETURNING *`,
    [sessionId, token.id]
  );
  return row ? mapSession(row) : null;
}

/**
 * 获取 Session 详情（鉴权：必须是同一项目或同一 token 创建者）。
 */
export async function getRunnerSession(
  sessionId: string,
  token: ServiceToken
): Promise<RunnerSession | null> {
  const row = await queryOne<Record<string, unknown>>(
    `SELECT * FROM runner_sessions WHERE id = $1 AND project_id = $2`,
    [sessionId, token.project_id]
  );
  return row ? mapSession(row) : null;
}

/**
 * Runner 领取一条 RunItem。要求 Session 处于 active 且属于该 Run。
 *
 * 与平台 Worker 不同，Runner 只领取自己 Session 绑定 Run 的项；
 * 领取后写入 runner_sessions.id 到 run_items.session_id（通过 lease_owner 字段编码）。
 *
 * @param sessionId - Runner Session ID
 * @param token - Service Token
 * @param leaseSeconds - 租约秒数
 */
export async function runnerClaimItem(
  sessionId: string,
  token: ServiceToken,
  leaseSeconds = 300
): Promise<RunnerClaim | null> {
  const session = await getRunnerSession(sessionId, token);
  if (!session || session.status !== 'active') {
    throw new Error('Runner session is not active');
  }

  const claimed = await claimRunItem(`runner:${session.runner_id}`, leaseSeconds, {
    runId: session.run_id,
  });
  if (!claimed) return null;

  // 把 session 关联写入 lease_owner（覆盖 workerId 前缀，便于排查）
  await dbRun(
    `UPDATE evaluation_run_items
        SET session_id = $2, lease_owner = $3
      WHERE id = $1`,
    [claimed.item.id, session.id, `runner:${session.runner_id}:${session.id.slice(0, 8)}`]
  );

  const items = await listRunItems(session.run_id);
  const refreshed = items.find((i) => i.id === claimed.item.id) ?? claimed.item;

  return {
    runItem: refreshed,
    run: claimed.run,
    leaseToken: claimed.leaseToken,
    sample: {
      caseKey: refreshed.case_key,
      input: refreshed.input_snapshot,
      expected: refreshed.expected_snapshot,
      metadata: null,
    },
  };
}

/**
 * Runner 续租 RunItem。
 */
export async function runnerHeartbeatItem(
  runItemId: string,
  leaseToken: string,
  token: ServiceToken,
  leaseSeconds = 300
): Promise<EvaluationRunItem> {
  // 复用 evaluation-run 的 heartbeat 逻辑，但需要先校验 item 所属项目
  const item = await queryOne<{ project_id: string }>(
    `SELECT r.project_id as project_id
       FROM evaluation_run_items i
       JOIN evaluation_runs r ON r.id = i.run_id
      WHERE i.id = $1`,
    [runItemId]
  );
  if (!item || item.project_id !== token.project_id) {
    throw new Error('Run item not found in project');
  }
  const { heartbeatRunItem } = await import('./evaluation-run.js');
  return heartbeatRunItem(runItemId, leaseToken, leaseSeconds);
}

/**
 * Runner 上传 Target 调用结果。平台随后执行 Evaluator Suite 打分。
 */
export async function runnerSubmitResult(
  runItemId: string,
  leaseToken: string,
  token: ServiceToken,
  result: {
    output: string;
    error?: string | null;
    traceId?: string | null;
    latencyMs?: number;
    tokenUsage?: Record<string, unknown> | null;
  }
): Promise<EvaluationRunItem> {
  const item = await queryOne<{ project_id: string }>(
    `SELECT r.project_id as project_id
       FROM evaluation_run_items i
       JOIN evaluation_runs r ON r.id = i.run_id
      WHERE i.id = $1`,
    [runItemId]
  );
  if (!item || item.project_id !== token.project_id) {
    throw new Error('Run item not found in project');
  }
  // 写入结果后，由平台 worker 在下一轮 tick 中补做评分
  await recordTargetResult(runItemId, {
    output: result.output,
    error: result.error ?? null,
    traceId: result.traceId ?? null,
    latencyMs: result.latencyMs,
    tokenUsage: result.tokenUsage ?? null,
  });
  // 标记为 pending/evaluators，让平台 Worker 领取并补做评分（释放 runner 租约）
  await dbRun(
    `UPDATE evaluation_run_items
        SET status = 'pending', phase = 'evaluators',
            lease_owner = NULL, lease_token_hash = NULL, lease_expires_at = NULL,
            updated_at = datetime('now')
      WHERE id = $1`,
    [runItemId]
  );
  await appendRunItemEvent(runItemId, 'runner_result_uploaded', {
    outputBytes: result.output.length,
    traceId: result.traceId ?? null,
  });
  const refreshed = await queryOne<Record<string, unknown>>(
    'SELECT * FROM evaluation_run_items WHERE id = $1',
    [runItemId]
  );
  return refreshed as unknown as EvaluationRunItem;
}

/**
 * Runner 上报当前 RunItem 失败（业务错误或不可恢复异常）。
 */
export async function runnerFailItem(
  runItemId: string,
  leaseToken: string,
  token: ServiceToken,
  error: string
): Promise<EvaluationRunItem | null> {
  const item = await queryOne<{ project_id: string; run_id: string }>(
    `SELECT r.project_id as project_id, i.run_id as run_id
       FROM evaluation_run_items i
       JOIN evaluation_runs r ON r.id = i.run_id
      WHERE i.id = $1`,
    [runItemId]
  );
  if (!item || item.project_id !== token.project_id) {
    throw new Error('Run item not found in project');
  }
  const { failRunItem } = await import('./evaluation-run.js');
  const failed = await failRunItem(runItemId, error, leaseToken);
  await appendRunEvent(item.run_id, 'item_failed', {
    runItemId,
    error,
    reporter: 'external_runner',
  });
  return failed;
}

async function appendRunItemEvent(
  runItemId: string,
  eventType: string,
  payload: Record<string, unknown>
): Promise<void> {
  const row = await queryOne<{ run_id: string }>(
    'SELECT run_id FROM evaluation_run_items WHERE id = $1',
    [runItemId]
  );
  if (row) {
    await appendRunEvent(row.run_id, eventType, { runItemId, ...payload });
  }
}

/**
 * 关闭所有过期（超过 90s 未心跳）的 Runner Session，
 * 让其未完成项可被平台 Worker 回收/重领。
 */
export async function reapStaleRunnerSessions(timeoutSeconds = 90): Promise<number> {
  const cutoff = new Date(Date.now() - timeoutSeconds * 1000).toISOString();
  const stale = await query<{ id: string; run_id: string }>(
    `SELECT id, run_id FROM runner_sessions
      WHERE status = 'active'
        AND (last_heartbeat_at IS NULL OR CAST(last_heartbeat_at AS TEXT) < $1)`,
    [cutoff]
  );
  for (const s of stale) {
    await dbRun(
      `UPDATE runner_sessions SET status = 'closed', closed_at = datetime('now'), updated_at = datetime('now') WHERE id = $1`,
      [s.id]
    );
    await appendRunEvent(s.run_id, 'runner_session_timeout', { sessionId: s.id });
  }
  return stale.length;
}

// 重新导出供路由使用
export { aggregateAndCompleteRun, countIncompleteRunItems, finalizeCancellationIfReady, generateLeaseToken, hashLeaseToken, markRunItemFinal };
