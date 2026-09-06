import { query } from '../db/index.js';
import { config } from '../config.js';

export interface IntegrationWarning {
  code: string;
  message: string;
  documentationUrl: string;
}

export interface IntegrationStatus {
  connected: boolean;
  lastEventAt: string | null;
  traceCount: number;
  detectedSdk: {
    language: string;
    version: string;
    frameworks: string[];
  } | null;
  hooks: {
    agent: boolean;
    llm: boolean;
    tool: boolean;
    retrieval: boolean;
    decision: boolean;
  };
  fieldCompleteness: {
    parentSpanId: number;
    tokenUsage: number;
    promptVersion: number;
    agentVersion: number;
  };
  warnings: IntegrationWarning[];
  sampleTraceId: string | null;
}

interface TraceStatusRow {
  id: string;
  trace_id: string | null;
  span_id: string | null;
  trace_type: string;
  name: string;
  metadata: string | unknown | null;
  agent_id: string | null;
  prompt_id: string | null;
  prompt_version_id: string | null;
  created_at: Date | string;
}

interface SpanStatusRow {
  span_id: string;
  trace_id: string;
  parent_span_id: string | null;
  name: string;
  trace_type: string;
  attributes: string | unknown | null;
  input: string | unknown | null;
  output: string | unknown | null;
  created_at: Date | string;
}

interface ParsedTelemetryRecord {
  traceType: string;
  name: string;
  metadata: Record<string, unknown>;
  attributes: Record<string, unknown>;
}

const NOW_EXPRESSION = config.dbType === 'sqlite' ? "datetime('now')" : 'NOW()';
const MINUTE_EXPRESSION = config.dbType === 'sqlite' ? "datetime('now', '-60 minutes')" : "NOW() - INTERVAL '60 minutes'";

/**
 * 安全解析数据库中的 JSON 字段。
 * @param value - 数据库原始值，可能是字符串、对象或 null
 * @returns 返回对象；解析失败或非对象时返回空对象
 */
