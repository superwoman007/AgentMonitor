import { queryOne } from '../db/index.js';
import { createRun, getModelConfigById, PlaygroundRun, ModelConfig } from './prompts.js';

export interface CompareInput {
  projectId: string;
  input: string;
  modelConfigIds: string[];
  promptId?: string;
  promptVersionId?: string;
}

export interface CompareResult {
  results: PlaygroundRun[];
  summary: {
    totalModels: number;
    avgLatencyMs: number;
    fastestModel: string;
    slowestModel: string;
  };
}

/**
 * 多模型对比运行
 * 并行对多个模型配置执行相同输入，返回对比结果
 */
export async function compareModels(data: CompareInput): Promise<CompareResult> {
  const { projectId, input, modelConfigIds, promptId, promptVersionId } = data;

  // 1. 验证所有模型配置存在且属于当前项目
  const configs: ModelConfig[] = [];
  for (const configId of modelConfigIds) {
    const cfg = await getModelConfigById(configId);
    if (!cfg) {
      throw new Error(`Model config not found: ${configId}`);
    }
    if (cfg.project_id !== projectId) {
      throw new Error(`Model config does not belong to project: ${configId}`);
    }
    configs.push(cfg);
  }

  // 2. 并行执行各模型（当前为模拟模式，保留真实 LLM 调用扩展点）
  const runPromises = configs.map(async (cfg) => {
    const startTime = Date.now();

    // TODO: 替换为真实 LLM 调用
    // 模拟不同模型的响应时间和输出
    const simulatedLatency = 300 + Math.floor(Math.random() * 1200);
    const modelName = cfg.model;
    const providerName = cfg.provider;

    // 模拟不同模型的输出风格差异
    const outputs: Record<string, string> = {
      'gpt-4': `GPT-4 response: Based on my analysis, the answer to "${input}" is well-structured and comprehensive.`,
      'gpt-3.5-turbo': `GPT-3.5 response: The answer to "${input}" is straightforward.`,
      'claude-3-opus': `Claude response: Here is a detailed and nuanced answer to "${input}" with careful reasoning.`,
      'claude-3-sonnet': `Claude response: A balanced answer to "${input}".`,
    };

    const output = outputs[modelName] || `[${providerName}/${modelName}] Response for: ${input}`;

    const run = await createRun(projectId, {
      prompt_id: promptId,
      prompt_version_id: promptVersionId,
      model: modelName,
      input,
      output,
      latency_ms: simulatedLatency,
      status: 'success',
      metadata: {
        provider: providerName,
        config_name: cfg.name,
        compare_mode: true,
        compare_timestamp: new Date().toISOString(),
      },
    });

    return run;
  });

  const results = await Promise.all(runPromises);

  // 3. 计算汇总统计
  const latencies = results.map((r) => r.latency_ms ?? 0);
  const avgLatency = latencies.length > 0
    ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
    : 0;

  const sortedByLatency = [...results].sort((a, b) => (a.latency_ms ?? 0) - (b.latency_ms ?? 0));
  const fastest = sortedByLatency[0];
  const slowest = sortedByLatency[sortedByLatency.length - 1];

  return {
    results,
    summary: {
      totalModels: results.length,
      avgLatencyMs: avgLatency,
      fastestModel: fastest?.model || '',
      slowestModel: slowest?.model || '',
    },
  };
}
