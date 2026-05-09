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
  DecisionData,
  DecisionWithOptions,
  SpanContext,
  SpanOptions,
} from './types.js';
import { autoInstrument } from './auto-instrument.js';

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
} | {
  type: 'span';
  data: SpanContext;
};

export class AgentMonitor {
  private config: Required<Omit<SDKConfig, 'apiKey'>> & { apiKey: string };
  private buffer: BufferedEvent[] = [];
  private flushTimer?: ReturnType<typeof setInterval>;
  private offlineBuffer: TraceData[] = [];
  private isOnline: boolean = true;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private retryDelayMs: number = 5000;

  private currentSessionId?: string;
  private messageHistory: Array<{ role: string; content: string; timestamp: string }> = [];
  private variables: Record<string, unknown> = {};
  private pauseHandler?: BreakpointPauseHandler;
  private isPaused: boolean = false;
  private resumeCallback?: () => void;

  // P0-1: 本地断点规则缓存
  private breakpointRules: Breakpoint[] = [];
  private breakpointCacheExpiry: number = 0;
  private readonly BREAKPOINT_CACHE_TTL = 30_000; // 30秒缓存

  // P1: 采样机制
  private sessionSampleDecisions = new Map<string, boolean>(); // session 级别采样决策

  // P0-01: Span 级追踪
  private spanStack = new Map<string, SpanContext[]>();
  private readonly MAX_SPAN_STACK_SIZE = 1000;

