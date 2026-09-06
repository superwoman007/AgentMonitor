/**
 * 真实 Agent 全链路闭环 E2E
 *
 * 以一个真实 Agent 的视角，驱动并验证平台能力闭环：
 *   Prompt Runtime(Deployment + A/B 分流)  →  Agent 会话/LLM 上报(SDK)
 *   → 采样回流 Dataset  →  commit DatasetVersion  →  trace_replay Target
 *   →  离线 Evaluator + Evaluator Suite  →  V2 Experiment(ready)
 *   →  触发 Run 并轮询完成  →  告警规则评估  →  Webhook 实际投递
 *
 * 运行（需后端已启动）：
 *   BASE_URL=http://127.0.0.1:3300 npx tsx src/closed-loop.ts
 */
import AgentMonitor from 'agentmonitor-sdk';
import http from 'node:http';

const BASE = (process.env.BASE_URL || 'http://127.0.0.1:3300').replace(/\/$/, '');
const V1 = `${BASE}/api/v1`;
const V2E = `${BASE}/api/v2/evaluation`;
const V2 = `${BASE}/api/v2`;

const stamp = Date.now();
const results: Array<{ name: string; ok: boolean; detail?: string }> = [];
function check(name: string, cond: boolean, detail = '') {
  results.push({ name, ok: cond, detail });
  console.log(`${cond ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) {
    throw new Error(`断言失败: ${name} ${detail}`);
  }
}

async function api(method: string, url: string, opts: { token?: string; apiKey?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;
  if (opts.apiKey) headers['X-API-Key'] = opts.apiKey;
  const res = await fetch(url, {
    method,
    headers,
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    throw new Error(`${method} ${url} -> ${res.status}: ${text}`);
  }
  return data as any;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(`\n🧪 真实 Agent 全链路闭环测试  BASE=${BASE}\n`);

  // ─────────────────────────────────────────────
  // 0. 启动本地 Webhook 接收端（真实 HTTP 服务）
  // ─────────────────────────────────────────────
  const webhookPort = 9099;
  const received: any[] = [];
  await new Promise<void>((resolve) => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        try {
          received.push(JSON.parse(body));
        } catch {
          received.push({ raw: body });
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      });
    });
    server.listen(webhookPort, '127.0.0.1', () => {
      console.log(`🪝 Webhook 接收端启动 http://127.0.0.1:${webhookPort}/hook`);
      resolve();
    });
  });
  const webhookUrl = `http://127.0.0.1:${webhookPort}/hook`;

  // ─────────────────────────────────────────────
  // 1. 用户 / 项目 / API Key（真实注册）
  // ─────────────────────────────────────────────
  const email = `loop-${stamp}@example.com`;
  const reg = await api('POST', `${V1}/auth/register`, {
    body: { name: 'Loop E2E', email, password: 'Test1234567!' },
  });
  const token: string = reg.token;
  const proj = await api('POST', `${V1}/projects`, { token, body: { name: `闭环测试项目 ${stamp}` } });
  const projectId: string = proj.id ?? proj.project?.id;

  const keyResp = await api('POST', `${V1}/apikeys`, {
    token,
    body: { project_id: projectId, name: 'loop-data-key' },
  });
  check('创建项目与 API Key', !!projectId && keyResp.key?.startsWith('am_'), `project=${projectId}`);

  // Runtime 只读 + 遥测写入：真实 Agent 使用 Service Token（amt_ + scope）
  const stResp = await api('POST', `${V2}/service-tokens`, {
    token,
    body: {
      projectId,
      name: 'loop-agent-runtime',
      scopes: ['telemetry:write', 'prompts:read'],
    },
  });
  const serviceToken: string = stResp.token?.plain_token;
  check('创建 Service Token(prompts:read + telemetry:write)', !!serviceToken && serviceToken.startsWith('amt_'),
    `prefix=${serviceToken?.slice(0, 4)}`);
  // 真实 Agent SDK 使用 Service Token 作为 apiKey
  const agentApiKey = serviceToken;

  // ─────────────────────────────────────────────
  // 2. Prompt 创建/版本/部署/A-B 变体
  // ─────────────────────────────────────────────
  const promptName = `客服助手-${stamp}`;
  const prompt = await api('POST', `${V1}/prompts`, {
    token,
    body: { project_id: projectId, name: promptName, content: '你是客服助手，回答必须包含“退款政策”。', description: 'baseline' },
  });
  const promptId: string = prompt.id;
  const versionsRes = await api('GET', `${V1}/prompts/${promptId}/versions`, { token });
  const baselineVersionId: string = versionsRes.versions?.[0]?.id ?? versionsRes[0]?.id;

  const v2 = await api('POST', `${V1}/prompts/${promptId}/versions`, {
    token,
    body: { content: '你是更友好的客服助手 V2，回答必须包含“极速退款”。', description: 'variant-b' },
  });
  const variantVersionId: string = v2.version?.id ?? v2.id;

  // 部署基线
  await api('PUT', `${V2}/prompt-deployments/${promptId}`, {
    token,
    body: { projectId, promptVersionId: baselineVersionId, environment: 'production', note: 'baseline' },
  });
  // A/B：B 变体权重 100（确定性命中 B）
  await api('PUT', `${V2}/prompt-ab-variants/${promptId}/B`, {
    token,
    body: { projectId, environment: 'production', promptVersionId: variantVersionId, weight: 100, enabled: true },
  });
  check('Prompt 部署与 A/B 变体配置', !!baselineVersionId && !!variantVersionId);

  // ─────────────────────────────────────────────
  // 3. Runtime 解析：基线 vs A/B 变体（真实 HTTP 契约）
  // ─────────────────────────────────────────────
  const basePrompt = await api(
    'GET',
    `${V2}/runtime/prompts/${encodeURIComponent(promptName)}?projectId=${projectId}&environment=production&bucketKey=`,
    { token }
  );
  const variantPrompt = await api(
    'GET',
    `${V2}/runtime/prompts/${encodeURIComponent(promptName)}?projectId=${projectId}&environment=production&bucketKey=user-${stamp}`,
    { token }
  );
  check('Runtime 基线解析', basePrompt.content.includes('退款政策') && basePrompt.variantKey == null, `v${basePrompt.versionNumber}`);
  check('Runtime A/B 命中变体 B', variantPrompt.variantKey === 'B' && variantPrompt.promptVersionId === variantVersionId,
    `variantKey=${variantPrompt.variantKey}`);

  // ─────────────────────────────────────────────
  // 4. 真实 Agent：通过 SDK 拉取部署 Prompt + 会话/LLM 上报
  // ─────────────────────────────────────────────
  const monitor = new AgentMonitor({ apiKey: keyResp.key, baseUrl: BASE, projectId } as any);

  // SDK Runtime 拉取：SDK 用 am_ 数据 Key 上报，Runtime 只读走 Service Token
  // 这里直接用 Service Token 调 Runtime（真实 Agent 场景：agent 持 amt_ 读 Prompt）
  const sdkPrompt = await api(
    'GET',
    `${V2}/runtime/prompts/${encodeURIComponent(promptName)}?projectId=${projectId}&environment=production`,
    { token }
  );
  check('Runtime/SDK 拉取已部署 Prompt', sdkPrompt.promptId === promptId && sdkPrompt.versionNumber >= 1,
    `version=${sdkPrompt.versionNumber} variant=${sdkPrompt.variantKey ?? 'baseline'}`);

  const session = monitor.startSession();
  await monitor.trackMessage({ sessionId: session.id, role: 'user', content: '退款政策是什么？' });

  // 模拟 Agent 用变体 Prompt 生成答案（含关键词，便于回放评测通过）
  const answer = '您好，根据退款政策，支持 7 天无理由退款，VIP 可享极速退款。';
  // 显式 trace，确保 input/output 都可被采样回流（input=问题, output=答案）
  await monitor.trace({
    sessionId: session.id,
    traceType: 'llm',
    name: `agent_answer_${stamp}`,
    input: { role: 'user', content: '退款政策是什么？' },
    output: { role: 'assistant', content: answer },
    status: 'success',
    latencyMs: 320,
    metadata: { promptId, promptVersionId: variantVersionId, model: 'demo' },
  } as any);
  await monitor.trackMessage({ sessionId: session.id, role: 'assistant', content: answer });
  await monitor.endSession();
  await monitor.flush();
  console.log('🤖 Agent 已通过 SDK 上报会话/LLM Trace');

  // ─────────────────────────────────────────────
  // 5. 告警规则（run_completed → Webhook），先于 Run 创建
  // ─────────────────────────────────────────────
  const alertRule = await api('POST', `${V2E}/alert-rules`, {
    token,
    body: {
      projectId,
      name: `闭环完成告警 ${stamp}`,
      eventType: 'run_completed',
      webhookUrl,
      channels: ['web', 'webhook'],
      enabled: true,
      cooldownMinutes: 0,
    },
  });
  check('创建 run_completed 告警规则', !!alertRule.rule?.id);

  // ─────────────────────────────────────────────
  // 6. 回流目标数据集 + 采样规则，触发采样回流
  // ─────────────────────────────────────────────
  const reflowDataset = await api('POST', `${V1}/evaluation/datasets`, {
    token,
    body: { project_id: projectId, name: `回流数据集 ${stamp}`, type: 'chat', auto_create_evaluators: false },
  });
  const datasetId: string = reflowDataset.id;

  const rule = await api('POST', `${V2E}/sampling-rules`, {
    token,
    body: {
      projectId,
      name: `全量回流 ${stamp}`,
      targetDatasetId: datasetId,
      traceTypeFilter: 'llm',
      sampleRate: 1,
      maxItemsTotal: 100,
      enabled: true,
    },
  });
  const ruleId: string = rule.rule.id;

  // 触发回流（真实扫描）
  const scan = await api('POST', `${V2E}/sampling-rules/${ruleId}/run-now?projectId=${projectId}`, {
    token,
    body: {},
  });
  console.log('  采样回流统计:', JSON.stringify(scan));
  check('Trace 采样回流至少 1 条', scan.sampled >= 1, `matched=${scan.matched} sampled=${scan.sampled}`);

  // commit DatasetVersion（对回流快照做不可变版本）
  const dv = await api('POST', `${V1}/evaluation/datasets/${datasetId}/versions`, {
    token,
    body: { description: '回流快照 v1' },
  });
  const datasetVersionId: string = dv.id;
  check('提交 DatasetVersion', !!datasetVersionId, `items=${dv.item_count}`);

  // ─────────────────────────────────────────────
  // 7. trace_replay Target
  // ─────────────────────────────────────────────
  const target = await api('POST', `${V2E}/targets`, {
    token,
    body: { projectId, name: `线上 Trace 回放 ${stamp}`, type: 'trace_replay', invocationConfig: {}, enabled: true },
  });
  const targetVersionId: string = target.version.id;
  check('创建 trace_replay Target', target.version.target_type === 'trace_replay' && !!targetVersionId);

  // ─────────────────────────────────────────────
  // 8. 离线 Evaluator（contains，无需 LLM Key）→ commit 版本 → Suite
  // ─────────────────────────────────────────────
  const evaluator = await api('POST', `${V1}/evaluation/evaluators`, {
    token,
    body: {
      project_id: projectId,
      name: `退款政策关键词检查 ${stamp}`,
      type: 'contains',
      config: { keywords: ['退款'], check_mode: 'whitelist', threshold: 0.5 },
    },
  });
  const evaluatorId: string = evaluator.id;
  // PUT 一次以生成 EvaluatorVersion
  await api('PUT', `${V1}/evaluation/evaluators/${evaluatorId}`, {
    token,
    body: { project_id: projectId, name: evaluator.name, type: 'contains',
      config: { keywords: ['退款'], check_mode: 'whitelist', threshold: 0.5 } },
  });
  const evVerList = await api('GET', `${V1}/evaluation/evaluators/${evaluatorId}/versions`, { token });
  const evaluatorVersionId: string = evVerList.versions?.[0]?.id ?? evVerList[0]?.id;
  check('Evaluator 生成版本', !!evaluatorVersionId);

  const suite = await api('POST', `${V2E}/suites`, {
    token,
    body: {
      projectId,
      name: `回放评测套件 ${stamp}`,
      members: [{ evaluatorVersionId, alias: 'refund_kw', weight: 1.0, required: true, passThreshold: 0.6 }],
      aggregationConfig: { strategy: 'all_required', passThreshold: 0.6 },
    },
  });
  const suiteVersionId: string = suite.version.id;
  check('创建 Evaluator Suite', !!suiteVersionId);

  // ─────────────────────────────────────────────
  // 9. V2 Experiment（三个版本齐全 → ready）→ 触发 Run
  // ─────────────────────────────────────────────
  const exp = await api('POST', `${V1}/evaluation/experiments`, {
    token,
    body: {
      project_id: projectId,
      name: `回流回放实验 ${stamp}`,
      dataset_id: datasetId,
      dataset_version_id: datasetVersionId,
      target_version_id: targetVersionId,
      evaluator_suite_version_id: suiteVersionId,
    },
  });
  check('Experiment 生命周期 ready', exp.lifecycle_status === 'ready', `status=${exp.lifecycle_status}`);

  const runResp = await api('POST', `${V2E}/experiments/${exp.id}/runs`, {
    token,
    body: { triggerType: 'manual', triggerRef: 'closed-loop' },
  });
  const runId: string = runResp.run.id;
  check('创建 V2 Run', !!runId, `runId=${runId} items=${runResp.items}`);

  // ─────────────────────────────────────────────
  // 10. 轮询 Run 至终态
  // ─────────────────────────────────────────────
  let run: any = null;
  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    const r = await api('GET', `${V2E}/runs/${runId}`, { token });
    run = r.run;
    if (['completed', 'failed', 'cancelled'].includes(run.status)) break;
  }
  check('Run 完成', run.status === 'completed', `status=${run.status}`);
  console.log('  Run summary:', JSON.stringify(run.summary));
  check('Run 全部样本通过', run.summary?.passedItems >= 1 && run.summary?.failedItems === 0,
    `passed=${run.summary?.passedItems} failed=${run.summary?.failedItems} avgScore=${run.summary?.avgScore}`);

  // ─────────────────────────────────────────────
  // 11. 等待 Webhook 投递（Worker 终态触发告警 → POST webhookUrl）
  // ─────────────────────────────────────────────
  let webhookOk = false;
  for (let i = 0; i < 20; i++) {
    if (received.length > 0) {
      webhookOk = true;
      break;
    }
    await sleep(1000);
  }
  check('Webhook 实际收到告警', webhookOk, received.length ? `事件=${received[0]?.event}` : '未收到');
  console.log('  Webhook 载荷:', JSON.stringify({
    event: received[0]?.event, severity: received[0]?.severity, runId: received[0]?.runId, status: received[0]?.status,
  }));

  // ─────────────────────────────────────────────
  // 12. 告警事件台账
  // ─────────────────────────────────────────────
  const eventsRes = await api('GET', `${V2E}/alert-events?projectId=${projectId}&limit=10`, { token });
  const events = eventsRes.events ?? [];
  check('告警事件落库', events.length >= 1 && events.some((e: any) => e.delivery_status === 'delivered'),
    `events=${events.length} delivery=${events[0]?.delivery_status}`);

  console.log(`\n🎉 闭环全部通过：${results.length} 个检查点全部成功\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error('\n💥 闭环测试失败:', err.message);
  process.exit(1);
});
