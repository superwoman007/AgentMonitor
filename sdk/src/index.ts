
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
  startedAt: string;
  endedAt?: string;
  metadata?: Record&lt;string, any&gt;;
}

export interface MessageEvent {
  sessionId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: string;
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
  startedAt: string;
  endedAt?: string;
}

export class AgentMonitor {
  private config: SDKConfig;
  private sessions: Map&lt;string, any&gt; = new Map();
  private buffer: any[] = [];
  private flushTimer?: any;

  constructor(config: SDKConfig) {
    this.config = {
      baseUrl: 'https://api.agentmonitor.io',
      disabled: false,
      bufferSize: 100,
      flushInterval: 5000,
      ...config,
    };

    if (!this.config.disabled) {
      this.startFlushTimer();
    }
  }

  static init(config: SDKConfig): AgentMonitor {
    return new AgentMonitor(config);
  }

  startSession(sessionId?: string): Session {
    const id = sessionId || 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    const session: Session = {
      id,
      startedAt: new Date().toISOString(),
    };
    this.sessions.set(id, session);
    this.buffer.push({ type: 'session_start', data: session });
    this.maybeFlush();
    return session;
  }

  async endSession(sessionId: string): Promise&lt;void&gt; {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.endedAt = new Date().toISOString();
      this.buffer.push({ type: 'session_end', data: session });
      this.maybeFlush();
    }
  }

  trackMessage(event: MessageEvent): void {
    this.buffer.push({ type: 'message', data: event });
    this.maybeFlush();
  }

  trackToolCall(event: ToolCallEvent): void {
    this.buffer.push({ type: 'tool_call', data: event });
    this.maybeFlush();
  }

  async flush(): Promise&lt;void&gt; {
    if (this.buffer.length === 0 || this.config.disabled) return;

    const events = [...this.buffer];
    this.buffer = [];

    try {
      await fetch(this.config.baseUrl + '/api/v1/events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + this.config.apiKey,
        },
        body: JSON.stringify({ events }),
      });
    } catch (error) {
      this.buffer = [...events, ...this.buffer];
      console.warn('[AgentMonitor] Failed to flush events:', error);
    }
  }

  close(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
    this.flush();
  }

  private startFlushTimer(): void {
    this.flushTimer = setInterval(() =&gt; {
      this.flush();
    }, this.config.flushInterval);
  }

  private maybeFlush(): void {
    if (this.buffer.length &gt;= (this.config.bufferSize || 100)) {
      this.flush();
    }
  }
}

export default AgentMonitor;
