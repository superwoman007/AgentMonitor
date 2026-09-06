import { fromDbBool, SQL_TRUE, SQL_FALSE, query } from '../db/index.js';
import { getRunById, type EvaluationRun, type EvaluationRunItem } from './evaluation-run.js';

/**
 * RunItem 列表查询过滤参数。
 */
export interface ListRunItemsFilter {
  runId: string;
  status?: 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'skipped';
  passed?: boolean;
  caseKey?: string;
  caseKeyPrefix?: string;
  evaluatorAlias?: string;
  scoreMin?: number;
  scoreMax?: number;
  errorCode?: string;
  cursor?: string;
  limit?: number;
}

export interface ListRunItemsResult {
  items: Array<{
    id: string;
    datasetVersionItemId: string;
    caseKey: string;
    status: string;
    phase: string;
    inputSnapshot: Record<string, unknown>;
    expectedSnapshot: Record<string, unknown> | null;
    targetOutput: string | null;
    targetError: string | null;
    traceId: string | null;
    latencyMs: number | null;
    startedAt: string | null;
    completedAt: string | null;
    scores: Array<{
      evaluatorAlias: string;
      status: string;
      score: number | null;
      passed: boolean | null;
      error: string | null;
      reasoning: string | null;
      rawOutput: string | null;
    }>;
  }>;
  nextCursor: string | null;
}

interface RunItemRow {
  id: string;
  dataset_version_item_id: string;
  case_key: string;
  status: string;
  phase: string;
  input_snapshot: string | Record<string, unknown>;
  expected_snapshot: string | Record<string, unknown> | null;
  target_output: string | null;
  target_error: string | null;
  trace_id: string | null;
  latency_ms: number | null;
  started_at: string | null;
  completed_at: string | null;
}

interface ScoreRow {
  run_item_id: string;
  evaluator_alias: string;
  status: string;
  score: number | null;
  passed: number | null;
  error: string | null;
  reasoning: string | null;
  raw_output: string | null;
}

/**
 * 解析数据库中的 JSON 快照字段。
 * @param value - 原始 JSON 列值
 * @returns 解析后的对象，解析失败时返回默认值
 */
function parseSnapshot(
  value: string | Record<string, unknown> | null | undefined,
  fallback: Record<string, unknown> | null = {}
): Record<string, unknown> | null {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return fallback;
  }
}

/**
 * 分页列出 RunItem，支持 status/passed/caseKey/score 等过滤。
 */
