
export interface SDKConfig {
  apiKey: string;
  baseUrl?: string;
  disabled?: boolean;
  bufferSize?: number;
  flushInterval?: number;
}

export interface Session {
  id: string;
  projectId?: string;
  startedAt: Date;
  endedAt?: Date;
  metadata?: Record&lt;string, any&gt;;
}

export interface MessageEvent {
  sessionId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: Date;
  metadata?: Record&lt;string, any&gt;;
}

export interface ToolCallEvent {
  id: string;
  sessionId: string;
  messageId?: string;
  toolName: string;
  inputParams: Record&lt;string, any&gt;;
  output?: Record&lt;string, any&gt;;
  error?: string;
  latencyMs?: number;
  startedAt: Date;
  endedAt?: Date;
}

export interface ErrorEvent {
  sessionId: string;
  error: Error;
  timestamp: Date;
  metadata?: Record&lt;string, any&gt;;
}

export interface BreakpointCondition {
  id: string;
  type: 'keyword' | 'error' | 'latency';
  condition: string | number;
  enabled: boolean;
}

export interface SessionSnapshot {
  id: string;
  sessionId: string;
  timestamp: Date;
  state: {
    messages: MessageEvent[];
    variables: Record&lt;string, any&gt;;
    memory?: any;
  };
  metadata: {
    breakpointId?: string;
    triggerReason: string;
  };
}
