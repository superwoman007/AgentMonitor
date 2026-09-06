/**
 * 狼人杀项目「非侵入监控桥接插件」。
 *
 * 设计目标：业务代码（认知循环 / 角色决策 / 调度器）零改动即可接入 AgentMonitor。
 * 原理：订阅角色 Agent 自带的 HookBus 观测事件（decide/loop/tool/llm/memory/reflect 等），
 *      用 HookContext.traceId 把同一次决策的事件串成一棵父子 Span 树，
 *      再通过官方 @agentmonitor/sdk 上报。HookBus 的观测型事件错误已被总线隔离，
 *      本插件内再包一层 try/catch，任何监控异常都不会影响游戏主流程。
 *
 * 接入方式（仅 1 行，位于 Agent 装配处，非业务逻辑）：
 *   import { registerAgentMonitorBridge } from "./agentMonitorBridge.js"
 *   // 在 new HookBus() / registerDefaultHooks(...) 旁边：
 *   registerAgentMonitorBridge(this.bus, monitor, { resolveSession: (ctx) => `game:${ctx.gameId}:seat:${ctx.seat}:${ctx.role}` })
 */

/**
 * 桥接所需的最小监控出口接口（官方 @agentmonitor/sdk 的结构化子集）。
 * 只要对象具备这两个方法即可：官方 SDK 实例天然满足；手写老 SDK 需适配器补齐 span 字段。
 */
export interface BridgeMonitor {
  /** 确保会话存在（幂等） */
  ensureSession(sessionId: string, metadata?: Record<string, unknown>): Promise<void>
  /** 上报一条 Trace/Span（携带 traceId/spanId/parentSpanId 以还原调用树） */
  trace(data: BridgeTrace): Promise<void>
}

/**
 * 桥接上报名结构（对齐官方 SDK TraceData 的 span 字段）。
 */
export interface BridgeTrace {
  traceId?: string
  spanId?: string
  parentSpanId?: string
  sessionId?: string
  agentId?: string
  traceType: string
  name: string
  input?: unknown
  output?: unknown
  metadata?: Record<string, unknown>
  startedAt?: string
  endedAt?: string
  latencyMs?: number
  status?: 'success' | 'error' | 'ok'
  error?: string
}

/**
 * 桥接所需的最小 HookBus 接口（结构化匹配狼人杀 HookBus.on）。
 */
export interface BridgeHookBus {
  on(event: string, handler: (payload: unknown, ctx: BridgeHookContext) => unknown, priority?: number): unknown
}

/**
 * 桥接所需的最小 Hook 上下文（结构化匹配狼人杀 HookContext）。
 */
export interface BridgeHookContext {
  gameId: string
  seat: number
  role: string
  traceId: string
  source?: string
}

/**
 * 桥接配置。
 */
export interface BridgeOptions {
  /**
   * 由 Hook 上下文解析会话 ID。
   * 默认与狼人杀 buildPlayerSessionId 规则一致：`game:<gameId>:seat:<seat>:<role>`。
   */
  resolveSession?: (ctx: BridgeHookContext) => string
  /**
   * 由 Hook 上下文解析 Agent ID。
   * 默认规则：`seat:<seat>:<role>:<gameId>`。
   */
  resolveAgent?: (ctx: BridgeHookContext) => string
  /** 处理器优先级（数字越小越先执行），默认 200（晚于业务内置 hook）。 */
  priority?: number
}

/**
 * 内部 Span 栈帧：记录一次尚未结束的 span，用于配对 before/after 事件。
 */
interface SpanFrame {
  spanId: string
  parentSpanId?: string
  name: string
  traceType: string
  startedAt: number
  input?: unknown
}

/**
 * 生成一个短随机 Span ID（W3C 风格 16 位十六进制）。
 * @returns 16 位十六进制字符串
 */
