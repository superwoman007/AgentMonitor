import type {
  SDKConfig,
  SessionData,
  MessageData,
  ToolCallData,
  TraceData,
  LLMRequest,
  LLMResponse,
  Breakpoint,
  BreakpointCheckContext,
  BreakpointCheckResult,
  SnapshotState,
  BreakpointHitResult,
  BreakpointPauseHandler,
} from './types.js';

type BufferedEvent = {
  type: 'trace';
  data: TraceData;
} | {
  type: 'snapshot';
  data: {
    sessionId: string;
    breakpointId?: string;
    triggerReason: string;
    state: SnapshotState;
  };
};

export class AgentMonitor {
  private config: Required<Omit<SDKConfig, 'apiKey'>> & { apiKey: string };
  private buffer: BufferedEvent[] = [];
  private flushTimer?: ReturnType<typeof setInterval>;
  private offlineBuffer: TraceData[] = [];
  private isOnline: boolean = true;
  private currentSessionId?: string;
  private messageHistory: Array<{ role: string; content: string; timestamp: string }> = [];
  private variables: Record<string, unknown> = {};
  private pauseHandler?: BreakpointPauseHandler;
  private isPaused: boolean = false;
  private resumeCallback?: () => void;

  constructor(config: SDKConfig) {
    this.config = {
      baseUrl: 'http://localhost:3000',
      disabled: false,
      bufferSize: 100,
      flushInterval: 5000,
      enableBreakpoints: true,
      ...config,
    };

    if (!this.config.disabled) {
      this.startFlushTimer();
      this.setupOnlineListener();
    }
  }

  static init(config: SDKConfig): AgentMonitor {
    return new AgentMonitor(config);
  }

  wrap<T extends (...args: unknown[]) => Promise<unknown>>(fn: T, options?: { name?: string; sessionId?: string }): T {
    return (async (...args: Parameters<T>) => {
      const startTime = Date.now();
      const traceName = options?.name || fn.name || 'anonymous';
      
      try {
        const result = await fn(...args);
        const latencyMs = Date.now() - startTime;
        
        this.trace({
          sessionId: options?.sessionId,
          traceType: 'function',
          name: traceName,
          input: args,
          output: result,
          latencyMs,
          status: 'success',
        });
        
        return result;
      } catch (error) {
        const latencyMs = Date.now() - startTime;
        
        this.trace({
          sessionId: options?.sessionId,
          traceType: 'function',
          name: traceName,
          input: args,
          error: error instanceof Error ? error.message : String(error),
          latencyMs,
          status: 'error',
        });
        
        throw error;
      }
    }) as T;
  }

  async traceLLM(
    model: string,
    request: LLMRequest,
    response: LLMResponse | null,
    latencyMs: number,
    success: boolean = true,
    error?: string
  ): Promise<void> {
    const trace: TraceData = {
      traceType: 'llm',
      name: model,
      input: request,
      output: response,
      latencyMs,
      status: success ? 'success' : 'error',
      error,
    };

    await this.trace(trace);
  }

  async trace(data: TraceData): Promise<void> {
    if (this.config.disabled) return;

    const enrichedData: TraceData = {
      ...data,
      startedAt: data.startedAt || new Date().toISOString(),
      endedAt: data.endedAt || (data.latencyMs ? new Date().toISOString() : undefined),
    };

    this.buffer.push({ type: 'trace', data: enrichedData });
    this.maybeFlush();
  }

