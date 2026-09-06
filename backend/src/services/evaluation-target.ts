import { callLLM } from './llm-client.js';
import { getPromptById, getVersionById, getModelConfigById } from './prompts.js';

export interface TargetCallOptions {
  input: string;
  promptId?: string | null;
  promptVersionId?: string | null;
  modelConfigId?: string | null;
  runConfig?: Record<string, unknown>;
}

export interface TargetCallResult {
  output: string;
  latencyMs: number;
  traceId?: string;
  tokenUsage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  error?: string;
}

export async function callTargetModel(options: TargetCallOptions): Promise<TargetCallResult> {
  const startTime = Date.now();

  try {
    const modelConfig = options.modelConfigId ? await getModelConfigById(options.modelConfigId) : null;

    let messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];
    let promptConfig: Record<string, unknown> = {};

    if (options.promptVersionId) {
      // Truth Repair-7: 优先按 promptVersionId 精确加载历史版本快照，保证历史实验可按版本复现
      const version = await getVersionById(options.promptVersionId);
      if (!version) {
        throw new Error(`Prompt version not found: ${options.promptVersionId}`);
      }
      // 校验版本确实属于该 prompt，防止 promptId 与 promptVersionId 错配
      if (options.promptId && version.prompt_id !== options.promptId) {
        throw new Error(
          `Prompt version ${options.promptVersionId} does not belong to prompt ${options.promptId} (belongs to ${version.prompt_id})`
        );
      }
      messages = [
        { role: 'system', content: version.content },
        { role: 'user', content: options.input },
      ];
      promptConfig = version.config || {};
    } else if (options.promptId) {
      // 未指定版本时回退到 prompt 当前内容（用于未绑定版本的临时运行）
      const prompt = await getPromptById(options.promptId);
      if (!prompt) {
        throw new Error(`Prompt not found: ${options.promptId}`);
      }
      messages = [
        { role: 'system', content: prompt.content },
        { role: 'user', content: options.input },
      ];
      promptConfig = prompt.config || {};
    } else if (modelConfig) {
      messages = [{ role: 'user', content: options.input }];
    } else {
      throw new Error('No prompt or model config specified for target call');
    }

    if (!modelConfig || !modelConfig.api_key) {
      throw new Error('Target model config missing or has no API key');
    }

    // 合并配置：runConfig（实验级） > promptConfig（Prompt级） > 默认值
    const mergedConfig = {
      temperature: (options.runConfig?.temperature as number) ?? (promptConfig.temperature as number) ?? 0.7,
      maxTokens: (options.runConfig?.max_tokens as number) ?? (promptConfig.max_tokens as number) ?? 2048,
      timeoutMs: (options.runConfig?.timeout_ms as number) ?? (promptConfig.timeout_ms as number) ?? 30000,
    };

    const response = await callLLM({
      model: modelConfig.model,
      messages,
      apiKey: modelConfig.api_key,
      baseUrl: modelConfig.base_url,
      temperature: mergedConfig.temperature,
      maxTokens: mergedConfig.maxTokens,
      timeoutMs: mergedConfig.timeoutMs,
    });

    const latencyMs = Date.now() - startTime;

    return {
      output: response.content,
      latencyMs,
      tokenUsage: response.usage
        ? {
            promptTokens: response.usage.prompt_tokens ?? 0,
            completionTokens: response.usage.completion_tokens ?? 0,
            totalTokens: response.usage.total_tokens ?? 0,
          }
        : undefined,
    };
  } catch (error) {
    return {
      output: '',
      latencyMs: Date.now() - startTime,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