export async function listRunItems(filter: ListRunItemsFilter): Promise<ListRunItemsResult> {
  const limit = Math.min(filter.limit ?? 50, 200);
  const where: string[] = ['i.run_id = $1'];
  const params: unknown[] = [filter.runId];
  let idx = 2;

  if (filter.status) {
    where.push(`i.status = $${idx++}`);
    params.push(filter.status);
  }
  if (typeof filter.passed === 'boolean') {
    // passed 语义：存在 passed=TRUE 的 score
    if (filter.passed) {
      where.push(`EXISTS (SELECT 1 FROM evaluation_scores s WHERE s.run_item_id = i.id AND s.passed = TRUE)`);
    } else {
      where.push(`EXISTS (SELECT 1 FROM evaluation_scores s WHERE s.run_item_id = i.id AND (s.passed = FALSE OR s.status = 'failed'))`);
    }
  }
  if (filter.caseKey) {
    where.push(`i.case_key = $${idx++}`);
    params.push(filter.caseKey);
  }
  if (filter.caseKeyPrefix) {
    where.push(`i.case_key LIKE $${idx++}`);
    params.push(`${filter.caseKeyPrefix}%`);
  }
  if (filter.evaluatorAlias) {
    where.push(`EXISTS (SELECT 1 FROM evaluation_scores s WHERE s.run_item_id = i.id AND s.evaluator_alias = $${idx++})`);
    params.push(filter.evaluatorAlias);
  }
  if (typeof filter.scoreMin === 'number') {
    where.push(`EXISTS (SELECT 1 FROM evaluation_scores s WHERE s.run_item_id = i.id AND s.score >= $${idx++})`);
    params.push(filter.scoreMin);
  }
  if (typeof filter.scoreMax === 'number') {
    where.push(`EXISTS (SELECT 1 FROM evaluation_scores s WHERE s.run_item_id = i.id AND s.score <= $${idx++})`);
    params.push(filter.scoreMax);
  }
  if (filter.errorCode) {
    where.push(`EXISTS (SELECT 1 FROM evaluation_scores s WHERE s.run_item_id = i.id AND s.error LIKE $${idx++})`);
    params.push(`%${filter.errorCode}%`);
  }
  if (filter.cursor) {
    where.push(`i.id > $${idx++}`);
    params.push(filter.cursor);
  }

  const rows = await query<RunItemRow & { total_count?: string }>(
    `SELECT i.id, i.dataset_version_item_id, i.case_key, i.status, i.phase,
            i.input_snapshot, i.expected_snapshot,
            i.target_output, i.target_error, i.trace_id,
            i.latency_ms, i.started_at, i.completed_at
       FROM evaluation_run_items i
      WHERE ${where.join(' AND ')}
      ORDER BY i.id ASC
      LIMIT ${limit + 1}`,
    params
  );

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const itemIds = page.map((r) => r.id);
  const scores = itemIds.length > 0
    ? await query<ScoreRow>(
        `SELECT run_item_id, evaluator_alias, status, score, passed, error, reasoning, raw_output
           FROM evaluation_scores
          WHERE run_item_id IN (${itemIds.map((_, i) => `$${i + 2}`).join(',')})
          ORDER BY evaluator_alias ASC`,
        [filter.runId, ...itemIds]
      )
    : [];

  const scoresByItem = new Map<string, ScoreRow[]>();
  for (const s of scores) {
    const arr = scoresByItem.get(s.run_item_id) ?? [];
    arr.push(s);
    scoresByItem.set(s.run_item_id, arr);
  }

  return {
    items: page.map((r) => ({
      id: r.id,
      datasetVersionItemId: r.dataset_version_item_id,
      caseKey: r.case_key,
      status: r.status,
      phase: r.phase,
      inputSnapshot: parseSnapshot(r.input_snapshot) ?? {},
      expectedSnapshot: parseSnapshot(r.expected_snapshot, null),
      targetOutput: r.target_output,
      targetError: r.target_error,
      traceId: r.trace_id,
      latencyMs: r.latency_ms,
      startedAt: r.started_at,
      completedAt: r.completed_at,
      scores: (scoresByItem.get(r.id) ?? []).map((s) => ({
        evaluatorAlias: s.evaluator_alias,
        status: s.status,
        score: s.score,
        passed: fromDbBool(s.passed),
        error: s.error,
        reasoning: s.reasoning,
        rawOutput: s.raw_output,
      })),
    })),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  };
}

/**
 * Bad Cases：失败/回归样本聚合，按 evaluator 维度分类。
 */
export interface BadCasesReport {
  runId: string;
  totalItems: number;
  failedItems: number;
  byEvaluator: Array<{
    evaluatorAlias: string;
    failedCount: number;
    cases: Array<{
      runItemId: string;
      caseKey: string;
      score: number | null;
      error: string | null;
      reasoning: string | null;
      rawOutput: string | null;
      inputSnapshot: Record<string, unknown>;
      expectedSnapshot: Record<string, unknown> | null;
      targetOutput: string | null;
      targetError: string | null;
      traceId: string | null;
    }>;
  }>;
  targetErrors: Array<{
    runItemId: string;
    caseKey: string;
    targetError: string;
    inputSnapshot: Record<string, unknown>;
    expectedSnapshot: Record<string, unknown> | null;
    targetOutput: string | null;
    traceId: string | null;
  }>;
}

