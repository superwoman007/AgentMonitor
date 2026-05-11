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
import { callTargetModel } from './evaluation-target.js';

/**
 * 运行评测实验
 * 遍历数据集所有条目，使用项目中的评估器进行评分，生成结果记录
 * @param onProgress - 每处理完一条后的进度回调
 */
export async function runExperiment(
  experimentId: string,
  onProgress?: (current: number, total: number, itemResult?: { itemId: string; score: number; passed: boolean }) => void
): Promise<EvaluationExperiment | null> {
  const experiment = await getExperimentById(experimentId);
  if (!experiment) return null;

  // 校验：必须指定被测对象
  if (!experiment.prompt_id && !experiment.target_model_config_id) {
    return failExperiment(experimentId, 'This experiment has no target model or prompt configured. Please recreate with target_model_config_id or prompt_id.');
  }

  const items = await getDatasetItems(experiment.dataset_id);
  if (items.length === 0) {
    return completeExperiment(experimentId, { total_items: 0, passed: 0, failed: 0, avg_score: 0 });
  }

  // 1. 获取评估器
  const evaluators = await getEvaluatorsByProject(experiment.project_id);
  const defaultEvaluator = evaluators[0];

  let judgeModelConfig = null;
  if (defaultEvaluator?.type === 'llm_judge' && defaultEvaluator?.model_config_id) {
    const cfg = await getModelConfigById(defaultEvaluator.model_config_id);
    if (cfg?.api_key) {
      judgeModelConfig = { provider: cfg.provider, model: cfg.model, api_key: cfg.api_key, base_url: cfg.base_url };
    }
  }

  // 2. 解析运行配置
  const runConfig = experiment.run_config || {};
  const parallelLimit = (runConfig.parallel_limit as number) || 3;
  const retryCount = (runConfig.retry_count as number) || 2;

  // 3. 准备被测对象配置
  const targetConfig = {
    promptId: experiment.prompt_id,
    promptVersionId: experiment.prompt_version_id,
    modelConfigId: experiment.target_model_config_id,
    runConfig,
  };

  // 4. 并发执行
  let passedCount = 0;
  let totalScore = 0;
  let totalTokens = 0;

  const executeItem = async (item: typeof items[0], index: number): Promise<void> => {
    let lastError: string | undefined;
    let targetResult: Awaited<ReturnType<typeof callTargetModel>> | null = null;

    for (let attempt = 0; attempt <= retryCount; attempt++) {
      targetResult = await callTargetModel({
        input: item.input,
        ...targetConfig,
      });

      if (!targetResult.error) break;
      lastError = targetResult.error;

      if (attempt < retryCount) {
        await delay(Math.min(1000 * Math.pow(2, attempt), 8000));
      }
    }

    const actualOutput = targetResult?.output || '';
    const latencyMs = targetResult?.latencyMs || 0;

    if (targetResult?.tokenUsage) {
      totalTokens += targetResult.tokenUsage.totalTokens;
    }

    const evaluation = await evaluateOutput(
      actualOutput,
      item.expected_output || '',
      defaultEvaluator?.type || 'exact_match',
      defaultEvaluator?.config || {},
      judgeModelConfig ?? undefined
    );

    await createResult(experimentId, item.id, {
      evaluator_id: defaultEvaluator?.id || undefined,
      output: actualOutput,
      score: evaluation.score,
      passed: evaluation.passed,
      details: {
        ...evaluation.details,
        target_latency_ms: latencyMs,
        target_error: lastError || undefined,
        target_tokens: targetResult?.tokenUsage,
        retries: lastError ? retryCount : 0,
      },
      latency_ms: latencyMs,
    });

    if (evaluation.passed) passedCount++;
    totalScore += evaluation.score;

    onProgress?.(index + 1, items.length, {
      itemId: item.id,
      score: evaluation.score,
      passed: evaluation.passed,
    });
  };

  const pool = new ConcurrencyPool(parallelLimit);
  for (let i = 0; i < items.length; i++) {
    pool.run(() => executeItem(items[i], i));
  }
  await pool.done();

  // 5. 完成实验
  const avgScore = totalScore / items.length;
  return completeExperiment(experimentId, {
    total_items: items.length,
    passed: passedCount,
    failed: items.length - passedCount,
    avg_score: avgScore,
    total_tokens: totalTokens,
  });
}

async function failExperiment(experimentId: string, reason: string): Promise<EvaluationExperiment | null> {
  const { queryOne } = await import('../db/index.js');
  const { config: dbConfig } = await import('../config.js');
  const nowExpr = dbConfig.dbType === 'sqlite' ? "datetime('now')" : 'NOW()';
  const row = await queryOne<EvaluationExperiment>(
    `UPDATE evaluation_experiments SET status = 'failed', completed_at = ${nowExpr}, results_summary = $1 WHERE id = $2 RETURNING *`,
    [JSON.stringify({ error: reason }), experimentId]
  );
  if (row) {
    if (typeof row.model_config === 'string') row.model_config = JSON.parse(row.model_config);
    if (typeof row.results_summary === 'string') row.results_summary = JSON.parse(row.results_summary);
    if (typeof row.run_config === 'string') row.run_config = JSON.parse(row.run_config);
  }
  return row;
}

// ==================== Concurrency Pool ====================

class ConcurrencyPool {
  private running = 0;
  private queue: Array<() => Promise<void>> = [];
  private resolvers: Array<() => void> = [];

  constructor(private limit: number) {}

  run(fn: () => Promise<void>): void {
    if (this.running < this.limit) {
      this.running++;
      fn().finally(() => this.doneOne());
    } else {
      this.queue.push(fn);
    }
  }

  private doneOne(): void {
    if (this.queue.length > 0) {
      const fn = this.queue.shift()!;
      fn().finally(() => this.doneOne());
    } else {
      this.running--;
      if (this.running === 0) {
        this.resolvers.forEach(r => r());
        this.resolvers = [];
      }
    }
  }

  done(): Promise<void> {
    if (this.running === 0 && this.queue.length === 0) return Promise.resolve();
    return new Promise(resolve => this.resolvers.push(resolve));
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ==================== Evaluate Output ====================

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
    score = keywords.length > 0 ? 1 - matchedCount / keywords.length : 1;
    passed = matchedCount === 0;
  } else {
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

  if (expectedLower && outputLower.includes(expectedLower)) {
    score += 0.6;
  }

  if (output.length > 5) {
    score += 0.2;
  }

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