function parseJsonObject(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

/**
 * 将数据库时间字段统一转换为 ISO 字符串。
 * @param value - Date 或数据库返回的时间字符串
 * @returns ISO 时间字符串
 */
function toIsoString(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

/**
 * 判断字符串是否包含指定关键词之一。
 * @param value - 待判断字符串
 * @param keywords - 关键词列表
 * @returns 命中任一关键词返回 true
 */
function containsAny(value: string, keywords: string[]): boolean {
  const lower = value.toLowerCase();
  return keywords.some((keyword) => lower.includes(keyword));
}

/**
 * 从对象中读取可能位于嵌套字段下的 token 使用信息。
 * @param record - 元数据或属性对象
 * @returns 存在 token 字段返回 true
 */
function hasTokenUsage(record: Record<string, unknown>): boolean {
  const tokens = record.tokens;
  if (tokens && typeof tokens === 'object') {
    const tokenRecord = tokens as Record<string, unknown>;
    return ['prompt', 'completion', 'total', 'promptTokens', 'completionTokens', 'totalTokens'].some((key) => tokenRecord[key] !== undefined);
  }
  return ['tokens_prompt', 'tokens_completion', 'tokens_total', 'prompt_tokens', 'completion_tokens', 'total_tokens', 'usage'].some(
    (key) => record[key] !== undefined
  );
}

/**
 * 从 Trace/Span 元数据中识别 SDK 语言、版本和框架。
 * @param records - 最近的 Trace/Span 记录
 * @returns 检测到的 SDK 信息，未检测到时返回 null
 */
function detectSdk(records: ParsedTelemetryRecord[]): IntegrationStatus['detectedSdk'] {
  for (const record of records) {
    const source = { ...record.metadata, ...record.attributes };
    const language = source['sdk.language'] ?? source['sdk_language'] ?? source['language'];
    const version = source['sdk.version'] ?? source['sdk_version'] ?? source['version'];
    if (typeof language === 'string' && typeof version === 'string') {
      const rawFrameworks = source['sdk.frameworks'] ?? source['sdk_frameworks'] ?? source['frameworks'] ?? source['framework'];
      const frameworks = Array.isArray(rawFrameworks)
        ? rawFrameworks.filter((item): item is string => typeof item === 'string')
        : typeof rawFrameworks === 'string'
          ? rawFrameworks.split(',').map((item) => item.trim()).filter(Boolean)
          : [];
      return { language, version, frameworks };
    }
  }
  return null;
}

/**
 * 判断记录是否代表 Agent 根链路。
 * @param record - Trace/Span 记录
 * @returns 是 Agent Hook 返回 true
 */
function isAgentHook(record: ParsedTelemetryRecord): boolean {
  const value = `${record.traceType} ${record.name}`;
  return containsAny(value, ['agent', 'session', 'run', 'orchestrator', 'graph']);
}

/**
 * 判断记录是否代表 LLM 调用。
 * @param record - Trace/Span 记录
 * @returns 是 LLM Hook 返回 true
 */
function isLlmHook(record: ParsedTelemetryRecord): boolean {
  const value = `${record.traceType} ${record.name}`;
  return containsAny(value, ['llm', 'model', 'chat', 'completion', 'openai', 'anthropic', 'gemini']) || hasTokenUsage(record.attributes);
}

/**
 * 判断记录是否代表工具调用。
 * @param record - Trace/Span 记录
 * @returns 是 Tool Hook 返回 true
 */
function isToolHook(record: ParsedTelemetryRecord): boolean {
  const value = `${record.traceType} ${record.name}`;
  return containsAny(value, ['tool', 'function_call', 'function-call', 'action']);
}

/**
 * 判断记录是否代表检索调用。
 * @param record - Trace/Span 记录
 * @returns 是 Retrieval Hook 返回 true
 */
function isRetrievalHook(record: ParsedTelemetryRecord): boolean {
  const value = `${record.traceType} ${record.name}`;
  return containsAny(value, ['retriev', 'rag', 'search', 'vector', 'embedding', 'knowledge']);
}

/**
 * 判断记录是否代表决策调用。
 * @param record - Trace/Span 记录
 * @returns 是 Decision Hook 返回 true
 */
function isDecisionHook(record: ParsedTelemetryRecord): boolean {
  const value = `${record.traceType} ${record.name}`;
  return containsAny(value, ['decision', 'route', 'planner', 'policy', 'judge']);
}

/**
 * 计算比率并保留两位小数，空分母返回 0。
 * @param numerator - 分子
 * @param denominator - 分母
 * @returns 0 到 1 之间的比率
 */
function ratio(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 100) / 100;
}

/**
 * 获取项目最近一段时间的接入健康状态。
 * @param projectId - 项目 ID
 * @returns IntegrationStatus 接入诊断结果
 */
export async function getIntegrationStatus(projectId: string): Promise<IntegrationStatus> {
  const traceRows = await query<TraceStatusRow>(
    `SELECT id, trace_id, span_id, trace_type, name, metadata, agent_id, prompt_id, prompt_version_id, created_at
     FROM traces
     WHERE project_id = $1 AND created_at >= ${MINUTE_EXPRESSION}
     ORDER BY created_at DESC
     LIMIT 100`,
    [projectId]
  );

  const spanRows = await query<SpanStatusRow>(
    `SELECT span_id, trace_id, parent_span_id, name, trace_type, attributes, input, output, created_at
     FROM spans
     WHERE project_id = $1 AND created_at >= ${MINUTE_EXPRESSION}
     ORDER BY created_at DESC
     LIMIT 500`,
    [projectId]
  );

  const records: ParsedTelemetryRecord[] = [
    ...traceRows.map((row) => ({
      traceType: row.trace_type,
      name: row.name,
      metadata: parseJsonObject(row.metadata),
      attributes: {},
    })),
    ...spanRows.map((row) => ({
      traceType: row.trace_type,
      name: row.name,
      metadata: {},
      attributes: parseJsonObject(row.attributes),
    })),
  ];

  const rootSpanIds = new Set(traceRows.map((row) => row.span_id).filter((id): id is string => !!id));
  const nonRootSpans = spanRows.filter((row) => !rootSpanIds.has(row.span_id));
  const llmRecords = records.filter(isLlmHook);
  const hooks = {
    agent: records.some(isAgentHook),
    llm: llmRecords.length > 0,
    tool: records.some(isToolHook),
    retrieval: records.some(isRetrievalHook),
    decision: records.some(isDecisionHook),
  };

  const parentLinkedCount = nonRootSpans.filter((row) => !!row.parent_span_id).length;
  const llmWithTokensCount = llmRecords.filter((record) => hasTokenUsage(record.attributes)).length;
  const promptVersionCount = traceRows.filter((row) => {
    const metadata = parseJsonObject(row.metadata);
    return !!row.prompt_version_id || metadata['prompt.version'] !== undefined || metadata['prompt_version'] !== undefined;
  }).length;
  const agentVersionCount = traceRows.filter((row) => {
    const metadata = parseJsonObject(row.metadata);
    return !!row.agent_id || metadata['agent.version'] !== undefined || metadata['agent_version'] !== undefined || metadata['version'] !== undefined;
  }).length;

  const warnings: IntegrationWarning[] = [];
  if (traceRows.length > 0) {
    if (!hooks.agent) {
      warnings.push({
        code: 'MISSING_AGENT_SPAN',
        message: '已收到 Trace，但未检测到 Agent 根 Span',
        documentationUrl: '/docs/hooks/agent',
      });
    }
    if (!hooks.llm) {
      warnings.push({
        code: 'MISSING_LLM_SPAN',
        message: '未检测到 LLM Span，调试与评测将缺少模型调用上下文',
        documentationUrl: '/docs/hooks/llm',
      });
    }
    if (!hooks.tool) {
      warnings.push({
        code: 'MISSING_TOOL_SPAN',
        message: '未检测到 Tool Span，工具调用轨迹将不完整',
        documentationUrl: '/docs/hooks/tool',
      });
    }
    if (!hooks.retrieval) {
      warnings.push({
        code: 'MISSING_RETRIEVAL_SPAN',
        message: '未检测到 Retrieval/RAG Span',
        documentationUrl: '/docs/hooks/retrieval',
      });
    }
  }

  const lastEventAt = traceRows[0]?.created_at ?? spanRows[0]?.created_at ?? null;

  return {
    connected: traceRows.length > 0 || spanRows.length > 0,
    lastEventAt: toIsoString(lastEventAt),
    traceCount: traceRows.length,
    detectedSdk: detectSdk(records),
    hooks,
    fieldCompleteness: {
      parentSpanId: ratio(parentLinkedCount, nonRootSpans.length),
      tokenUsage: ratio(llmWithTokensCount, llmRecords.length),
      promptVersion: ratio(promptVersionCount, traceRows.length),
      agentVersion: ratio(agentVersionCount, traceRows.length),
    },
    warnings,
    sampleTraceId: traceRows[0]?.id ?? null,
  };
}

export { NOW_EXPRESSION };
