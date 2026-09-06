import { randomUUID } from 'crypto';
import { createRun, getModelConfigById, getModelConfigsByProject, PlaygroundRun, ModelConfig } from './prompts.js';
import {
  AgentTargetVersion,
  getTargetVersionById,
} from './agent-target.js';
import { invokeTarget } from './target-adapter.js';

export interface PlaygroundRunInput {
  projectId: string;
  input: string;
  promptId?: string;
  promptVersionId?: string;
  modelConfigId?: string;
  model?: string;
  targetVersionId?: string;
}

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
 * 解析 Playground 运行所使用的模型配置
 * @param projectId - 当前项目 ID
 * @param modelConfigId - 显式传入的模型配置 ID
 * @param model - 兼容旧接口保留的模型名
 * @returns 返回归属当前项目的模型配置
 */
async function resolvePlaygroundModelConfig(
  projectId: string,
  modelConfigId?: string,
  model?: string
): Promise<ModelConfig> {
  if (modelConfigId) {
    const cfg = await getModelConfigById(modelConfigId);
    if (!cfg) {
      throw new Error(`Model config not found: ${modelConfigId}`);
    }
    if (cfg.project_id !== projectId) {
      throw new Error(`Model config does not belong to project: ${modelConfigId}`);
    }
    return cfg;
  }

  if (!model) {
    throw new Error('model_config_id or model is required');
  }

  const configs = await getModelConfigsByProject(projectId);
  const matched = configs.find((cfg) => cfg.model === model || cfg.name === model);
  if (!matched) {
    throw new Error(`No model config found for model: ${model}`);
  }
  return matched;
}

/**
 * 构造一个临时的 prompt_model TargetVersion（不入库），用于 Playground 临时运行。
 * 与 ensureModelConfigTarget 不同，本函数保留当前 Playground 选择的 promptId/promptVersionId，
 * 以保证"换模型不换 Prompt"的临时调试体验一致。
 *
 * @param projectId - 项目 ID
 * @param modelConfigId - 模型配置 ID
 * @param promptId - Prompt ID（可选）
 * @param promptVersionId - Prompt 版本 ID（可选）
 * @returns 临时 TargetVersion
 */
async function buildTransientPromptVersion(
  projectId: string,
  modelConfigId: string,
  promptId?: string,
  promptVersionId?: string
): Promise<{ version: AgentTargetVersion; model: ModelConfig }> {
  const cfg = await resolvePlaygroundModelConfig(projectId, modelConfigId);
  const version: AgentTargetVersion = {
    id: `transient_${randomUUID()}`,
    target_id: `transient_target_${randomUUID()}`,
    version_number: 1,
    target_type: 'prompt_model',
    invocation_config: {
      modelConfigId: cfg.id,
      ...(promptId ? { promptId } : {}),
      ...(promptVersionId ? { promptVersionId } : {}),
    },
    input_mapping: null,
    output_mapping: null,
    source_revision: null,
    created_by: null,
    created_at: new Date(),
  };
  return { version, model: cfg };
}

/**
 * 解析 Playground 单次运行的 TargetVersion 与模型元数据。
 *
 * 优先使用显式 targetVersionId；否则按 modelConfigId/model 构造临时 prompt_model 版本，
 * 并通过 invokeTarget 统一执行，避免 Playground/Experiment/Runner 三套调用逻辑分叉。
 *
 * @param data - Playground 运行入参
 * @returns TargetVersion 与对应模型配置（http_agent 等非 prompt_model 场景下 model 为 null）
 */
async function resolvePlaygroundTarget(
  data: PlaygroundRunInput
): Promise<{ version: AgentTargetVersion; model: ModelConfig | null }> {
  if (data.targetVersionId) {
    const version = await getTargetVersionById(data.targetVersionId);
    if (!version) {
      throw new Error(`Target version not found: ${data.targetVersionId}`);
    }
    if (version.target_type === 'prompt_model') {
      const cfg = version.invocation_config as { modelConfigId?: string };
      const model = cfg.modelConfigId ? await getModelConfigById(cfg.modelConfigId) : null;
      return { version, model };
    }
    return { version, model: null };
  }

  const modelConfigId = data.modelConfigId
    ?? (data.model ? (await resolvePlaygroundModelConfig(data.projectId, undefined, data.model)).id : undefined);
  if (!modelConfigId) {
    throw new Error('model_config_id, model or target_version_id is required');
  }
  return buildTransientPromptVersion(data.projectId, modelConfigId, data.promptId, data.promptVersionId);
}

/**
 * 执行一次 Playground 真实运行
 * @param data - Playground 运行入参
 * @returns 返回真实模型调用后的运行记录
 */
export async function runPlaygroundModel(data: PlaygroundRunInput): Promise<PlaygroundRun> {
  const { version, model } = await resolvePlaygroundTarget(data);
  const targetResult = await invokeTarget(version, data.input, {
    timeoutMs: 30_000,
  });

  return createRun(data.projectId, {
    prompt_id: data.promptId,
    prompt_version_id: data.promptVersionId,
    model: model?.model ?? version.target_type,
    input: data.input,
    output: targetResult.output,
    latency_ms: targetResult.latencyMs,
    status: targetResult.error ? 'error' : 'success',
    metadata: {
      provider: model?.provider,
      config_name: model?.name,
      target_type: version.target_type,
      target_version_id: version.id,
      target_trace_id: targetResult.traceId,
      target_error: targetResult.error || undefined,
      target_tokens: targetResult.tokenUsage,
    },
  });
}

/**
 * 多模型对比运行
 * 并行对多个模型配置执行相同输入，返回对比结果。
 *
 * 每个模型都会通过 ensureModelConfigTarget 包装为 prompt_model Target，
 * 然后走 invokeTarget 统一入口，确保对比逻辑与未来 Experiment/Runner 行为一致。
 *
 * @param data - 多模型对比入参
 * @returns 对比结果汇总
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

  // 2. 并行执行各模型（真实 LLM 调用，统一走 invokeTarget）
  const runPromises = configs.map(async (cfg) => {
    const { version } = await buildTransientPromptVersion(
      projectId,
      cfg.id,
      promptId,
      promptVersionId
    );
    const targetResult = await invokeTarget(version, input, { timeoutMs: 30_000 });

    const run = await createRun(projectId, {
      prompt_id: promptId,
      prompt_version_id: promptVersionId,
      model: cfg.model,
      input,
      output: targetResult.output,
      latency_ms: targetResult.latencyMs,
      status: targetResult.error ? 'error' : 'success',
      metadata: {
        provider: cfg.provider,
        config_name: cfg.name,
        compare_mode: true,
        compare_timestamp: new Date().toISOString(),
        target_type: version.target_type,
        target_version_id: version.id,
        target_trace_id: targetResult.traceId,
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