  constructor(config: SDKConfig) {
    this.config = {
      baseUrl: 'http://localhost:3000',
      apiPrefix: '/api/v1',
      disabled: false,
      bufferSize: 100,
      flushInterval: 5000,
      enableBreakpoints: true,
      sampleRate: 1.0, // 默认全量上报
      alwaysCapture: ['error', 'breakpoint'], // 错误和断点总是上报
      enableSpanWrite: true, // 默认启用 Span 写入
      ...config,
    };

    if (!this.config.disabled) {
      this.startFlushTimer();
      // P0-2: 只在浏览器环境注册 online/offline 事件
      this.setupOnlineListener();
      // P0-1: 启动时预加载断点规则
      if (this.config.enableBreakpoints) {
        this.refreshBreakpointRules().catch(() => {
          // 静默失败，下次 trackMessage 时会重试
        });
      }
      // P0-4: 注册进程退出钩子（Node.js 环境）
      this.setupExitHooks();
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
    const metadata: Record<string, unknown> = { model };
    const usage = (response as unknown as { usage?: unknown } | null)?.usage;
    if (usage && typeof usage === 'object') {
      metadata.usage = usage;
    }

    const trace: TraceData = {
      traceType: 'llm',
      name: model,
      input: request,
      output: response,
      metadata,
      latencyMs,
      status: success ? 'success' : 'error',
      error,
    };

    await this.trace(trace);
  }

  async trace(data: TraceData): Promise<void> {
    if (this.config.disabled) return;

    // P1: 采样检查
    if (!this.shouldSample(data)) {
      return; // 丢弃该 trace
    }

    const enrichedData: TraceData = {
      ...data,
      startedAt: data.startedAt || new Date().toISOString(),
      endedAt: data.endedAt || (data.latencyMs ? new Date().toISOString() : undefined),
    };

    this.buffer.push({ type: 'trace', data: enrichedData });

    // 双写：同步生成一条 span 记录
    if (this.config.enableSpanWrite) {
      const spanData: SpanContext = {
        spanId: this.generateUUID(),
        traceId: this.generateUUID(),
        name: data.name,
        traceType: data.traceType,
        startedAt: enrichedData.startedAt!,
        endedAt: enrichedData.endedAt,
        latencyMs: data.latencyMs,
        input: data.input,
        output: data.output,
        attributes: data.metadata as Record<string, unknown> | undefined,
        status: enrichedData.status,
        error: data.error,
        sessionId: data.sessionId,
      };
      this.buffer.push({ type: 'span', data: spanData });
    }

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

  async trackDecision(data: DecisionData): Promise<void> {
    const trace: TraceData = {
      sessionId: data.sessionId,
      traceType: 'decision',
      name: data.decisionType,
      input: {
        context: data.context,
        options: data.options,
      },
      output: {
        selectedOption: data.selectedOption,
        confidence: data.confidence,
        reasoning: data.reasoning,
      },
      metadata: {
        ...data.metadata,
        decisionMaker: data.decisionMaker,
      },
      latencyMs: data.latencyMs,
      status: 'success',
    };

    await this.trace(trace);

    // 异步上报决策数据到决策监控API
    try {
      const response = await fetch(`${this.config.baseUrl}/api/v1/decisions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.config.apiKey,
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const text = await response.text();
        console.error(`[AgentMonitor] Decision report failed: ${response.status} ${text}`);
      }
    } catch (error) {
      // 静默失败，不影响主业务流程
      console.error('[AgentMonitor] Failed to report decision:', error);
      if (error instanceof Error) {
        console.error('Stack:', error.stack);
      }
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

  // ─────────────────────────────────────────────
  // P0-1: 本地断点规则缓存 + 本地匹配
  // ─────────────────────────────────────────────

  /**
   * 从后端拉取断点规则，缓存到本地（TTL 30秒）
   */
  async refreshBreakpointRules(): Promise<void> {
    try {
      const projectId = this.getProjectId();
      if (!projectId) return;

      const response = await this.fetchApi(`/breakpoints/public`, {
        headers: {
          'X-API-Key': this.config.apiKey,
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
      }, false);

      if (response.ok) {
        const data = await response.json() as { breakpoints: Breakpoint[] };
        this.breakpointRules = data.breakpoints ?? [];
        this.breakpointCacheExpiry = Date.now() + this.BREAKPOINT_CACHE_TTL;
      }
    } catch {
      // 网络失败时保留旧规则
    }
  }

  /**
   * 本地匹配断点规则，无需网络请求
   */
  private matchBreakpointsLocally(context: BreakpointCheckContext): Breakpoint[] {
    return this.breakpointRules.filter(bp => {
      if (!bp.enabled) return false;
      switch (bp.type) {
        case 'keyword':
          return !!(context.content && context.content.includes(bp.condition));
        case 'error':
          return !!context.error;
        case 'latency':
          return (context.latencyMs ?? 0) > parseInt(bp.condition, 10);
        case 'custom':
          // custom 类型目前退化为关键词匹配
          return !!(context.content && context.content.includes(bp.condition));
        default:
          return false;
      }
    });
  }

  /**
   * 检查并处理断点（P0-1 改造核心：本地匹配，命中才发网络请求）
   */
  private async checkAndHandleBreakpoint(context: BreakpointCheckContext): Promise<BreakpointHitResult> {
    // 缓存过期则刷新（非阻塞，本次用旧规则）
    if (Date.now() > this.breakpointCacheExpiry) {
      this.refreshBreakpointRules().catch(() => {});
    }

    // 本地匹配，无网络请求
    const triggered = this.matchBreakpointsLocally(context);
    if (triggered.length === 0) {
      return { triggered: false, breakpoints: [], resumed: true };
    }

    // 命中了才发网络请求：创建快照 + 暂停
    try {
      const state: SnapshotState = {
        messages: [...this.messageHistory],
        variables: { ...this.variables },
        metadata: {
          sessionId: this.currentSessionId,
          timestamp: new Date().toISOString(),
        },
      };

      if (context.error) {
        state.error = { message: context.error };
      }

      let snapshotId: string | undefined;

      for (const breakpoint of triggered) {
        const snapshotResponse = await this.fetchApi('/snapshots', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': this.config.apiKey,
            'Authorization': `Bearer ${this.config.apiKey}`,
          },
          body: JSON.stringify({
            sessionId: this.currentSessionId,
            breakpointId: breakpoint.id,
            triggerReason: `Breakpoint "${breakpoint.name}" triggered`,
            state,
          }),
        }, false);

        if (snapshotResponse.ok) {
          const { snapshot } = await snapshotResponse.json() as { snapshot: { id: string } };
          snapshotId = snapshot.id;
        }
      }

      if (this.pauseHandler) {
        this.isPaused = true;

        let shouldResume = false;
        for (const breakpoint of triggered) {
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

      return { triggered: true, breakpoints: triggered, snapshotId, resumed: true };
    } catch (error) {
      console.warn('[AgentMonitor] Failed to handle breakpoint:', error);
      return { triggered: false, breakpoints: [], resumed: true };
    }
  }

  private getProjectId(): string {
    const parts = this.config.apiKey.split('_');
    return parts.length > 1 ? parts[0] : '';
  }

  // ─────────────────────────────────────────────
  // P1: 采样机制
  // ─────────────────────────────────────────────

  /**
   * 判断是否应该采样上报该 trace
   * 优先级：
   * 1. alwaysCapture 配置的事件类型：100% 上报
   * 2. 其他事件：根据 sampleRate 随机采样
   *
   * Session 级采样：同一 session 的所有 trace 采样决策一致，避免数据割裂
   */
  private shouldSample(trace: TraceData): boolean {
    // 1. 检查强制上报配置
    if (trace.status === 'error' && this.config.alwaysCapture.includes('error')) {
      return true;
    }
    if (trace.traceType === 'breakpoint' && this.config.alwaysCapture.includes('breakpoint')) {
      return true;
    }
    if (trace.traceType === 'session' && this.config.alwaysCapture.includes('session')) {
      return true;
    }

    // 2. Session 级采样决策（保证 session 内数据完整）
    if (trace.sessionId) {
      if (!this.sessionSampleDecisions.has(trace.sessionId)) {
        const decision = Math.random() < this.config.sampleRate;
        this.sessionSampleDecisions.set(trace.sessionId, decision);
      }
      return this.sessionSampleDecisions.get(trace.sessionId)!;
    }

    // 3. 无 session 的 trace：每次独立随机（无需保证一致性）
    return Math.random() < this.config.sampleRate;
  }

  // ─────────────────────────────────────────────
  // Flush & 上报
  // ─────────────────────────────────────────────

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
        } else if (event.type === 'span') {
          await this.sendSpan(event.data);
        }
      }

      // 网络恢复后，补发离线缓存
      if (this.offlineBuffer.length > 0 && this.isOnline) {
        const offlineTraces = [...this.offlineBuffer];
        this.offlineBuffer = [];
        for (const trace of offlineTraces) {
          await this.sendTrace(trace);
        }
      }
    } catch (error) {
      // 发送失败，事件放回 buffer 等待重试
      this.buffer = [...events, ...this.buffer];
      console.warn('[AgentMonitor] Failed to flush events:', error);
    }
  }

  private buildApiUrl(prefix: string, path: string): string {
    const normalizedPrefix = prefix.startsWith('/') ? prefix : `/${prefix}`;
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `${this.config.baseUrl}${normalizedPrefix}${normalizedPath}`;
  }

  private async fetchApi(path: string, init: RequestInit, allowFallback: boolean = true): Promise<Response> {
    const firstUrl = this.buildApiUrl(this.config.apiPrefix, path);
    const firstResponse = await fetch(firstUrl, init);

    if (!allowFallback) return firstResponse;

    if (firstResponse.status === 404 && this.config.apiPrefix === '/api/v1') {
      const fallbackPrefix = '/api';
      const fallbackUrl = this.buildApiUrl(fallbackPrefix, path);
      const fallbackResponse = await fetch(fallbackUrl, init);
      if (fallbackResponse.status !== 404) {
        this.config.apiPrefix = fallbackPrefix;
      }
      return fallbackResponse;
    }

    return firstResponse;
  }

  private async sendTrace(trace: TraceData): Promise<void> {
    try {
      const response = await this.fetchApi('/traces', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.config.apiKey,
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(trace),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      // P0-2: 请求成功 → 标记在线，取消重试计时器
      this.isOnline = true;
      if (this.retryTimer) {
        clearTimeout(this.retryTimer);
        this.retryTimer = undefined;
      }
    } catch (error) {
      // P0-2: 请求失败 → 标记离线，缓存到 offlineBuffer，安排重试
      this.isOnline = false;
      this.offlineBuffer.push(trace);
      this.scheduleRetry();
      throw error;
    }
  }

  private async sendSnapshot(data: {
    sessionId: string;
    breakpointId?: string;
    triggerReason: string;
    state: SnapshotState;
  }): Promise<void> {
    try {
      await this.fetchApi('/snapshots', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.config.apiKey,
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(data),
      });
    } catch (error) {
      console.warn('[AgentMonitor] Failed to send snapshot:', error);
    }
  }

  // ─────────────────────────────────────────────
  // P0-2: 离线重试（网络错误驱动，兼容 Node.js）
  // ─────────────────────────────────────────────

  /**
   * 安排重试，使用指数退避，最大 60 秒
   */
  private scheduleRetry(): void {
    if (this.retryTimer) return; // 避免重复调度
    this.retryTimer = setTimeout(async () => {
      this.retryTimer = undefined;
      this.retryDelayMs = Math.min(this.retryDelayMs * 2, 60_000);
      await this.flush();
    }, this.retryDelayMs);
  }

  async collectFeedback(data: {
    sessionId?: string;
    messageId?: string;
    rating: number;
    reason?: string;
    comment?: string;
    dimensions?: Record<string, unknown>;
  }): Promise<void> {
    if (this.config.disabled) return;

    try {
      const response = await this.fetchApi('/feedbacks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.config.apiKey,
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const text = await response.text();
        console.error(`[AgentMonitor] Feedback report failed: ${response.status} ${text}`);
      }
    } catch (error) {
      console.error('[AgentMonitor] Failed to send feedback:', error);
    }
  }

  autoInstrument(options?: { openAI?: any }): void {
    autoInstrument(this, options || {});
  }

  // ─────────────────────────────────────────────
  // P0-01: Span 级追踪 API
  // ─────────────────────────────────────────────

  /**
   * 开始一个新的 Span，返回 SpanContext
   * @param name - Span 名称
   * @param options - 可选配置（输入数据、属性、会话ID）
   * @returns SpanContext 用于后续 endSpan
   */
  startSpan(name: string, options?: SpanOptions): SpanContext {
    const traceId = this.getCurrentTraceId() || this.generateUUID();
    const spanId = this.generateUUID();
    const parentSpanId = this.getCurrentSpanId(traceId);

    const ctx: SpanContext = {
      spanId,
      traceId,
      parentSpanId,
      name,
      traceType: 'span',
      startedAt: new Date().toISOString(),
      input: options?.input,
      attributes: options?.attributes,
      sessionId: options?.sessionId ?? this.currentSessionId ?? null,
    };

    // 入栈
    if (!this.spanStack.has(traceId)) {
      this.spanStack.set(traceId, []);
    }
    this.spanStack.get(traceId)!.push(ctx);

    // 内存保护
    this.maybeCleanupSpanStack();

    this.bufferSpan(ctx);
    return ctx;
  }

  /**
   * 结束一个 Span，计算延迟并更新状态
   * @param ctx - startSpan 返回的 SpanContext
   * @param result - 结束时的状态信息
   */
  endSpan(ctx: SpanContext, result?: { status?: string; output?: unknown; error?: string; attributes?: Record<string, unknown> }): void {
    const endedAt = new Date().toISOString();
    const latencyMs = new Date(endedAt).getTime() - new Date(ctx.startedAt).getTime();

    const endedCtx: SpanContext = {
      ...ctx,
      endedAt,
      latencyMs,
      status: result?.status || (result?.error ? 'error' : 'success'),
      output: result?.output,
      error: result?.error,
      attributes: { ...ctx.attributes, ...result?.attributes },
    };

    // 出栈
    const stack = this.spanStack.get(ctx.traceId);
    if (stack) {
      const idx = stack.findIndex(s => s.spanId === ctx.spanId);
      if (idx !== -1) stack.splice(idx, 1);
    }

    this.bufferSpan(endedCtx);
  }

  /**
   * 便捷方法：自动管理 Span 生命周期
   * @param name - Span 名称
   * @param fn - 要执行的异步函数，接收 SpanContext 参数
   * @param options - 可选配置
   * @returns 函数执行结果
   */
  async withSpan<T>(name: string, fn: (span: SpanContext) => Promise<T>, options?: SpanOptions): Promise<T> {
    const span = this.startSpan(name, options);
    try {
      const result = await fn(span);
      this.endSpan(span, { status: 'success', output: result });
      return result;
    } catch (error) {
      this.endSpan(span, {
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * 设置当前活跃 Span 的单个属性
   * @param traceId - 追踪ID，用于定位 spanStack 中的栈
   * @param key - 属性键名
   * @param value - 属性值
   */
  setSpanAttribute(traceId: string, key: string, value: unknown): void {
    const stack = this.spanStack.get(traceId);
    if (stack && stack.length > 0) {
      const current = stack[stack.length - 1];
      if (!current.attributes) current.attributes = {};
      current.attributes[key] = value;
    }
  }

  /**
   * 批量设置当前活跃 Span 的属性
   * @param traceId - 追踪ID，用于定位 spanStack 中的栈
   * @param attrs - 要批量设置的属性键值对
   */
  setSpanAttributes(traceId: string, attrs: Record<string, unknown>): void {
    const stack = this.spanStack.get(traceId);
    if (stack && stack.length > 0) {
      const current = stack[stack.length - 1];
      if (!current.attributes) current.attributes = {};
      Object.assign(current.attributes, attrs);
    }
  }

  /**
   * 将 Span 数据推入 buffer
   * @param span - Span 上下文数据
   */
  private bufferSpan(span: SpanContext): void {
    if (!this.config.enableSpanWrite) return;
    this.buffer.push({ type: 'span', data: span });
    this.maybeFlush();
  }

  /**
   * 获取当前 traceId（从 spanStack 中获取最近的）
   * @returns 当前活跃的 traceId，若无则返回 undefined
   */
  private getCurrentTraceId(): string | undefined {
    for (const [traceId, stack] of this.spanStack) {
      if (stack.length > 0) return traceId;
    }
    return undefined;
  }

  /**
   * 获取当前层级的 parentSpanId
   * @param traceId - 追踪ID
   * @returns 当前栈顶的 spanId，作为新 span 的 parentSpanId
   */
  private getCurrentSpanId(traceId: string): string | undefined {
    const stack = this.spanStack.get(traceId);
    if (stack && stack.length > 0) {
      return stack[stack.length - 1].spanId;
    }
    return undefined;
  }

  /**
   * 内存保护：spanStack 总数超过阈值时清理最早的 span
   */
  private maybeCleanupSpanStack(): void {
    let total = 0;
    for (const stack of this.spanStack.values()) {
      total += stack.length;
    }
    if (total > this.MAX_SPAN_STACK_SIZE) {
      // 找到最早的 traceId 并关闭其所有 span
      const firstKey = this.spanStack.keys().next().value;
      if (firstKey) {
        const stack = this.spanStack.get(firstKey)!;
        while (stack.length > 0) {
          const span = stack.shift()!;
          this.bufferSpan({ ...span, status: 'error', error: 'auto-closed: stack overflow' });
        }
        this.spanStack.delete(firstKey);
      }
    }
  }

  /**
   * 生成 UUID（兼容浏览器和 Node.js）
   * @returns UUID 字符串
   */
  private generateUUID(): string {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  /**
   * 发送 span 数据到 POST /api/v1/spans
   * @param span - Span 上下文数据
   */
  private async sendSpan(span: SpanContext): Promise<void> {
    try {
      const response = await this.fetchApi('/spans', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.config.apiKey,
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          traceId: span.traceId,
          spanId: span.spanId,
          parentSpanId: span.parentSpanId,
          name: span.name,
          traceType: span.traceType,
          startedAt: span.startedAt,
          endedAt: span.endedAt,
          latencyMs: span.latencyMs,
          input: span.input,
          output: span.output,
          attributes: span.attributes,
          status: span.status,
          error: span.error,
          sessionId: span.sessionId,
        }),
      });

      if (!response.ok) {
        console.warn(`[AgentMonitor] Failed to send span: HTTP ${response.status}`);
      }
    } catch (error) {
      console.warn('[AgentMonitor] Failed to send span:', error);
    }
  }

  close(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
    }
    // 自动结束所有未关闭的 span
    for (const [traceId, stack] of this.spanStack) {
      while (stack.length > 0) {
        const span = stack.shift()!;
        this.bufferSpan({ ...span, status: 'error', error: 'auto-closed: monitor closed' });
      }
    }
    this.spanStack.clear();
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

  /**
   * P0-2: 兼容 Node.js 和浏览器环境
   * 浏览器：监听 online/offline 事件
   * Node.js：依赖 sendTrace 的错误捕获驱动
   */
  private setupOnlineListener(): void {
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('online', () => {
        this.isOnline = true;
        this.retryDelayMs = 5000; // 重置退避
        this.flush();
      });

      window.addEventListener('offline', () => {
        this.isOnline = false;
      });
    }
    // Node.js 环境：isOnline 状态由 sendTrace 的成功/失败自动驱动
  }

  /**
   * P0-2: Node.js 进程退出前强制 flush，减少数据丢失
   */
  private setupExitHooks(): void {
    if (typeof process !== 'undefined' && typeof process.on === 'function') {
      const flushAndExit = async (signal: string) => {
        console.log(`[AgentMonitor] ${signal} received, flushing buffer...`);
        await this.flush();
        process.exit(0);
      };

      process.on('SIGTERM', () => flushAndExit('SIGTERM'));
      process.on('SIGINT', () => flushAndExit('SIGINT'));

      // 同步退出时的最后保障（exit 事件只能同步）
      process.on('exit', () => {
        if (this.buffer.length > 0) {
          console.warn(`[AgentMonitor] Process exiting with ${this.buffer.length} unflushed events`);
        }
      });
    }
  }
}

export default AgentMonitor;
export * from './types.js';
