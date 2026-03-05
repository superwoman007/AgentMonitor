export interface SDKConfig {
  apiKey: string;
  baseUrl?: string;
  disabled?: boolean;
  bufferSize?: number;
  flushInterval?: number;
  enableBreakpoints?: boolean;
  sampleRate?: number; // 0-1，采样率，默认 1.0（全量）
  alwaysCapture?: Array<'error' | 'breakpoint' | 'session'>; // 强制上报的事件类型
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
  status?: 'success' | 'error';
  error?: string;
}

export interface LLMRequest {
  model: string;
  messages?: Array<{ role: string; content: string }>;
  prompt?: string;
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