function newSpanId(): string {
  const bytes = new Uint8Array(8)
  globalThis.crypto?.getRandomValues?.(bytes)
  return Array.from(bytes ?? [Date.now() & 0xffffffff], (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * 默认会话 ID 解析：与狼人杀 buildPlayerSessionId 保持一致。
 * @param ctx Hook 上下文
 * @returns 会话 ID 字符串
 */
function defaultResolveSession(ctx: BridgeHookContext): string {
  return `game:${ctx.gameId}:seat:${ctx.seat}:${ctx.role}`
}

/**
 * 默认 Agent ID 解析：与狼人杀 buildPlayerAgentId 保持一致。
 * @param ctx Hook 上下文
 * @returns Agent ID 字符串
 */
function defaultResolveAgent(ctx: BridgeHookContext): string {
  return `seat:${ctx.seat}:${ctx.role}:${ctx.gameId}`
}

/**
 * 向 HookBus 注册 AgentMonitor 非侵入监控桥接。
 * 订阅全部观测型事件，按 traceId 维护 Span 栈，还原「决策 → 规划/工具/LLM → 反思」调用树。
 * @param bus 角色 Agent 的 HookBus 实例
 * @param monitor 监控出口（官方 SDK 实例或兼容适配器）
 * @param options 可选配置（会话/Agent 解析、优先级）
 * @returns 无返回值；注册后随 HookBus 生命周期生效
 */
export function registerAgentMonitorBridge(
  bus: BridgeHookBus,
  monitor: BridgeMonitor,
  options: BridgeOptions = {},
): void {
  const resolveSession = options.resolveSession ?? defaultResolveSession
  const resolveAgent = options.resolveAgent ?? defaultResolveAgent
  const priority = options.priority ?? 200

  // 每条决策链路（traceId）一个 span 栈；栈底为 decide 根 span
  const stacks = new Map<string, SpanFrame[]>()
  // 已 ensure 过的会话，避免重复请求
  const ensuredSessions = new Set<string>()

  /**
   * 安全执行监控逻辑：永不因监控异常影响游戏。
   * @param fn 监控动作
   */
  const safe = (fn: () => Promise<void>): void => {
    void Promise.resolve()
      .then(fn)
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error('[agentMonitorBridge] 上报失败（已隔离，不影响游戏）:', err instanceof Error ? err.message : err)
      })
  }

  /**
   * 确保会话已上报（幂等，带缓存）。
   * @param ctx Hook 上下文
   * @param sessionId 会话 ID
   */
  const ensureSessionOnce = (ctx: BridgeHookContext, sessionId: string): void => {
    if (ensuredSessions.has(sessionId)) return
    ensuredSessions.add(sessionId)
    safe(async () => {
      await monitor.ensureSession(sessionId, {
        gameId: ctx.gameId,
        seat: ctx.seat,
        role: ctx.role,
        'sdk.language': 'typescript',
        'sdk.version': 'werewolf-bridge/1.0',
        agentName: `seat-${ctx.seat}-${ctx.role}`,
      })
    })
  }

  /**
   * 压入一个 span 并返回栈帧。
   * @param ctx Hook 上下文
   * @param name span 名称
   * @param traceType trace 类型（agent/tool_call/llm 等）
   * @param input 输入数据
   * @returns 新建的栈帧
   */
  const pushSpan = (
    ctx: BridgeHookContext,
    name: string,
    traceType: string,
    input?: unknown,
  ): SpanFrame => {
    const stack = stacks.get(ctx.traceId) ?? []
    const parent = stack[stack.length - 1]
    const frame: SpanFrame = {
      spanId: newSpanId(),
      parentSpanId: parent?.spanId,
      name,
      traceType,
      startedAt: Date.now(),
      input,
    }
    stack.push(frame)
    stacks.set(ctx.traceId, stack)
    return frame
  }

  /**
   * 弹出当前 traceId 的栈顶 span；若栈空返回 null。
   * @param traceId 链路 ID
   * @returns 栈顶栈帧或 null
   */
  const popSpan = (traceId: string): SpanFrame | null => {
    const stack = stacks.get(traceId)
    if (!stack || stack.length === 0) return null
    const frame = stack.pop()!
    if (stack.length === 0) stacks.delete(traceId)
    return frame
  }

  /**
   * 上报一条结束的 span。
   * @param ctx Hook 上下文
   * @param frame 栈帧
   * @param patch 结束时补充的字段（output/status/error）
   */
  const emitSpan = (
    ctx: BridgeHookContext,
    frame: SpanFrame,
    patch: { output?: unknown; status?: BridgeTrace['status']; error?: string; metadata?: Record<string, unknown> } = {},
  ): void => {
    const sessionId = resolveSession(ctx)
    const endedAt = Date.now()
    safe(async () => {
      await monitor.trace({
        traceId: ctx.traceId,
        spanId: frame.spanId,
        parentSpanId: frame.parentSpanId,
        sessionId,
        agentId: resolveAgent(ctx),
        traceType: frame.traceType,
        name: frame.name,
        input: frame.input,
        output: patch.output,
        status: patch.status ?? 'success',
        error: patch.error,
        startedAt: new Date(frame.startedAt).toISOString(),
        endedAt: new Date(endedAt).toISOString(),
        latencyMs: endedAt - frame.startedAt,
        metadata: { seat: ctx.seat, role: ctx.role, gameId: ctx.gameId, ...patch.metadata },
      })
    })
  }

  // ========== 决策生命周期：根 Span（agent hook 由此被平台识别） ==========

  bus.on('decide:before', (payload, ctx) => {
    ensureSessionOnce(ctx, resolveSession(ctx))
    const p = payload as { ctx?: unknown; budget?: unknown }
    pushSpan(ctx, `agent.decide.${ctx.role}`, 'agent', { phase: (p as { ctx?: { game?: { phase?: string } } })?.ctx?.game?.phase })
  }, priority)

  bus.on('decide:after', (_payload, ctx) => {
    const frame = popSpan(ctx.traceId)
    if (frame) {
      const outcome = _payload as { degraded?: boolean; llmCalls?: number; toolCalls?: number; totalLatencyMs?: number }
      emitSpan(ctx, frame, {
        output: { degraded: outcome?.degraded, llmCalls: outcome?.llmCalls, toolCalls: outcome?.toolCalls },
        metadata: { degraded: outcome?.degraded },
      })
    }
  }, priority)

  bus.on('decide:error', (payload, ctx) => {
    const frame = popSpan(ctx.traceId)
    const err = (payload as { error?: Error })?.error
    if (frame) emitSpan(ctx, frame, { status: 'error', error: err?.message ?? String(err) })
  }, priority)

  // ========== 工具调用：tool_call Span（配对 before/after/error） ==========

  bus.on('tool:before', (payload, ctx) => {
    const p = payload as { tool?: string; args?: Record<string, unknown> }
    pushSpan(ctx, `tool:${p.tool ?? 'unknown'}`, 'tool_call', p.args)
  }, priority)

  bus.on('tool:after', (payload, ctx) => {
    const frame = popSpan(ctx.traceId)
    if (!frame) return
    const p = payload as { result?: { ok?: boolean; data?: unknown; error?: string } }
    emitSpan(ctx, frame, {
      output: p.result?.data,
      status: p.result?.ok === false ? 'error' : 'success',
      error: p.result?.error,
    })
  }, priority)

  bus.on('tool:error', (payload, ctx) => {
    const frame = popSpan(ctx.traceId)
    if (frame) emitSpan(ctx, frame, { status: 'error', error: (payload as { error?: string })?.error })
  }, priority)

  // ========== LLM 调用：llm Span ==========

  bus.on('llm:request', (payload, ctx) => {
    const p = payload as { model?: string; messageCount?: number }
    pushSpan(ctx, `llm:${p.model ?? 'model'}`, 'llm', { messageCount: p.messageCount })
  }, priority)

  bus.on('llm:response', (payload, ctx) => {
    const frame = popSpan(ctx.traceId)
    if (!frame) return
    const p = payload as { content?: string; usage?: unknown; latencyMs?: number }
    emitSpan(ctx, frame, { output: { content: p.content, usage: p.usage }, metadata: { usage: p.usage } })
  }, priority)

  bus.on('llm:error', (payload, ctx) => {
    const frame = popSpan(ctx.traceId)
    if (frame) emitSpan(ctx, frame, { status: 'error', error: (payload as { error?: string })?.error })
  }, priority)

  // ========== 认知循环阶段：作为根 Span 下的即时观测事件 ==========

  bus.on('loop:plan', (payload, ctx) => {
    const p = payload as { goal?: string; steps?: string[] | null }
    const frame = pushSpan(ctx, 'loop.plan', 'plan', { goal: p.goal })
    emitSpan(ctx, frame, { output: { steps: p.steps } })
    // 即时事件：立即弹栈（不包裹后续阶段）
    popSpan(ctx.traceId)
  }, priority)

  bus.on('loop:think', (payload, ctx) => {
    const p = payload as { content?: string; llmCallIndex?: number }
    const frame = pushSpan(ctx, `loop.think#${p.llmCallIndex ?? 0}`, 'llm', undefined)
    emitSpan(ctx, frame, { output: { thinking: p.content } })
    popSpan(ctx.traceId)
  }, priority)

  bus.on('loop:observe', (payload, ctx) => {
    const p = payload as { summary?: string }
    const frame = pushSpan(ctx, 'loop.observe', 'observation', undefined)
    emitSpan(ctx, frame, { output: { summary: p.summary } })
    popSpan(ctx.traceId)
  }, priority)

  // ========== 记忆 / 规划 / 反思 / 游戏事件：观测埋点 ==========

  bus.on('memory:writeNote', (payload, ctx) => {
    const frame = pushSpan(ctx, 'memory.writeNote', 'memory', payload)
    emitSpan(ctx, frame)
    popSpan(ctx.traceId)
  }, priority)

  bus.on('memory:consolidate', (payload, ctx) => {
    const frame = pushSpan(ctx, 'memory.consolidate', 'memory', payload)
    emitSpan(ctx, frame)
    popSpan(ctx.traceId)
  }, priority)

  bus.on('plan:created', (payload, ctx) => {
    const frame = pushSpan(ctx, 'plan.created', 'plan', payload)
    emitSpan(ctx, frame)
    popSpan(ctx.traceId)
  }, priority)

  bus.on('reflect:selfCheck', (payload, ctx) => {
    const frame = pushSpan(ctx, 'reflect.selfCheck', 'reflection', payload)
    emitSpan(ctx, frame)
    popSpan(ctx.traceId)
  }, priority)

  bus.on('reflect:phase', (payload, ctx) => {
    const frame = pushSpan(ctx, 'reflect.phase', 'reflection', payload)
    emitSpan(ctx, frame)
    popSpan(ctx.traceId)
  }, priority)

  bus.on('game:phaseChanged', (payload, ctx) => {
    const p = payload as { from?: string; to?: string; day?: number }
    const frame = pushSpan(ctx, `game.phase:${p.from}->${p.to}`, 'session', payload)
    emitSpan(ctx, frame)
    popSpan(ctx.traceId)
  }, priority)
}
