import {
  getExperimentById,
  getDatasetItems,
  getEvaluatorsByProject,
  createResult,
  completeExperiment,
  EvaluationExperiment,
} from './evaluation.js';
import { getModelConfigById } from './prompts.js';
import { callLLM, buildJudgePrompt, extractJsonFromLLMResponse } from './llm-client.js';

/**
 * 运行评测实验
 * 遍历数据集所有条目，使用项目中的评估器进行评分，生成结果记录
 * @param onProgress - 每处理完一条后的进度回调 (currentIndex, totalItems)
 */
export async function runExperiment(
  experimentId: string,
  onProgress?: (current: number, total: number, itemResult?: { itemId: string; score: number; passed: boolean }) => void
): Promise<EvaluationExperiment | null> {
  const experiment = await getExperimentById(experimentId);
  if (!experiment) return null;

  // 1. 获取数据集条目
  const items = await getDatasetItems(experiment.dataset_id);
  if (items.length === 0) {
    // 空数据集直接完成
    return completeExperiment(experimentId, {
      total_items: 0,
      passed: 0,
      failed: 0,
      avg_score: 0,
    });
  }

  // 2. 获取项目中的评估器（优先使用实验关联的，否则使用项目第一个）
  const evaluators = await getEvaluatorsByProject(experiment.project_id);
  const defaultEvaluator = evaluators[0];

  // 2.1 如果评估器是 llm_judge 且配置了 model_config_id，预加载模型配置
  let judgeModelConfig: { provider: string; model: string; api_key: string; base_url: string | null } | null = null;
  if (defaultEvaluator?.type === 'llm_judge' && defaultEvaluator?.model_config_id) {
    const cfg = await getModelConfigById(defaultEvaluator.model_config_id);
    if (cfg && cfg.api_key) {
      judgeModelConfig = {
        provider: cfg.provider,
        model: cfg.model,
        api_key: cfg.api_key,
        base_url: cfg.base_url,
      };
    }
  }

  // 3. 逐条执行评估
  let passedCount = 0;
  let totalScore = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const startTime = Date.now();

    // 模拟模型输出（TODO: 替换为真实模型调用）
    const simulatedOutput = simulateModelOutput(item.input, item.expected_output);
    const latencyMs = Date.now() - startTime;

    // 执行评估
    const evaluation = await evaluateOutput(
      simulatedOutput,
      item.expected_output || '',
      defaultEvaluator?.type || 'exact_match',
      defaultEvaluator?.config || {},
      judgeModelConfig ?? undefined
    );

    // 创建结果记录
    await createResult(experimentId, item.id, {
      evaluator_id: defaultEvaluator?.id || undefined,
      output: simulatedOutput,
      score: evaluation.score,
      passed: evaluation.passed,
      details: evaluation.details,
      latency_ms: latencyMs,
    });

    if (evaluation.passed) passedCount++;
    totalScore += evaluation.score;

    // 广播进度
    if (onProgress) {
      onProgress(i + 1, items.length, {
        itemId: item.id,
        score: evaluation.score,
        passed: evaluation.passed,
      });
    }
  }

  // 4. 完成实验
  const avgScore = totalScore / items.length;
  return completeExperiment(experimentId, {
    total_items: items.length,
    passed: passedCount,
    failed: items.length - passedCount,
    avg_score: avgScore,
  });
}

/**
 * 模拟模型输出
 * 根据输入和预期输出，生成一个有一定概率正确的模拟结果
 */
function simulateModelOutput(input: string, expectedOutput: string | null): string {
  // 简单规则：如果是数学题，尝试给出正确答案
  // 否则返回预期输出（模拟完美模型）或一个变体（模拟不完美模型）
  if (!expectedOutput) return 'No output available';

  // 80% 概率返回正确答案，20% 概率返回错误答案
  if (Math.random() > 0.2) {
    return expectedOutput;
  }

  // 模拟错误：添加干扰字符
  return expectedOutput + ' (with some noise)';
}

/**
 * 评估输出质量
 */
async function evaluateOutput(
  output: string,
  expected: string,
  evaluatorType: string,
  config: Record<string, unknown>,
  modelConfig?: { provider: string; model: string; api_key: string; base_url: string | null }
): Promise<{ score: number; passed: boolean; details: Record<string, unknown> }> {
  switch (evaluatorType) {
    case 'exact_match':
      return evaluateExactMatch(output, expected, config);
    case 'contains':
      return evaluateContains(output, expected, config);
    case 'regex':
      return evaluateRegex(output, expected, config);
    case 'similarity':
      return evaluateSimilarity(output, expected, config);
    case 'llm_judge':
      return await evaluateLLMJudge(output, expected, config, modelConfig);
    default:
      return evaluateExactMatch(output, expected, config);
  }
}

function evaluateExactMatch(
  output: string,
  expected: string,
  config: Record<string, unknown>
): { score: number; passed: boolean; details: Record<string, unknown> } {
  const caseSensitive = config.case_sensitive === true;
  const a = caseSensitive ? output.trim() : output.trim().toLowerCase();
  const b = caseSensitive ? expected.trim() : expected.trim().toLowerCase();
  const matched = a === b;

  return {
    score: matched ? 1 : 0,
    passed: matched,
    details: { matched, case_sensitive: caseSensitive },
  };
}

