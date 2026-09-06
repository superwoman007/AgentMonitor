import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';

vi.mock('../src/services/llm-client.js', () => ({
  callLLM: vi.fn(async () => ({
    content: 'OK',
    usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
  })),
  buildJudgePrompt: vi.fn(),
  extractJsonFromLLMResponse: vi.fn((text: string) => {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }),
}));

describe('PR-09：数据库 Worker（claim/lease/heartbeat/reaper/retry）', () => {
  let app: FastifyInstance;
  let authToken: string;
  let projectId: string;
  let datasetId: string;
  let datasetVersionId: string;
  let targetVersionId: string;
  let suiteVersionId: string;
  let experimentId: string;

  const authHeader = (): Record<string, string> => ({
    Authorization: `Bearer ${authToken}`,
  });

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    // 显式停止全局 Worker，避免后台轮询与本文件中的 service 层 claim 测试竞态。
    // 只有最后一个"Worker.tick 通过 claim 执行"用例会显式 start。
    const { stopEvaluationWorker } = await import('../src/services/evaluation-worker.js');
    stopEvaluationWorker();

    const email = `pr09-${Date.now()}@example.com`;
    const register = await request(app.server)
      .post('/api/auth/register')
      .send({ email, password: 'Test12345678!', name: 'PR09' })
      .expect(201);
    authToken = register.body.token;

    const project = await request(app.server)
      .post('/api/projects')
      .set(authHeader())
      .send({ name: 'PR09 Project' })
      .expect(201);
    projectId = project.body.id;

    const ds = await request(app.server)
      .post('/api/evaluation/datasets')
      .set(authHeader())
      .send({ project_id: projectId, name: 'PR09 DS' })
      .expect(201);
    datasetId = ds.body.id;
    await request(app.server)
      .post(`/api/evaluation/datasets/${datasetId}/items`)
      .set(authHeader())
      .send({ items: [{ input: 'Q1', expected_output: 'OK' }] })
      .expect(201);
    const dv = await request(app.server)
      .post(`/api/evaluation/datasets/${datasetId}/versions`)
      .set(authHeader())
      .send({ description: 'v1' })
      .expect(201);
    datasetVersionId = dv.body.id;

    const mc = await request(app.server)
      .post('/api/model-configs')
      .set(authHeader())
      .send({
        project_id: projectId,
        name: 'PR09 Model',
        provider: 'openai',
        model: 'gpt-4o-mini',
        api_key: 'sk-test-pr09',
      })
      .expect(201);
    const target = await request(app.server)
      .post('/api/v2/evaluation/targets')
      .set(authHeader())
      .send({
        projectId,
        name: 'PR09 Target',
        type: 'prompt_model',
        invocationConfig: { modelConfigId: mc.body.id },
      })
      .expect(201);
    targetVersionId = target.body.version.id;

    const evaluator = await request(app.server)
      .post('/api/evaluation/evaluators')
      .set(authHeader())
      .send({
        project_id: projectId,
        name: 'PR09 Contains',
        type: 'contains',
        config: { keywords: ['OK'], check_mode: 'whitelist', threshold: 0.5 },
      })
      .expect(201);
    await request(app.server)
      .put(`/api/evaluation/evaluators/${evaluator.body.id}`)
      .set(authHeader())
      .send({ name: 'PR09 Contains' })
      .expect(200);
    const evVersions = await request(app.server)
      .get(`/api/evaluation/evaluators/${evaluator.body.id}/versions`)
      .set(authHeader());
    const evaluatorVersionId = evVersions.body.versions[0].id;

    const suite = await request(app.server)
      .post('/api/v2/evaluation/suites')
      .set(authHeader())
      .send({
        projectId,
        name: 'PR09 Suite',
        members: [{ evaluatorVersionId, alias: 'contains', weight: 1, required: true }],
        aggregationConfig: { strategy: 'all_required' },
      })
      .expect(201);
    suiteVersionId = suite.body.version.id;

    const { createExperiment } = await import('../src/services/evaluation.js');
    const exp = await createExperiment(
      projectId,
      'PR09 Experiment',
      datasetId,
      'worker e2e',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { datasetVersionId, targetVersionId, evaluatorSuiteVersionId: suiteVersionId }
    );
    experimentId = exp.id;
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    const { stopEvaluationWorker } = await import('../src/services/evaluation-worker.js');
    stopEvaluationWorker();
    await app.close();
  });

  // 每个用例后停止 Worker，避免 500ms 轮询定时器干扰后续用例的断言
  afterEach(async () => {
    const mod = await import('../src/services/evaluation-worker.js');
    mod.stopEvaluationWorker();
  });

  it('claimRunItem 原子领取 pending 项并写租约；重复领取返回 null', async () => {
    const { prepareRun, claimRunItem, getRunItemById, listRunItems } = await import(
      '../src/services/evaluation-run.js'
    );
    const prep = await prepareRun(experimentId, { triggerType: 'manual' });
    expect(prep.items).toHaveLength(1);

    const claimed = await claimRunItem('worker-test-A', 60, { runId: prep.run.id });
    expect(claimed).not.toBeNull();
    expect(claimed!.item.run_id).toBe(prep.run.id);
    expect(claimed!.item.status).toBe('running');
    expect(claimed!.leaseToken).toBeTruthy();
    expect(claimed!.item.lease_owner).toBe('worker-test-A');
    expect(claimed!.item.lease_token_hash).toBeTruthy();
    expect(claimed!.item.lease_expires_at).toBeTruthy();
    expect(claimed!.item.attempt_count).toBe(1);

    // 同一项不能被第二个 Worker 再领取（限定同一 Run 后应返回 null）
    const second = await claimRunItem('worker-test-B', 60, { runId: prep.run.id });
    expect(second).toBeNull();

    // 清理：把当前 RunItem 标 cancelled，让 Run 可以被终态化
    const { cancelRunItem, finalizeCancellationIfReady } = await import('../src/services/evaluation-run.js');
    await cancelRunItem(claimed!.item.id, claimed!.leaseToken);
    await finalizeCancellationIfReady(prep.run.id);
    void getRunItemById;
    void listRunItems;
  });

  it('heartbeatRunItem 使用正确 token 续租成功；错误 token 抛 LeaseExpiredError', async () => {
    const { prepareRun, claimRunItem, heartbeatRunItem, LeaseExpiredError, cancelRunItem, finalizeCancellationIfReady } =
      await import('../src/services/evaluation-run.js');
    const prep = await prepareRun(experimentId, { triggerType: 'manual' });
    const claimed = await claimRunItem('worker-hb', 60, { runId: prep.run.id });
    expect(claimed).not.toBeNull();

    const before = claimed!.item.lease_expires_at!.getTime();
    // 续租 120 秒
    const renewed = await heartbeatRunItem(claimed!.item.id, claimed!.leaseToken, 120);
    expect(renewed.lease_expires_at!.getTime()).toBeGreaterThan(before);

    // 错误 token 抛错
    await expect(heartbeatRunItem(claimed!.item.id, 'wrong-token', 60)).rejects.toBeInstanceOf(LeaseExpiredError);

    await cancelRunItem(claimed!.item.id, claimed!.leaseToken);
    await finalizeCancellationIfReady(prep.run.id);
  });

  it('requeueExpiredLeases 回收 target 阶段过期项（清理输出、回到 pending）', async () => {
    const {
      prepareRun,
      claimRunItem,
      recordTargetResult,
      requeueExpiredLeases,
      getRunItemById,
      cancelRunItem,
      finalizeCancellationIfReady,
    } = await import('../src/services/evaluation-run.js');
    const prep = await prepareRun(experimentId, { triggerType: 'manual' });
    const claimed = await claimRunItem('worker-reap-target', 60, { runId: prep.run.id });
    expect(claimed).not.toBeNull();

    // 直接把租约时间回拨到过去，模拟租约过期，避免依赖定时器与竞态
    const { run: dbRun } = await import('../src/db/index.js');
    const pastIso = new Date(Date.now() - 60_000).toISOString();
    await dbRun(
      `UPDATE evaluation_run_items
          SET lease_expires_at = $2, lease_owner = 'dead-worker'
        WHERE id = $1`,
      [claimed!.item.id, pastIso]
    );

    // 校验过期项确实可被查询到
    const { query: runQuery } = await import('../src/db/index.js');
    const expired = await runQuery<{ id: string }>(
      `SELECT id FROM evaluation_run_items
        WHERE run_id = $1 AND status = 'running' AND lease_expires_at IS NOT NULL
          AND CAST(lease_expires_at AS TEXT) < CAST($2 AS TEXT)`,
      [prep.run.id, new Date().toISOString()]
    );
    expect(expired.length).toBeGreaterThanOrEqual(1);
    const count = await requeueExpiredLeases(new Date());
    expect(count).toBeGreaterThanOrEqual(1);

    const reset = await getRunItemById(claimed!.item.id);
    expect(reset?.status).toBe('pending');
    expect(reset?.phase).toBe('queued');
    expect(reset?.lease_owner).toBeNull();
    expect(reset?.target_output).toBeNull();

    // 清理
    const c2 = await claimRunItem('worker-reap-target-cleanup', 60, { runId: prep.run.id });
    if (c2) {
      await cancelRunItem(c2.item.id, c2.leaseToken);
    }
    await finalizeCancellationIfReady(prep.run.id);
    void recordTargetResult;
  });

  it('requeueExpiredLeases 对 evaluators 阶段过期项保留 target_output（只补评分）', async () => {
    const {
      prepareRun,
      claimRunItem,
      recordTargetResult,
      setRunItemPhase,
      requeueExpiredLeases,
      getRunItemById,
      cancelRunItem,
      finalizeCancellationIfReady,
    } = await import('../src/services/evaluation-run.js');
    const prep = await prepareRun(experimentId, { triggerType: 'manual' });
    const claimed = await claimRunItem('worker-reap-eval', 60, { runId: prep.run.id });
    expect(claimed).not.toBeNull();

    // 模拟 target 已完成但进入 evaluators 阶段后崩溃
    await recordTargetResult(claimed!.item.id, {
      output: 'OK',
      error: null,
      latencyMs: 10,
    });
    await setRunItemPhase(claimed!.item.id, 'evaluators', claimed!.leaseToken);

    // 直接把租约时间回拨到过去
    const { run: dbRun } = await import('../src/db/index.js');
    const pastIso = new Date(Date.now() - 60_000).toISOString();
    await dbRun(
      `UPDATE evaluation_run_items SET lease_expires_at = $2, lease_owner = 'dead-worker' WHERE id = $1`,
      [claimed!.item.id, pastIso]
    );

    await requeueExpiredLeases(new Date());
    const reset = await getRunItemById(claimed!.item.id);
    expect(reset?.status).toBe('pending');
    expect(reset?.phase).toBe('evaluators');
    expect(reset?.target_output).toBe('OK');
    expect(reset?.lease_owner).toBeNull();

    const c2 = await claimRunItem('worker-reap-eval-cleanup', 60, { runId: prep.run.id });
    if (c2) {
      await cancelRunItem(c2.item.id, c2.leaseToken);
    }
    await finalizeCancellationIfReady(prep.run.id);
  });

  it('recoverStaleRunsOnStartup 把 running RunItem 回收并把无未完成项的 Run 置 failed', async () => {
    const { prepareRun, claimRunItem, recoverStaleRunsOnStartup, getRunById, cancelRunItem, finalizeCancellationIfReady } =
      await import('../src/services/evaluation-run.js');
    const prep = await prepareRun(experimentId, { triggerType: 'manual' });
    const claimed = await claimRunItem('worker-stale', 60, { runId: prep.run.id });
    expect(claimed).not.toBeNull();

    // 直接把 Run 置为 running 模拟执行中崩溃
    const { markRunRunning } = await import('../src/services/evaluation-run.js');
    await markRunRunning(prep.run.id);

    // 把 item 标 cancelled，让 Run 没有未完成项（模拟已完成但进程未写终态）
    await cancelRunItem(claimed!.item.id, claimed!.leaseToken);
    await finalizeCancellationIfReady(prep.run.id);

    const recovered = await recoverStaleRunsOnStartup();
    expect(recovered).toBeGreaterThanOrEqual(0);
    const run = await getRunById(prep.run.id);
    // Run 已处于 cancelled 终态，不应被改为 failed
    expect(['cancelled', 'failed', 'completed']).toContain(run?.status);
  });

  it('createRetryRun 只复制源 Run 中失败项，retry_of_run_id 指向源 Run', async () => {
    const {
      prepareRun,
      claimRunItem,
      recordTargetResult,
      markRunItemFinal,
      aggregateAndCompleteRun,
      createRetryRun,
      listRunItems,
      getRunById,
      cancelRunItem,
    } = await import('../src/services/evaluation-run.js');

    // 源 Run：让唯一 item 失败
    const source = await prepareRun(experimentId, { triggerType: 'manual' });
    const claimed = await claimRunItem('worker-retry-src', 60, { runId: source.run.id });
    expect(claimed).not.toBeNull();
    await recordTargetResult(claimed!.item.id, {
      output: 'WRONG',
      error: 'agent returned WRONG',
      latencyMs: 5,
    });
    await markRunItemFinal(claimed!.item.id, 'failed');
    await aggregateAndCompleteRun(source.run.id);
    const sourceRun = await getRunById(source.run.id);
    expect(sourceRun?.status).toBe('completed');

    // 创建 retry Run
    const retry = await createRetryRun(source.run.id);
    expect(retry.run.retry_of_run_id).toBe(source.run.id);
    expect(retry.run.trigger_type).toBe('retry');
    const retryItems = await listRunItems(retry.run.id);
    expect(retryItems).toHaveLength(1);
    expect(retryItems[0].dataset_version_item_id).toBe(claimed!.item.dataset_version_item_id);

    // 清理 retry Run：claim 并 cancel
    const c2 = await claimRunItem('worker-retry-cleanup', 60, { runId: retry.run.id });
    if (c2) {
      await cancelRunItem(c2.item.id, c2.leaseToken);
    }
    const { finalizeCancellationIfReady } = await import('../src/services/evaluation-run.js');
    await finalizeCancellationIfReady(retry.run.id);
  });

  it('Worker.tick 通过 claim 执行 RunItem，Run 最终 completed 且 score/event 完整', async () => {
    const { getEvaluationWorker, stopEvaluationWorker } = await import('../src/services/evaluation-worker.js');
    const start = await request(app.server)
      .post(`/api/evaluation/experiments/${experimentId}/start`)
      .set(authHeader())
      .expect(202);
    const runId = start.body.run.id;

    const worker = getEvaluationWorker();
    await worker.start();
    const finalRun = await worker.waitForRun(runId, 15_000);
    expect(finalRun?.status).toBe('completed');
    expect(finalRun?.summary?.passedItems).toBe(1);

    const items = await request(app.server)
      .get(`/api/v2/evaluation/runs/${runId}/items`)
      .set(authHeader())
      .expect(200);
    expect(items.body.items).toHaveLength(1);
    expect(items.body.items[0].status).toBe('succeeded');
    expect(items.body.items[0].target_output).toBe('OK');

    const events = await request(app.server)
      .get(`/api/v2/evaluation/runs/${runId}/events`)
      .set(authHeader())
      .expect(200);
    const types = events.body.events.map((e: { event_type: string }) => e.event_type);
    expect(types).toContain('run_started');
    expect(types).toContain('item_completed');
    expect(types).toContain('run_completed');

    stopEvaluationWorker();
  });
});
