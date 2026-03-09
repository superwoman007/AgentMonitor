import { AgentMonitor } from './src/index.js';

const apiKey =
  process.env.MONITOR_API_KEY ||
  process.env.AGENTMONITOR_API_KEY ||
  '';

if (!apiKey) {
  console.error('Missing API key. Set MONITOR_API_KEY or AGENTMONITOR_API_KEY.');
  process.exit(1);
}

const baseUrl =
  process.env.MONITOR_API_URL ||
  process.env.AGENTMONITOR_BASE_URL ||
  'http://localhost:3000';

const apiPrefix =
  process.env.MONITOR_API_PREFIX ||
  process.env.AGENTMONITOR_API_PREFIX ||
  undefined;

const rawCount =
  process.env.MONITOR_TEST_COUNT ||
  process.env.AGENTMONITOR_TEST_COUNT ||
  '';

const parsedCount = Number.parseInt(rawCount, 10);
const total = Number.isFinite(parsedCount) && parsedCount > 0 ? parsedCount : 20;

const projectIdFromKey = apiKey.includes('_') ? apiKey.split('_')[0] : '';
const projectId =
  process.env.MONITOR_PROJECT_ID ||
  process.env.AGENTMONITOR_PROJECT_ID ||
  projectIdFromKey;

if (!projectId) {
  console.error('Missing project id for decisions.');
  console.error('Set MONITOR_PROJECT_ID or use API key like <projectId>_xxxx.');
  process.exit(1);
}

const monitor = AgentMonitor.init({
  apiKey,
  baseUrl,
  apiPrefix,
  enableBreakpoints: false,
  bufferSize: Math.max(200, total * 6),
  flushInterval: 30_000,
});

const runId = `sdk_test_${Date.now()}`;

const models = ['gpt-4o-mini', 'gpt-4', 'gpt-3.5-turbo', 'claude-3-opus'];
const toolNames = ['search', 'calculator', 'db_query', 'calendar', 'router'];
const decisionTypes = ['routing', 'policy', 'ranking', 'risk', 'fallback'];
const decisionMakers = ['rule', 'llm', 'human', 'hybrid'] as const;

function makeUsage(index: number) {
  const promptTokens = 40 + (index * 7) % 120;
  const completionTokens = 60 + (index * 11) % 160;
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens,
  };
}

function makeDecisionOptions(index: number) {
  const base = 0.45 + (index % 10) * 0.02;
  return [
    {
      name: 'option_a',
      score: Number((base + 0.05).toFixed(2)),
      pros: ['fast', 'low_cost'],
      cons: ['limited_context'],
      metadata: { rank: 1 },
    },
    {
      name: 'option_b',
      score: Number((base + 0.15).toFixed(2)),
      pros: ['balanced', 'stable'],
      cons: ['moderate_cost'],
      metadata: { rank: 2 },
    },
    {
      name: 'option_c',
      score: Number((base - 0.05).toFixed(2)),
      pros: ['high_accuracy'],
      cons: ['high_latency', 'high_cost'],
      metadata: { rank: 3 },
    },
  ];
}

async function main() {
  console.log('Generating SDK test dataset...');
  console.log(`Target: ${total} each for session/message/tool_call/llm/decision`);
  console.log(`Base URL: ${baseUrl}`);
  console.log(`Project ID: ${projectId}`);

  const counters = {
    session: 0,
    message: 0,
    tool_call: 0,
    llm: 0,
    decision: 0,
  };

  const baseTime = Date.now() - total * 60_000;

  for (let i = 1; i <= total; i += 1) {
    const sessionId = `${runId}_session_${String(i).padStart(2, '0')}`;
    const agentId = `sdk_test_agent_${(i % 3) + 1}`;
    const sessionStart = baseTime + i * 60_000;

    monitor.startSession(sessionId, {
      runId,
      index: i,
      agentId,
      source: 'sdk-test-dataset',
    });

    const messageTime = new Date(sessionStart + 5_000).toISOString();
    const role = i % 2 === 0 ? 'assistant' : 'user';
    await monitor.trackMessage({
      sessionId,
      role,
      content: `Test message ${i} from ${role}`,
      timestamp: messageTime,
      metadata: {
        channel: i % 2 === 0 ? 'web' : 'mobile',
        locale: 'zh-CN',
        runId,
      },
    });
    counters.message += 1;

    const toolLatency = 120 + (i * 17) % 800;
    const toolStart = new Date(sessionStart + 10_000);
    const toolEnd = new Date(toolStart.getTime() + toolLatency);
    const toolName = toolNames[i % toolNames.length];
    const toolError = i % 8 === 0;
    await monitor.trackToolCall({
      id: `${runId}_tool_${i}`,
      sessionId,
      toolName,
      inputParams: {
        query: `query_${i}`,
        limit: 3 + (i % 5),
      },
      output: toolError ? undefined : { items: [`result_${i}_1`, `result_${i}_2`] },
      error: toolError ? `Tool ${toolName} failed` : undefined,
      latencyMs: toolLatency,
      startedAt: toolStart.toISOString(),
      endedAt: toolEnd.toISOString(),
    });
    counters.tool_call += 1;

    const model = models[i % models.length];
    const llmLatency = 220 + (i * 23) % 900;
    const llmStart = new Date(sessionStart + 15_000);
    const llmEnd = new Date(llmStart.getTime() + llmLatency);
    const llmError = i % 9 === 0;
    const usage = makeUsage(i);

    await monitor.trace({
      sessionId,
      agentId,
      traceType: 'llm',
      name: model,
      input: {
        model,
        messages: [{ role: 'user', content: `Question ${i}?` }],
        temperature: 0.7,
      },
      output: llmError
        ? { error: 'Model timeout' }
        : {
            id: `chatcmpl_${runId}_${i}`,
            choices: [{ message: { content: `Answer ${i}` } }],
            usage,
          },
      metadata: {
        model,
        provider: 'mock',
        usage,
        runId,
      },
      startedAt: llmStart.toISOString(),
      endedAt: llmEnd.toISOString(),
      latencyMs: llmLatency,
      status: llmError ? 'error' : 'success',
      error: llmError ? 'LLM timeout' : undefined,
    });
    counters.llm += 1;

    const options = makeDecisionOptions(i);
    const selectedOption = options[i % options.length].name;
    const decisionMaker = decisionMakers[i % decisionMakers.length];
    await monitor.trackDecision({
      projectId,
      sessionId,
      decisionType: decisionTypes[i % decisionTypes.length],
      context: {
        ticketId: `TKT-${1000 + i}`,
        priority: i % 3 === 0 ? 'high' : 'normal',
      },
      selectedOption,
      confidence: Number((0.6 + (i % 10) * 0.03).toFixed(2)),
      reasoning: `Selected ${selectedOption} based on cost/latency tradeoff`,
      decisionMaker,
      latencyMs: 40 + (i * 13) % 240,
      metadata: {
        runId,
        index: i,
        scenario: 'sdk-test-dataset',
      },
      options,
    });
    counters.decision += 1;

    await monitor.endSession(sessionId);
    counters.session += 1;
  }

  await monitor.flush();
  monitor.close();

  console.log('Done. Summary:');
  console.log(counters);
}

main().catch((error) => {
  console.error('Failed to generate dataset:', error);
  process.exit(1);
});