function evaluateContains(
  output: string,
  _expected: string,
  config: Record<string, unknown>
): { score: number; passed: boolean; details: Record<string, unknown> } {
  // Length check mode
  const minLength = config.min_length as number | undefined;
  const maxLength = config.max_length as number | undefined;
  if (minLength !== undefined || maxLength !== undefined) {
    const len = output.length;
    const minOk = minLength === undefined || len >= minLength;
    const maxOk = maxLength === undefined || len <= maxLength;
    const passed = minOk && maxOk;
    const score = passed ? 1 : 0;
    return {
      score,
      passed,
      details: { length: len, min_length: minLength, max_length: maxLength },
    };
  }

  // Keyword mode
  const keywords = (config.keywords as string[]) || [];
  const checkMode = (config.check_mode as string) || 'whitelist';
  const outputLower = output.toLowerCase();

  let matchedCount = 0;
  for (const keyword of keywords) {
    if (outputLower.includes(keyword.toLowerCase())) {
      matchedCount++;
    }
  }

  let score: number;
  let passed: boolean;
  const threshold = (config.threshold as number) || 0.5;

  if (checkMode === 'blacklist') {
    // Blacklist: should NOT contain any keyword. matchedCount should be 0.
    score = keywords.length > 0 ? 1 - matchedCount / keywords.length : 1;
    passed = matchedCount === 0;
  } else {
    // Whitelist: should contain keywords.
    score = keywords.length > 0 ? matchedCount / keywords.length : 0;
    passed = score >= threshold;
  }

  return {
    score: Number(score.toFixed(2)),
    passed,
    details: { keywords, matched_count: matchedCount, threshold, check_mode: checkMode },
  };
}

function evaluateRegex(
  output: string,
  _expected: string,
  config: Record<string, unknown>
): { score: number; passed: boolean; details: Record<string, unknown> } {
  const pattern = config.pattern as string;
  if (!pattern) {
    return { score: 0, passed: false, details: { error: 'No regex pattern provided' } };
  }

  try {
    const regex = new RegExp(pattern);
    const matched = regex.test(output);
    return {
      score: matched ? 1 : 0,
      passed: matched,
      details: { pattern, matched },
    };
  } catch {
    return { score: 0, passed: false, details: { error: 'Invalid regex pattern', pattern } };
  }
}

function evaluateSimilarity(
  output: string,
  expected: string,
  config: Record<string, unknown>
): { score: number; passed: boolean; details: Record<string, unknown> } {
  // 简化版：基于单词重叠率的相似度（Jaccard 近似）
  const outputWords = new Set(output.toLowerCase().split(/\s+/));
  const expectedWords = new Set(expected.toLowerCase().split(/\s+/));

  const intersection = new Set([...outputWords].filter((x) => expectedWords.has(x)));
  const union = new Set([...outputWords, ...expectedWords]);

  const similarity = union.size > 0 ? intersection.size / union.size : 0;
  const threshold = (config.threshold as number) || 0.8;
  const passed = similarity >= threshold;

  return {
    score: Number(similarity.toFixed(2)),
    passed,
    details: { similarity, threshold, method: 'word_overlap' },
  };
}

async function evaluateLLMJudge(
  output: string,
  expected: string,
  config: Record<string, unknown>,
  modelConfig?: { provider: string; model: string; api_key: string; base_url: string | null }
): Promise<{ score: number; passed: boolean; details: Record<string, unknown> }> {
  const criteria = (config.criteria as string) || 'general';
  const threshold = (config.threshold as number) || 0.6;

  // 如果没有配置模型，fallback 到启发式评分
  if (!modelConfig || !modelConfig.api_key) {
    return evaluateLLMJudgeHeuristic(output, expected, criteria, threshold);
  }

  try {
    const messages = buildJudgePrompt(output, expected, criteria);
    const response = await callLLM({
      model: modelConfig.model,
      messages,
      temperature: 0.3,
      apiKey: modelConfig.api_key,
      baseUrl: modelConfig.base_url,
    });

    const parsed = extractJsonFromLLMResponse(response.content);
    if (!parsed) {
      throw new Error('Failed to parse LLM judge response');
    }

    const score = typeof parsed.score === 'number' ? Math.max(0, Math.min(1, parsed.score)) : 0;
    const passed = typeof parsed.passed === 'boolean' ? parsed.passed : score >= threshold;
    const reasoning = typeof parsed.reasoning === 'string' ? parsed.reasoning : '';
    const dimensions = parsed.dimensions && typeof parsed.dimensions === 'object'
      ? parsed.dimensions as Record<string, unknown>
      : {};

    return {
      score: Number(score.toFixed(2)),
      passed,
      details: {
        criteria,
        threshold,
        method: 'llm_judge',
        reasoning,
        dimensions,
        raw_response: response.content.slice(0, 500),
      },
    };
  } catch (error) {
    // API 失败时 fallback 到启发式，但标记 judge_failed
    const heuristic = evaluateLLMJudgeHeuristic(output, expected, criteria, threshold);
    return {
      ...heuristic,
      details: {
        ...heuristic.details,
        judge_failed: true,
        judge_error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

function evaluateLLMJudgeHeuristic(
  output: string,
  expected: string,
  criteria: string,
  threshold: number
): { score: number; passed: boolean; details: Record<string, unknown> } {
  let score = 0;
  const outputLower = output.toLowerCase();
  const expectedLower = expected.toLowerCase();

  // 基础分：如果包含预期输出内容
  if (expectedLower && outputLower.includes(expectedLower)) {
    score += 0.6;
  }

  // 长度合理性（不过短）
  if (output.length > 5) {
    score += 0.2;
  }

  // 结构化程度（有标点、句子）
  if (/[.!?。！？]/.test(output)) {
    score += 0.2;
  }

  score = Math.min(1, score);
  const passed = score >= threshold;

  return {
    score: Number(score.toFixed(2)),
    passed,
    details: { criteria, threshold, method: 'heuristic_fallback' },
  };
}
