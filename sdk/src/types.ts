export interface SDKConfig {
  apiKey: string;
  /**
   * 项目 ID。
   * Prompt Runtime 等 V2 接口需要显式 projectId（JWT 模式无法从 apiKey 解析）。
   * 若未提供，SDK 会尝试从 apiKey 中按 `<projectId>_<rest>` 约定解析。
   */
  projectId?: string;
  baseUrl?: string;
  apiPrefix?: string;
  disabled?: boolean;
  bufferSize?: number;
  flushInterval?: number;
  enableBreakpoints?: boolean;
  sampleRate?: number; // 0-1，采样率，默认 1.0（全量）
  alwaysCapture?: Array<'error' | 'breakpoint' | 'session'>; // 强制上报的事件类型
  enableSpanWrite?: boolean; // 是否启用 Span 级追踪写入
  /**
   * Prompt Runtime 缓存 TTL（毫秒），默认 60000。
   */
  promptCacheTtlMs?: number;
}

export interface SessionData {
  id: string;
  projectId?: string;
  startedAt: string;
  endedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface MessageData {
  sessionId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export interface ToolCallData {
  id: string;
  sessionId: string;
  messageId?: string;
  toolName: string;
  inputParams: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
  latencyMs?: number;
  startedAt: string;
  endedAt?: string;
}

export interface TraceData {
  /**
   * 显式链路 ID。W3C 风格 32 位十六进制或 UUID。
   * 若不传，SDK 在 trace() 时生成一次并贯穿整棵树。
   */
  traceId?: string;
  /**
   * 显式 Span ID。根 Span 建议由调用方或 SDK 生成；
   * 不传则由 SDK 生成。服务端以该 ID 作为根 Span 的 span_id。
   */
  spanId?: string;
  /**
   * 父 Span ID。根节点为空；嵌套子 trace/span 才需要传入。
   */
  parentSpanId?: string;
  sessionId?: string;
  agentId?: string;
  traceType: string;
  name: string;
  input?: unknown;
  output?: unknown;
  metadata?: Record<string, unknown>;
  startedAt?: string;
  endedAt?: string;
  latencyMs?: number;
  status?: 'success' | 'error' | 'ok' | 'cancelled' | 'timeout';
  error?: string;
}

export interface PromptRef {
  id: string;
  versionId: string;
  name?: string;
  versionNumber?: number;
  environment?: string;
}

export interface LLMRequest {
  model: string;
  messages?: Array<{ role: string; content: string }>;
  prompt?: string;
  /**
   * PR-12：如果本次 LLM 调用使用了通过 Runtime 解析的 Prompt，
   * 传入该引用会自动写入 LLM Span 的 attributes，便于在 Trace 中聚合 prompt 版本。
   */
  promptRef?: PromptRef;
  [key: string]: unknown;
}

export interface LLMResponse {
  id?: string;
  choices?: Array<{ message?: { content: string }; text?: string }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  [key: string]: unknown;
}

export interface Breakpoint {
  id: string;
  project_id: string;
  name: string;
  type: 'keyword' | 'error' | 'latency' | 'custom';
  condition: string;
  enabled: boolean;
}

export interface BreakpointCheckContext {
  content?: string;
  error?: string;
  latencyMs?: number;
  toolName?: string;
  metadata?: Record<string, unknown>;
}

export interface BreakpointCheckResult {
  triggered: Breakpoint[];
  count: number;
}

export interface SnapshotState {
  messages?: Array<{
    role: string;
    content: string;
    timestamp: string;
  }>;
  variables?: Record<string, unknown>;
  toolCalls?: Array<{
    toolName: string;
    input: unknown;
    output?: unknown;
    error?: string;
  }>;
  metadata?: Record<string, unknown>;
  stackTrace?: string[];
  error?: {
    message: string;
    code?: string;
  };
}

export interface BreakpointHitResult {
  triggered: boolean;
  breakpoints: Breakpoint[];
  snapshotId?: string;
  resumed: boolean;
}

export type BreakpointPauseHandler = (
  breakpoint: Breakpoint,
  context: BreakpointCheckContext,
  state: SnapshotState
) => Promise<boolean>;

export interface DecisionData {
  projectId: string;
  sessionId?: string;
  decisionType: string;
  context?: Record<string, unknown>;
  selectedOption: string;
  confidence?: number;
  reasoning?: string;
  decisionMaker: 'rule' | 'llm' | 'human' | 'hybrid';
  latencyMs?: number;
  metadata?: Record<string, unknown>;
  options?: Array<{
    name: string;
    score?: number;
    pros?: string[];
    cons?: string[];
    metadata?: Record<string, unknown>;
  }>;
}

export interface DecisionWithOptions {
  id: string;
  project_id: string;
  session_id: string | null;
  decision_type: string;
  context: Record<string, unknown> | null;
  selected_option: string;
  confidence: number | null;
  reasoning: string | null;
  decision_maker: 'rule' | 'llm' | 'human' | 'hybrid';
  latency_ms: number | null;
  created_at: string;
  metadata: Record<string, unknown> | null;
  options: Array<{
    id: string;
    decision_id: string;
    option_name: string;
    score: number | null;
    pros: string[] | null;
    cons: string[] | null;
    metadata: Record<string, unknown> | null;
    created_at: string;
  }>;
}

// P0-01: Span 级追踪类型定义

export interface SpanContext {
  spanId: string;
  traceId: string;
  parentSpanId?: string;
  name: string;
  traceType: string;
  startedAt: string;
  endedAt?: string;
  latencyMs?: number;
  input?: unknown;
  output?: unknown;
  attributes?: Record<string, unknown>;
  status?: string;
  error?: string;
  sessionId?: string | null;
}

export interface SpanOptions {
  input?: unknown;
  attributes?: Record<string, unknown>;
  sessionId?: string | null;
}