  startSession(sessionId?: string, metadata?: Record<string, unknown>): SessionData {
    const id = sessionId || `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const session: SessionData = {
      id,
      startedAt: new Date().toISOString(),
      metadata,
    };
    
    this.currentSessionId = id;
    this.messageHistory = [];
    this.variables = {};

    return session;
  }

  async endSession(sessionId?: string): Promise<void> {
    const sid = sessionId || this.currentSessionId;
    if (!sid) return;
    
    const trace: TraceData = {
      sessionId: sid,
      traceType: 'session',
      name: 'session_end',
      endedAt: new Date().toISOString(),
      status: 'success',
    };

    await this.trace(trace);
    
    if (sid === this.currentSessionId) {
      this.currentSessionId = undefined;
      this.messageHistory = [];
      this.variables = {};
    }
  }

  async trackMessage(event: Omit<MessageData, 'timestamp'> & { timestamp?: string }): Promise<void> {
    const timestamp = event.timestamp || new Date().toISOString();
    
    this.messageHistory.push({
      role: event.role,
      content: event.content,
      timestamp,
    });

    const trace: TraceData = {
      sessionId: event.sessionId,
      traceType: 'message',
      name: `message_${event.role}`,
      input: { role: event.role },
      output: { content: event.content },
      metadata: event.metadata,
      startedAt: timestamp,
      status: 'success',
    };

    await this.trace(trace);

    if (this.config.enableBreakpoints) {
      await this.checkAndHandleBreakpoint({
        content: event.content,
        metadata: event.metadata,
      });
    }
  }

  async trackToolCall(event: Omit<ToolCallData, 'startedAt'> & { startedAt?: string }): Promise<void> {
    const startedAt = event.startedAt || new Date().toISOString();
    
    const trace: TraceData = {
      sessionId: event.sessionId,
      traceType: 'tool_call',
      name: event.toolName,
      input: event.inputParams,
      output: event.output,
      error: event.error,
      latencyMs: event.latencyMs,
      startedAt,
      endedAt: event.endedAt,
      status: event.error ? 'error' : 'success',
    };

    await this.trace(trace);

    if (this.config.enableBreakpoints) {
      await this.checkAndHandleBreakpoint({
        content: event.error ? undefined : JSON.stringify(event.output),
        error: event.error,
        latencyMs: event.latencyMs,
        toolName: event.toolName,
      });
    }
  }

  setVariable(key: string, value: unknown): void {
    this.variables[key] = value;
  }

  getVariable(key: string): unknown {
    return this.variables[key];
  }

  getVariables(): Record<string, unknown> {
    return { ...this.variables };
  }

  setPauseHandler(handler: BreakpointPauseHandler): void {
    this.pauseHandler = handler;
  }

  isPausedState(): boolean {
    return this.isPaused;
  }

  async resume(): Promise<void> {
    if (this.isPaused && this.resumeCallback) {
      this.isPaused = false;
      this.resumeCallback();
      this.resumeCallback = undefined;
    }
  }

  private async checkAndHandleBreakpoint(context: BreakpointCheckContext): Promise<BreakpointHitResult> {
    try {
      const response = await fetch(`${this.config.baseUrl}/api/v1/breakpoints/check`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          projectId: this.getProjectId(),
          context,
        }),
      });

      if (!response.ok) {
        return { triggered: false, breakpoints: [], resumed: true };
      }

      const result: BreakpointCheckResult = await response.json();

      if (result.triggered && result.count > 0) {
        const state: SnapshotState = {
          messages: [...this.messageHistory],
          variables: { ...this.variables },
          metadata: {
            sessionId: this.currentSessionId,
            timestamp: new Date().toISOString(),
          },
        };

        if (context.error) {
          state.error = {
            message: context.error,
          };
        }

        let snapshotId: string | undefined;

        for (const breakpoint of result.triggered) {
          const snapshotResponse = await fetch(`${this.config.baseUrl}/api/v1/snapshots`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${this.config.apiKey}`,
            },
            body: JSON.stringify({
              sessionId: this.currentSessionId,
              breakpointId: breakpoint.id,
              triggerReason: `Breakpoint "${breakpoint.name}" triggered`,
              state,
            }),
          });

          if (snapshotResponse.ok) {
            const { snapshot } = await snapshotResponse.json();
            snapshotId = snapshot.id;
          }
        }

        if (this.pauseHandler) {
          this.isPaused = true;
          
          let shouldResume = false;
          for (const breakpoint of result.triggered) {
            shouldResume = await this.pauseHandler(breakpoint, context, state);
            if (!shouldResume) break;
          }

          if (!shouldResume) {
            await new Promise<void>((resolve) => {
              this.resumeCallback = resolve;
            });
          }
          
          this.isPaused = false;
        }

        return { triggered: true, breakpoints: result.triggered, snapshotId, resumed: true };
      }

      return { triggered: false, breakpoints: [], resumed: true };
    } catch (error) {
      console.warn('[AgentMonitor] Failed to check breakpoints:', error);
      return { triggered: false, breakpoints: [], resumed: true };
    }
  }

  private getProjectId(): string {
    const parts = this.config.apiKey.split('_');
    return parts.length > 1 ? parts[0] : '';
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0 || this.config.disabled) return;

    const events = [...this.buffer];
    this.buffer = [];

    try {
      for (const event of events) {
        if (event.type === 'trace') {
          await this.sendTrace(event.data);
        } else if (event.type === 'snapshot') {
          await this.sendSnapshot(event.data);
        }
      }
      
      if (this.offlineBuffer.length > 0 && this.isOnline) {
        const offlineTraces = [...this.offlineBuffer];
        this.offlineBuffer = [];
        
        for (const trace of offlineTraces) {
          await this.sendTrace(trace);
        }
      }
    } catch (error) {
      this.buffer = [...events, ...this.buffer];
      console.warn('[AgentMonitor] Failed to flush events:', error);
    }
  }

  private async sendTrace(trace: TraceData): Promise<void> {
    try {
      const response = await fetch(`${this.config.baseUrl}/api/v1/traces`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(trace),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (error) {
      if (!this.isOnline) {
        this.offlineBuffer.push(trace);
      }
      throw error;
    }
  }

  private async sendSnapshot(data: { sessionId: string; breakpointId?: string; triggerReason: string; state: SnapshotState }): Promise<void> {
    try {
      await fetch(`${this.config.baseUrl}/api/v1/snapshots`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(data),
      });
    } catch (error) {
      console.warn('[AgentMonitor] Failed to send snapshot:', error);
    }
  }

  close(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
    this.flush();
  }

  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => {
      this.flush();
    }, this.config.flushInterval);
  }

  private maybeFlush(): void {
    if (this.buffer.length >= this.config.bufferSize) {
      this.flush();
    }
  }

  private setupOnlineListener(): void {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        this.isOnline = true;
        this.flush();
      });
      
      window.addEventListener('offline', () => {
        this.isOnline = false;
      });
    }
  }
}

export default AgentMonitor;
export * from './types.js';
