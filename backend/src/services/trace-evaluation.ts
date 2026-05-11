import { callLLM, extractJsonFromLLMResponse } from './llm-client.js';
import { getSpanTree, SpanTreeNode } from './span.js';
import { query, queryOne } from '../db/index.js';
import { getModelConfigById, getModelConfigsByProject } from './prompts.js';

// ==================== Types ====================

export interface TrajectoryDimension {
  name: string;
  score: number;
  reasoning: string;
}

export interface TrajectoryEvalResult {
  id: string;
  trace_id: string;
  evaluator: string;
  score: number;
  passed: boolean;
  dimensions: TrajectoryDimension[];
  details: Record<string, unknown>;
  created_at: Date;
}

export interface TrajectoryEvalInput {
  traceId: string;        // trace_id for span lookup (e.g. 'trace-001')
  traceDbId: string;      // traces.id for FK reference (UUID)
  projectId: string;
  modelConfigId?: string;
  userRequest?: string;
  expectedOutcome?: string;
}

// ==================== Core Logic ====================

/**
 * 评估 Agent 执行轨迹（Trace Evaluation）
 * 基于 Trace 的 Span 树，从 4 个维度进行 LLM 评估
 */
export async function evaluateTraceTrajectory(
  input: TrajectoryEvalInput
): Promise<TrajectoryEvalResult> {
  const { traceId, traceDbId, projectId, modelConfigId, userRequest, expectedOutcome } = input;

  // 1. 获取 Span 树
  const spanTree = await getSpanTree(traceId);
  if (!spanTree || !spanTree.rootSpan) {
    throw new Error('No span data found for this trace');
  }

  // 2. 序列化轨迹为文本
  const trajectoryText = serializeSpanTree(spanTree.rootSpan, 0);

  // 3. 解析模型配置
  let modelConfig = modelConfigId ? await getModelConfigById(modelConfigId) : null;
  if (!modelConfig || !modelConfig.api_key) {
    const configs = await getModelConfigsByProject(projectId);
    modelConfig = configs.find(c => c.api_key) || null;
  }
  if (!modelConfig || !modelConfig.api_key) {
    throw new Error('No model config with API key found');
  }

  // 4. 构建评估 Prompt
  const systemPrompt = `You are an expert AI Agent trajectory evaluator. Analyze the provided agent execution trace and score it on 4 dimensions.

You must respond with a valid JSON object in this exact format:
{
  "dimensions": [
    { "name": "tool_selection", "score": <number 0-1>, "reasoning": <string> },
    { "name": "parameter_correctness", "score": <number 0-1>, "reasoning": <string> },
    { "name": "task_completion", "score": <number 0-1>, "reasoning": <string> },
    { "name": "trajectory_quality", "score": <number 0-1>, "reasoning": <string> }
  ],
  "overall_score": <number 0-1>,
  "overall_reasoning": <string>
}

Scoring criteria:
- tool_selection: Did the agent choose appropriate tools? 1.0 = perfect choices, 0.0 = completely wrong or missing tools
- parameter_correctness: Were tool parameters filled correctly? 1.0 = all correct, 0.0 = critical errors
- task_completion: Did the agent fully satisfy the user request? 1.0 = fully complete, 0.0 = failed
- trajectory_quality: Was the reasoning efficient and logical? 1.0 = optimal path, 0.0 = redundant or illogical steps

Rules:
- Be objective and specific in reasoning
- Score must be between 0.0 and 1.0
- Return JSON only, no markdown formatting`;

  const userPrompt = `## User Request
${userRequest || 'N/A'}

## Expected Outcome
${expectedOutcome || 'N/A'}

## Agent Execution Trajectory
${trajectoryText}

Please analyze the trajectory and return the evaluation as JSON only.`;

  // 5. 调用 LLM
  const llmResponse = await callLLM({
    model: modelConfig.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    apiKey: modelConfig.api_key,
    baseUrl: modelConfig.base_url,
    temperature: 0.3,
    maxTokens: 2048,
  });

  // 6. 解析结果
  const parsed = extractJsonFromLLMResponse(llmResponse.content);
  if (!parsed || !Array.isArray(parsed.dimensions)) {
    throw new Error('Failed to parse trajectory evaluation from LLM');
  }

  const dimensions: TrajectoryDimension[] = parsed.dimensions.map((d: any) => ({
    name: String(d.name || ''),
    score: typeof d.score === 'number' ? Math.max(0, Math.min(1, d.score)) : 0,
    reasoning: String(d.reasoning || ''),
  }));

  const overallScore = typeof parsed.overall_score === 'number'
    ? Math.max(0, Math.min(1, parsed.overall_score))
    : dimensions.reduce((sum, d) => sum + d.score, 0) / dimensions.length;

  const overallReasoning = String(parsed.overall_reasoning || '');
  const passed = overallScore >= 0.6;

  // 7. 写入数据库
  const details = {
    dimensions,
    overall_reasoning: overallReasoning,
    span_count: spanTree.stats.totalSpans,
    total_latency_ms: spanTree.stats.totalLatencyMs,
    error_count: spanTree.stats.errorCount,
    model_used: modelConfig.model,
  };

  const result = await queryOne<{
    id: string;
    trace_id: string;
    evaluator: string;
    score: number;
    passed: number;
    details: string;
    created_at: string;
  }>(
    `INSERT INTO trace_eval_results (id, trace_id, evaluator, score, passed, details)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      crypto.randomUUID(),
      traceDbId,
      'trajectory_llm_judge',
      overallScore,
      passed ? 1 : 0,
      JSON.stringify(details),
    ]
  );

  if (!result) {
    throw new Error('Failed to save trajectory evaluation result');
  }

  // 更新 trace 最新评估分数
  await queryOne(
    `UPDATE traces SET latest_eval_score = $1, latest_eval_passed = $2 WHERE id = $3 RETURNING id`,
    [overallScore, passed ? 1 : 0, traceDbId]
  );

  return {
    id: result.id,
    trace_id: result.trace_id,
    evaluator: result.evaluator,
    score: result.score,
    passed: result.passed === 1,
    dimensions,
    details,
    created_at: new Date(result.created_at),
  };
}

/**
 * 获取 Trace 的轨迹评估结果
 */
export async function getTraceTrajectoryEvals(traceId: string): Promise<TrajectoryEvalResult[]> {
  const rows = await query<{
    id: string;
    trace_id: string;
    evaluator: string;
    score: number;
    passed: number;
    details: string;
    created_at: string;
  }>(
    `SELECT * FROM trace_eval_results
     WHERE trace_id = $1 AND evaluator = 'trajectory_llm_judge'
     ORDER BY created_at DESC`,
    [traceId]
  );

  return rows.map(row => {
    let details: Record<string, unknown> = {};
    if (row.details) {
      try { details = JSON.parse(row.details); } catch { /* ignore */ }
    }
    const dimensions = (details.dimensions as TrajectoryDimension[]) || [];
    return {
      id: row.id,
      trace_id: row.trace_id,
      evaluator: row.evaluator,
      score: row.score,
      passed: row.passed === 1,
      dimensions,
      details,
      created_at: new Date(row.created_at),
    };
  });
}

// ==================== Helpers ====================

function serializeSpanTree(node: SpanTreeNode, depth: number): string {
  const indent = '  '.repeat(depth);
  const lines: string[] = [];

  const statusEmoji = node.status === 'error' ? '❌' : node.status === 'ok' ? '✅' : '⏳';
  lines.push(`${indent}[${statusEmoji}] ${node.name} (${node.traceType})`);

  if (node.input) {
    const inputStr = typeof node.input === 'string' ? node.input : JSON.stringify(node.input).slice(0, 500);
    lines.push(`${indent}  Input: ${inputStr}`);
  }

  if (node.output) {
    const outputStr = typeof node.output === 'string' ? node.output : JSON.stringify(node.output).slice(0, 500);
    lines.push(`${indent}  Output: ${outputStr}`);
  }

  if (node.error) {
    lines.push(`${indent}  Error: ${node.error}`);
  }

  if (node.latencyMs) {
    lines.push(`${indent}  Latency: ${node.latencyMs}ms`);
  }

  for (const child of node.children) {
    lines.push(serializeSpanTree(child, depth + 1));
  }

  return lines.join('\n');
}