export async function getBadCases(runId: string, limitPerEvaluator = 20): Promise<BadCasesReport> {
  const run = await getRunById(runId);
  if (!run) throw new Error('Run not found');

  const items = await query<RunItemRow>(
    `SELECT id, dataset_version_item_id, case_key, status, phase, input_snapshot, expected_snapshot,
            target_output, target_error, trace_id, latency_ms, started_at, completed_at
       FROM evaluation_run_items WHERE run_id = $1`,
    [runId]
  );
  const failedItems = items.filter((i) => i.status === 'failed' || i.status === 'cancelled');
  const failedIds = failedItems.map((i) => i.id);

  const scores = failedIds.length > 0
    ? await query<ScoreRow>(
        `SELECT run_item_id, evaluator_alias, status, score, passed, error, reasoning, raw_output
           FROM evaluation_scores
          WHERE run_item_id IN (${failedIds.map((_, i) => `$${i + 1}`).join(',')})
            AND (status = 'failed' OR passed = ${SQL_FALSE})
          ORDER BY evaluator_alias ASC, run_item_id ASC`,
        failedIds
      )
    : [];

  const byEvaluatorMap = new Map<string, BadCasesReport['byEvaluator'][number]>();
  for (const s of scores) {
    const item = items.find((i) => i.id === s.run_item_id);
    if (!item) continue;
    const entry = byEvaluatorMap.get(s.evaluator_alias) ?? {
      evaluatorAlias: s.evaluator_alias,
      failedCount: 0,
      cases: [],
    };
    entry.failedCount += 1;
    if (entry.cases.length < limitPerEvaluator) {
      entry.cases.push({
        runItemId: item.id,
        caseKey: item.case_key,
        score: s.score,
        error: s.error,
        reasoning: s.reasoning,
        rawOutput: s.raw_output,
        inputSnapshot: parseSnapshot(item.input_snapshot) ?? {},
        expectedSnapshot: parseSnapshot(item.expected_snapshot, null),
        targetOutput: item.target_output,
        targetError: item.target_error,
        traceId: item.trace_id,
      });
    }
    byEvaluatorMap.set(s.evaluator_alias, entry);
  }

  const targetErrors = failedItems
    .filter((i) => i.target_error)
    .slice(0, limitPerEvaluator)
    .map((i) => ({
      runItemId: i.id,
      caseKey: i.case_key,
      targetError: i.target_error as string,
      inputSnapshot: parseSnapshot(i.input_snapshot) ?? {},
      expectedSnapshot: parseSnapshot(i.expected_snapshot, null),
      targetOutput: i.target_output,
      traceId: i.trace_id,
    }));

  return {
    runId,
    totalItems: items.length,
    failedItems: failedItems.length,
    byEvaluator: Array.from(byEvaluatorMap.values()),
    targetErrors,
  };
}

/**
 * Run Compare：对比两个 Run 的通过率、失败 case 差异。
 */
export interface CompareRunsResult {
  baseline: { runId: string; status: string; summary: EvaluationRun['summary'] };
  candidate: { runId: string; status: string; summary: EvaluationRun['summary'] };
  passRateDelta: number | null;
  fixedCases: string[];
  regressedCases: string[];
  stillFailing: string[];
  newFailed: string[];
}

export async function compareRuns(baselineRunId: string, candidateRunId: string): Promise<CompareRunsResult> {
  const [baseline, candidate] = await Promise.all([getRunById(baselineRunId), getRunById(candidateRunId)]);
  if (!baseline) throw new Error('Baseline run not found');
  if (!candidate) throw new Error('Candidate run not found');

  const [baselineItems, candidateItems] = await Promise.all([
    query<{ case_key: string; status: string }>(
      `SELECT case_key, status FROM evaluation_run_items WHERE run_id = $1`,
      [baselineRunId]
    ),
    query<{ case_key: string; status: string }>(
      `SELECT case_key, status FROM evaluation_run_items WHERE run_id = $1`,
      [candidateRunId]
    ),
  ]);

  const failedSet = (rows: Array<{ case_key: string; status: string }>) =>
    new Set(rows.filter((r) => r.status === 'failed').map((r) => r.case_key));
  const succeededSet = (rows: Array<{ case_key: string; status: string }>) =>
    new Set(rows.filter((r) => r.status === 'succeeded').map((r) => r.case_key));

  const baselineFailed = failedSet(baselineItems);
  const candidateFailed = failedSet(candidateItems);
  const candidateSucceeded = succeededSet(candidateItems);
  const baselineSucceeded = succeededSet(baselineItems);

  const fixedCases: string[] = [];
  const regressedCases: string[] = [];
  const stillFailing: string[] = [];
  const newFailed: string[] = [];

  for (const caseKey of baselineFailed) {
    if (candidateSucceeded.has(caseKey)) fixedCases.push(caseKey);
    else if (candidateFailed.has(caseKey)) stillFailing.push(caseKey);
  }
  for (const caseKey of candidateFailed) {
    if (baselineSucceeded.has(caseKey)) {
      regressedCases.push(caseKey);
      newFailed.push(caseKey);
    } else if (!baselineFailed.has(caseKey)) {
      newFailed.push(caseKey);
    }
  }

  const passRate = (s: EvaluationRun['summary']) => {
    if (!s || s.totalItems === 0) return null;
    return s.passedItems / s.totalItems;
  };
  const baseRate = passRate(baseline.summary);
  const candRate = passRate(candidate.summary);
  const passRateDelta = baseRate !== null && candRate !== null ? candRate - baseRate : null;

  return {
    baseline: { runId: baselineRunId, status: baseline.status, summary: baseline.summary },
    candidate: { runId: candidateRunId, status: candidate.status, summary: candidate.summary },
    passRateDelta,
    fixedCases: fixedCases.sort(),
    regressedCases: regressedCases.sort(),
    stillFailing: stillFailing.sort(),
    newFailed: newFailed.sort(),
  };
}

