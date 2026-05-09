import { callLLM, extractJsonFromLLMResponse } from './llm-client.js';
import { getPromptById, getModelConfigById, getModelConfigsByProject, createPromptVersion } from './prompts.js';
import { getExperimentById, getResultsByExperiment } from './evaluation.js';

// ==================== Types ====================

export interface OptimizationSuggestion {
  original_prompt: string;
  optimized_prompt: string;
  changes: string[];
  reasoning: string;
  low_score_samples: Array<{
    input: string;
    output: string;
    expected_output: string;
    score: number;
    reasoning?: string;
  }>;
}

// ==================== Core Logic ====================

/**
 * 基于评测实验结果，分析低分样本并生成 Prompt 优化建议
 */
export async function optimizePrompt(
  promptId: string,
  experimentId: string,
  modelConfigId?: string
): Promise<OptimizationSuggestion> {
  // 1. 获取 Prompt
  const prompt = await getPromptById(promptId);
  if (!prompt) {
    throw new Error('Prompt not found');
  }

  // 2. 获取实验（必须已完成）
  const experiment = await getExperimentById(experimentId);
  if (!experiment) {
    throw new Error('Experiment not found');
  }
  if (experiment.status !== 'completed') {
    throw new Error('Experiment must be completed before optimization');
  }

  // 3. 获取实验结果，筛选低分样本（score < 0.6）
  const results = await getResultsByExperiment(experimentId);
  const lowScoreResults = results.filter(r => (r.score ?? 1) < 0.6);
  if (lowScoreResults.length === 0) {
    throw new Error('No low score samples found in experiment. All samples passed.');
  }

  // 4. 获取数据集条目，建立 ID → item 映射
  const { getDatasetItems } = await import('./evaluation.js');
  const items = await getDatasetItems(experiment.dataset_id);
  const itemMap = new Map(items.map(i => [i.id, i]));

  const lowScoreSamples = lowScoreResults.map(r => {
    const item = itemMap.get(r.dataset_item_id);
    return {
      input: item?.input || '',
      output: r.output || '',
      expected_output: item?.expected_output || '',
      score: r.score ?? 0,
      reasoning: (r.details?.reasoning as string) || '',
    };
  });

  // 5. 解析模型配置
  let modelConfig = modelConfigId ? await getModelConfigById(modelConfigId) : null;
  if (!modelConfig || !modelConfig.api_key) {
    // fallback：使用项目下第一个有 api_key 的配置
    const configs = await getModelConfigsByProject(prompt.project_id);
    modelConfig = configs.find(c => c.api_key) || null;
  }
  if (!modelConfig || !modelConfig.api_key) {
    throw new Error('No model config with API key found');
  }

  // 6. 构建优化 Prompt
  const systemPrompt = `You are an expert prompt engineer. Your task is to optimize a system prompt based on evaluation results.

Analyze the failed test cases and identify patterns in what went wrong. Then rewrite the prompt to address those weaknesses.

You must respond with a valid JSON object in this exact format:
{
  "optimized_prompt": <string: the improved prompt>,
  "changes": <array of strings: specific changes made>,
  "reasoning": <string: explanation of why these changes will help>
}

Rules:
- optimized_prompt: The rewritten prompt that addresses the failure patterns
- changes: A list of specific modifications (e.g., "Added instruction to show work", "Clarified role definition")
- reasoning: Brief analysis of failure patterns and how the changes address them
- Keep the same language as the original prompt
- Be specific and actionable in your improvements`;

  const userPrompt = `Original Prompt:
${prompt.content}

Failed Test Cases (${lowScoreSamples.length} out of ${results.length}):
${lowScoreSamples.map((s, i) => `
[Case ${i + 1}]
Input: ${s.input}
Expected Output: ${s.expected_output}
Actual Output: ${s.output}
Score: ${s.score}${s.reasoning ? `\nEvaluation Reasoning: ${s.reasoning}` : ''}
`).join('')}

Please analyze the failure patterns and return the optimized prompt as JSON only.`;

  const llmResponse = await callLLM({
    model: modelConfig.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    apiKey: modelConfig.api_key,
    baseUrl: modelConfig.base_url,
    temperature: 0.7,
    maxTokens: 2048,
  });

  const parsed = extractJsonFromLLMResponse(llmResponse.content);
  if (!parsed || !parsed.optimized_prompt) {
    throw new Error('Failed to parse optimization result from LLM');
  }

  return {
    original_prompt: prompt.content,
    optimized_prompt: String(parsed.optimized_prompt),
    changes: Array.isArray(parsed.changes) ? parsed.changes.map(String) : [],
    reasoning: String(parsed.reasoning || ''),
    low_score_samples: lowScoreSamples,
  };
}

/**
 * 应用优化建议，创建新的 Prompt 版本
 */
export async function applyOptimization(
  promptId: string,
  optimizedContent: string,
  description?: string
): Promise<{ version: unknown; prompt: unknown }> {
  const prompt = await getPromptById(promptId);
  if (!prompt) {
    throw new Error('Prompt not found');
  }

  return createPromptVersion(promptId, {
    content: optimizedContent,
    description: description || 'AI optimized prompt',
  });
}
