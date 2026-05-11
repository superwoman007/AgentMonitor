import { createRun, getModelConfigById, PlaygroundRun, ModelConfig } from './prompts.js';
import { callTargetModel } from './evaluation-target.js';

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

  // 2. 并行执行各模型（真实 LLM 调用）
  const runPromises = configs.map(async (cfg) => {
    const targetResult = await callTargetModel({
      input,
      modelConfigId: cfg.id,
      promptId: promptId || null,
      promptVersionId: promptVersionId || null,
    });

    const modelName = cfg.model;
    const providerName = cfg.provider;

    const run = await createRun(projectId, {
      prompt_id: promptId,
      prompt_version_id: promptVersionId,
      model: modelName,
      input,
      output: targetResult.output,
      latency_ms: targetResult.latencyMs,
      status: targetResult.error ? 'error' : 'success',
      metadata: {
        provider: providerName,
        config_name: cfg.name,
        compare_mode: true,
        compare_timestamp: new Date().toISOString(),
        target_error: targetResult.error || undefined,
        target_tokens: targetResult.tokenUsage,
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