/**
 * 生成 JUnit XML 报告。每个 Evaluator alias 作为一个 testsuite，每个 RunItem 作为 testcase。
 */
export function generateJunitXml(runId: string, run: EvaluationRun, items: ListRunItemsResult['items']): string {
  const suites = new Map<string, ListRunItemsResult['items']>();
  for (const item of items) {
    for (const s of item.scores) {
      const arr = suites.get(s.evaluatorAlias) ?? [];
      arr.push(item);
      suites.set(s.evaluatorAlias, arr);
    }
  }

  const escape = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(
    `<testsuites name="run-${escape(runId)}" tests="${items.length}" failures="${
      run.summary?.failedItems ?? 0
    }" errors="0" time="${((run.summary?.avgLatencyMs ?? 0) / 1000).toFixed(3)}">`
  );
  for (const [suiteName, suiteItems] of suites) {
    const failures = suiteItems.filter((i) => i.scores.some((s) => s.passed === false)).length;
    lines.push(
      `  <testsuite name="${escape(suiteName)}" tests="${suiteItems.length}" failures="${failures}" errors="0">`
    );
    for (const item of suiteItems) {
      const score = item.scores.find((s) => s.evaluatorAlias === suiteName);
      const time = ((item.latencyMs ?? 0) / 1000).toFixed(3);
      lines.push(
        `    <testcase classname="${escape(runId)}" name="${escape(item.caseKey)}" time="${time}">`
      );
      if (score && score.passed === false) {
        const message = escape(score.error ?? item.targetError ?? 'evaluation failed');
        lines.push(`      <failure message="${message}">${message}</failure>`);
      }
      if (item.targetError) {
        lines.push(`      <system-err>${escape(item.targetError)}</system-err>`);
      }
      lines.push('    </testcase>');
    }
    lines.push('  </testsuite>');
  }
  lines.push('</testsuites>');
  return lines.join('\n');
}

/**
 * 导出完整 Run 数据为 JSON（含 Run、summary、items、scores、events）。
 */
export async function exportRun(runId: string): Promise<{
  run: EvaluationRun;
  items: ListRunItemsResult;
  events: Array<{ sequence: number; eventType: string; payload: unknown; createdAt: string }>;
}> {
  const run = await getRunById(runId);
  if (!run) throw new Error('Run not found');
  const [items, events] = await Promise.all([
    listRunItems({ runId, limit: 500 }),
    query<{ sequence: number; event_type: string; payload: string; created_at: string }>(
      `SELECT sequence, event_type, payload, created_at FROM evaluation_run_events WHERE run_id = $1 ORDER BY sequence ASC`,
      [runId]
    ),
  ]);
  return {
    run,
    items,
    events: events.map((e) => ({
      sequence: e.sequence,
      eventType: e.event_type,
      payload: e.payload ? (() => { try { return JSON.parse(e.payload); } catch { return e.payload; } })() : null,
      createdAt: e.created_at,
    })),
  };
}
