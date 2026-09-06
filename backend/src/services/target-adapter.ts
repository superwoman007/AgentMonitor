import { randomUUID } from 'crypto';
import { AgentTargetVersion, invokePromptModelTarget, TargetInvokeResult } from './agent-target.js';

export interface TargetInvokeContext {
  runId?: string;
  experimentId?: string;
  runItemId?: string;
  traceId?: string;
  sessionId?: string;
  timeoutMs?: number;
}

export interface HttpAgentInvocationConfig {
  method?: string;
  url: string;
  authentication?: {
    type: 'bearer' | 'api_key' | 'none';
    secretRef?: string;
    headerName?: string;
  };
  headers?: Record<string, string>;
  timeoutMs?: number;
  asyncMode?: boolean;
  requestTemplate?: Record<string, unknown>;
  outputPath?: string;
  traceIdPath?: string;
  usagePath?: string;
}

/**
 * Target 适配器统一入口：按 AgentTargetVersion.target_type 分派到对应执行器。
 *
 * Playground、Experiment、未来 Runner 都必须走本入口，禁止各自实现一套调用逻辑，
 * 以确保 prompt_model 与 http_agent 等被测对象行为一致、可验证、可复现。
 *
 * @param version - 不可变 Target 版本
 * @param input - 用户输入字符串
 * @param context - 运行上下文（runId/traceId/超时等）
 * @returns 标准化调用结果
 */
export async function invokeTarget(
  version: AgentTargetVersion,
  input: string,
  context: TargetInvokeContext = {}
): Promise<TargetInvokeResult> {
  switch (version.target_type) {
    case 'prompt_model':
      return invokePromptModelTarget(version, input);
    case 'http_agent':
      return invokeHttpAgent(version, input, context);
    case 'external_runner':
      throw new Error('external_runner target is executed by developer runner, not inline');
    case 'trace_replay':
      throw new Error('trace_replay target does not perform live invocation');
    default:
      throw new Error(`Unsupported target type: ${String(version.target_type)}`);
  }
}

/**
 * 按 JSON Pointer 路径（如 /output/answer）从对象中读取值。
 * @param obj - 源对象
 * @param pointer - RFC 6901 风格路径，空字符串返回整个对象
 * @returns 命中的值；未命中返回 undefined
 */
function readJsonPointer(obj: unknown, pointer?: string): unknown {
  if (!pointer) return obj;
  if (typeof obj !== 'object' || obj === null) return undefined;
  const segments = pointer.split('/').filter((segment) => segment.length > 0).map((segment) =>
    segment.replace(/~1/g, '/').replace(/~0/g, '~')
  );
  let current: unknown = obj;
  for (const segment of segments) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * 递归渲染请求模板中的白名单变量。
 * 仅支持 {{sample.input}}、{{sample.expected}}、{{run.id}} 等固定变量，不允许任意表达式或 JS eval。
 * @param template - 模板值（对象/数组/字符串/原子值）
 * @param variables - 允许使用的变量映射
 * @returns 渲染后的值
 */
function renderTemplate(template: unknown, variables: Record<string, unknown>): unknown {
  if (typeof template === 'string') {
    return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, expression: string) => {
      const parts = expression.split('.');
      let current: unknown = variables;
      for (const part of parts) {
        if (current === null || current === undefined || typeof current !== 'object') return '';
        current = (current as Record<string, unknown>)[part];
      }
      if (current === undefined || current === null) return '';
      if (typeof current === 'object') return JSON.stringify(current);
      return String(current);
    });
  }
  if (Array.isArray(template)) {
    return template.map((item) => renderTemplate(item, variables));
  }
  if (template && typeof template === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(template as Record<string, unknown>)) {
      result[key] = renderTemplate(value, variables);
    }
    return result;
  }
  return template;
}

/**
 * 从对象中尝试提取 token 用量。
 * @param value - 任意值
 * @returns 标准化 token 用量或 undefined
 */
function extractTokenUsage(value: unknown): TargetInvokeResult['tokenUsage'] | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const prompt = record.inputTokens ?? record.promptTokens ?? record.prompt_tokens ?? record.prompt;
  const completion = record.outputTokens ?? record.completionTokens ?? record.completion_tokens ?? record.completion;
  const total = record.totalTokens ?? record.total_tokens ?? record.total;
  if (prompt === undefined && completion === undefined && total === undefined) return undefined;
  return {
    promptTokens: typeof prompt === 'number' ? prompt : 0,
    completionTokens: typeof completion === 'number' ? completion : 0,
    totalTokens: typeof total === 'number' ? total : 0,
  };
}

