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
import {
  runInContext,
  getActiveState,
  getActiveTraceId,
  getActiveSpanId,
  type ActiveSpanState,
} from './context.js';
import { PromptRuntimeClient, type GetPromptOptions, type ResolvedPrompt } from './prompt-runtime.js';

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
  private static activeMonitors = new Set<AgentMonitor>();
  private static exitHooksInstalled = false;
  private config: Required<Omit<SDKConfig, 'apiKey' | 'projectId' | 'promptCacheTtlMs'>> &
    Pick<SDKConfig, 'projectId' | 'promptCacheTtlMs'> & { apiKey: string };
  private buffer: BufferedEvent[] = [];
  private flushTimer?: ReturnType<typeof setInterval>;
  private offlineBuffer: TraceData[] = [];
  private isOnline: boolean = true;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private retryDelayMs: number = 5000;
  private onlineHandler?: () => void;
  private offlineHandler?: () => void;

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
  // Truth Repair-3：上下文传播改由 context.ts 的 AsyncLocalStorage 承担，
  // 解决并发 Promise 下 traceId/parentSpanId 串扰问题。
  // activeSpans 仅作为活跃 span 的注册表，用于内存上限保护与 close() 时兜底关闭。
  private activeSpans = new Map<string, SpanContext>();
  private readonly MAX_SPAN_STACK_SIZE = 1000;

  // PR-12: Prompt Runtime 客户端（按需懒加载，避免未配置项目时报错）
  private promptRuntime?: PromptRuntimeClient;

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
      AgentMonitor.activeMonitors.add(this);
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
    // PR-12：若调用方传入 promptRef，自动把 prompt.id/version_id 写入 metadata，
    // 便于后端按 Prompt 版本聚合 Trace。
    if (request.promptRef) {
      metadata.prompt = {
        id: request.promptRef.id,
        version_id: request.promptRef.versionId,
        name: request.promptRef.name,
        version_number: request.promptRef.versionNumber,
        environment: request.promptRef.environment,
      };
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

    // Truth Repair-2: Trace 即根 Span，二者共享同一组 ID。
    // 由 SDK 生成一次 traceId/spanId，随 /traces 发送给后端；
    // 后端 createTrace 负责将该根 Span 同步写入 spans 表，
    // SDK 不再单独向 /spans 双写，避免产生孤儿重复根节点。
    const startedAt = data.startedAt || new Date().toISOString();
    const endedAt = data.endedAt || (data.latencyMs ? new Date().toISOString() : undefined);
    const traceId = data.traceId || this.generateUUID();
    const spanId = data.spanId || this.generateUUID();

    const enrichedData: TraceData = {
      ...data,
      traceId,
      spanId,
      parentSpanId: data.parentSpanId,
      startedAt,
      endedAt,
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
    if (this.config.projectId) return this.config.projectId;
    const parts = this.config.apiKey.split('_');
    return parts.length > 1 ? parts[0] : '';
  }

  // ─────────────────────────────────────────────
  // PR-12: Prompt Runtime
  // ─────────────────────────────────────────────

  /**
   * 获取 Prompt Runtime 客户端（懒加载）。
   * 若无法解析 projectId，抛错。
   */
  private getPromptRuntime(): PromptRuntimeClient {
    if (this.promptRuntime) return this.promptRuntime;
    const projectId = this.getProjectId();
    if (!projectId) {
      throw new Error(
        '[AgentMonitor] projectId is required for prompt runtime. Set `projectId` in SDKConfig or use an apiKey formatted as `<projectId>_<secret>`.'
      );
    }
    this.promptRuntime = new PromptRuntimeClient({
      baseUrl: this.config.baseUrl,
      apiKey: this.config.apiKey,
      projectId,
      defaultMaxAgeMs: this.config.promptCacheTtlMs,
    });
    return this.promptRuntime;
  }

  /**
   * 从 Runtime 解析已发布的 Prompt。
   *
   * @param promptName - Prompt 名称
   * @param options - environment / maxAgeMs / forceRefresh / signal
   * @returns 解析后的 Prompt（含 content、versionId、etag 等）
   */
  async getPrompt(promptName: string, options?: GetPromptOptions): Promise<ResolvedPrompt> {
    return this.getPromptRuntime().get(promptName, options);
  }

  /**
   * 清空 Prompt Runtime 缓存。
   */
  clearPromptCache(): void {
    this.promptRuntime?.clearCache();
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
        body: JSON.stringify({
          traceId: trace.traceId,
          spanId: trace.spanId,
          parentSpanId: trace.parentSpanId,
          sessionId: trace.sessionId,
          agentId: trace.agentId,
          traceType: trace.traceType,
          name: trace.name,
          input: trace.input,
          output: trace.output,
          metadata: trace.metadata,
          startedAt: trace.startedAt,
          endedAt: trace.endedAt,
          latencyMs: trace.latencyMs,
          status: trace.status,
          error: trace.error,
        }),
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
   *
   * Truth Repair-3：traceId/parentSpanId 从当前异步上下文读取，
   * 不再依赖进程级共享栈，避免并发请求间的 trace 串扰。
   *
   * @param name - Span 名称
   * @param options - 可选配置（输入数据、属性、会话ID）
   * @returns SpanContext 用于后续 endSpan
   */
  startSpan(name: string, options?: SpanOptions): SpanContext {
    // 从当前异步链读取 traceId；无则生成一个作为新链路根
    const traceId = getActiveTraceId() || this.generateUUID();
    const spanId = this.generateUUID();
    // 从当前异步链读取栈顶 spanId 作为父级
    const parentSpanId = getActiveSpanId();

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

    // 注册到活跃表，用于内存保护与 close() 兜底
    this.activeSpans.set(spanId, ctx);
    this.maybeCleanupActiveSpans();

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

    // V2 协议：成功终态统一为 'ok'，兼容调用方仍传 'success' 的旧写法
    const rawStatus = result?.status || (result?.error ? 'error' : 'ok');
    const normalizedStatus = rawStatus === 'success' ? 'ok' : rawStatus;

    const endedCtx: SpanContext = {
      ...ctx,
      endedAt,
      latencyMs,
      status: normalizedStatus,
      output: result?.output,
      error: result?.error,
      attributes: { ...ctx.attributes, ...result?.attributes },
    };

    // 从活跃表移除
    this.activeSpans.delete(ctx.spanId);

    this.bufferSpan(endedCtx);
  }

  /**
   * 便捷方法：自动管理 Span 生命周期
   *
   * Truth Repair-3：通过 runInContext 把新 span 绑定到当前异步链，
   * 函数内部嵌套的 startSpan/withSpan 会自动将本 span 作为 parent。
   *
   * @param name - Span 名称
   * @param fn - 要执行的异步函数，接收 SpanContext 参数
   * @param options - 可选配置
   * @returns 函数执行结果
   */
  async withSpan<T>(name: string, fn: (span: SpanContext) => Promise<T>, options?: SpanOptions): Promise<T> {
    const span = this.startSpan(name, options);
    // 继承已有上下文（若存在），并在栈顶追加本 span
    const parentState = getActiveState();
    const nextState: ActiveSpanState = {
      traceId: span.traceId,
      stack: [...(parentState?.stack ?? []), span],
    };
    try {
      return await runInContext(nextState, async () => {
        const result = await fn(span);
        this.endSpan(span, { status: 'ok', output: result });
        return result;
      });
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
   *
   * Truth Repair-3：从异步上下文读取栈顶 span，无需调用方传 traceId。
   *
   * @param key - 属性键名
   * @param value - 属性值
   */
  setSpanAttribute(key: string, value: unknown): void {
    const state = getActiveState();
    if (state && state.stack.length > 0) {
      const current = state.stack[state.stack.length - 1];
      if (!current.attributes) current.attributes = {};
      current.attributes[key] = value;
    }
  }

  /**
   * 批量设置当前活跃 Span 的属性
   * @param attrs - 要批量设置的属性键值对
   */
  setSpanAttributes(attrs: Record<string, unknown>): void {
    const state = getActiveState();
    if (state && state.stack.length > 0) {
      const current = state.stack[state.stack.length - 1];
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
   * 内存保护：活跃 span 总数超过阈值时，强制关闭最早注册的 span
   */
  private maybeCleanupActiveSpans(): void {
    if (this.activeSpans.size > this.MAX_SPAN_STACK_SIZE) {
      const firstKey = this.activeSpans.keys().next().value;
      if (firstKey) {
        const stale = this.activeSpans.get(firstKey)!;
        this.activeSpans.delete(firstKey);
        this.bufferSpan({ ...stale, status: 'error', error: 'auto-closed: active span overflow' });
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

  async close(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
    }
    // 自动结束所有未关闭的 span（activeSpans 注册表兜底，与异步上下文解耦）
    for (const span of this.activeSpans.values()) {
      this.bufferSpan({ ...span, status: 'error', error: 'auto-closed: monitor closed' });
    }
    this.activeSpans.clear();
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      if (this.onlineHandler) window.removeEventListener('online', this.onlineHandler);
      if (this.offlineHandler) window.removeEventListener('offline', this.offlineHandler);
    }
    AgentMonitor.activeMonitors.delete(this);
    await this.flush();
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
      this.onlineHandler = () => {
        this.isOnline = true;
        this.retryDelayMs = 5000; // 重置退避
        this.flush();
      };

      this.offlineHandler = () => {
        this.isOnline = false;
      };
      window.addEventListener('online', this.onlineHandler);
      window.addEventListener('offline', this.offlineHandler);
    }
    // Node.js 环境：isOnline 状态由 sendTrace 的成功/失败自动驱动
  }

  /**
   * P0-2: Node.js 进程退出前强制 flush，减少数据丢失
   */
  private setupExitHooks(): void {
    if (
      !AgentMonitor.exitHooksInstalled &&
      typeof process !== 'undefined' &&
      typeof process.on === 'function'
    ) {
      AgentMonitor.exitHooksInstalled = true;
      const flushAndExit = async (signal: string) => {
        console.log(`[AgentMonitor] ${signal} received, flushing buffer...`);
        await Promise.all(
          Array.from(AgentMonitor.activeMonitors, monitor => monitor.flush())
        );
        process.exit(0);
      };

      process.on('SIGTERM', () => { void flushAndExit('SIGTERM'); });
      process.on('SIGINT', () => { void flushAndExit('SIGINT'); });

      // 同步退出时的最后保障（exit 事件只能同步）
      process.on('exit', () => {
        const unflushedCount = Array.from(AgentMonitor.activeMonitors)
          .reduce((total, monitor) => total + monitor.buffer.length, 0);
        if (unflushedCount > 0) {
          console.warn(`[AgentMonitor] Process exiting with ${unflushedCount} unflushed events`);
        }
      });
    }
  }
}

export default AgentMonitor;
export * from './types.js';