/**
 * 调用 HTTP Agent Target（同步模式）。
 * @param version - Target 版本
 * @param input - 用户输入
 * @param context - 运行上下文
 * @returns 标准化结果
 */
async function invokeHttpAgent(
  version: AgentTargetVersion,
  input: string,
  context: TargetInvokeContext
): Promise<TargetInvokeResult> {
  const config = version.invocation_config as unknown as HttpAgentInvocationConfig;
  if (!config.url) {
    throw new Error('http_agent target requires url');
  }
  if (config.asyncMode) {
    throw new Error('http_agent asyncMode (202 callback) is not supported in P0 inline execution');
  }

  const requestId = randomUUID();
  const runId = context.runId ?? `run_${Date.now()}`;
  const traceId = context.traceId ?? randomUUID().replace(/-/g, '');
  const sessionId = context.sessionId ?? `eval_${runId}`;
  const timeoutMs = context.timeoutMs ?? config.timeoutMs ?? 60_000;

  const variables: Record<string, unknown> = {
    sample: { input, expected: {}, metadata: {} },
    run: { id: runId, experimentId: context.experimentId ?? '' },
    runItem: { id: context.runItemId ?? '' },
    context: { traceId, sessionId, timeoutMs },
    requestId,
  };

  const body = config.requestTemplate
    ? renderTemplate(config.requestTemplate, variables)
    : {
        protocolVersion: '1.0',
        requestId,
        run: { id: runId, experimentId: context.experimentId ?? '' },
        sample: { id: context.runItemId ?? '', input: { messages: [{ role: 'user', content: input }] } },
        context: { traceId, sessionId, timeoutMs },
      };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-AgentMonitor-Run-Id': runId,
    ...(context.runItemId ? { 'X-AgentMonitor-Run-Item-Id': context.runItemId } : {}),
    'X-AgentMonitor-Request-Id': requestId,
    ...(config.headers ?? {}),
  };

  const auth = config.authentication;
  if (auth && auth.type !== 'none') {
    if (auth.type === 'bearer') {
      headers.Authorization = `Bearer ${auth.secretRef ?? ''}`;
    } else if (auth.type === 'api_key') {
      const headerName = auth.headerName || 'X-API-Key';
      headers[headerName] = auth.secretRef ?? '';
    }
  }

  const method = (config.method ?? 'POST').toUpperCase();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();

  try {
    const response = await fetch(config.url, {
      method,
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const latencyMs = Date.now() - startedAt;
    const rawText = await response.text();
    let parsed: unknown = null;
    try {
      parsed = rawText ? JSON.parse(rawText) : null;
    } catch {
      parsed = rawText;
    }

    if (!response.ok) {
      const message = typeof parsed === 'object' && parsed && 'error' in parsed
        ? JSON.stringify((parsed as Record<string, unknown>).error)
        : `HTTP ${response.status}`;
      return { output: '', latencyMs, error: message };
    }

    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>;
      if (record.status === 'error') {
        const errorPayload = record.error;
        const message = typeof errorPayload === 'object' && errorPayload
          ? ((errorPayload as Record<string, unknown>).message as string) || 'Agent returned error'
          : String(errorPayload ?? 'Agent returned error');
        return { output: '', latencyMs, error: message };
      }
    }

    const outputValue = readJsonPointer(parsed, config.outputPath);
    const output = typeof outputValue === 'string'
      ? outputValue
      : outputValue === undefined || outputValue === null
        ? (typeof parsed === 'string' ? parsed : JSON.stringify(parsed))
        : JSON.stringify(outputValue);

    const traceIdFromResponse = readJsonPointer(parsed, config.traceIdPath);
    const tokenUsage = extractTokenUsage(readJsonPointer(parsed, config.usagePath));

    return {
      output,
      latencyMs,
      tokenUsage,
      ...(typeof traceIdFromResponse === 'string' && traceIdFromResponse ? { traceId: traceIdFromResponse } : {}),
    } as TargetInvokeResult;
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    return {
      output: '',
      latencyMs,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}
