/**
 * Span 异步上下文传播
 *
 * Truth Repair-3：
 * 原实现使用进程级 Map<spanStack> 在并发 Promise 之间共享栈，
 * 当多个 trace 并发执行（如 HTTP 服务并发处理多个请求）时，
 * 一个 trace 的子 span 会错误地挂到另一个 trace 的活跃 span 下，
 * 导致 traceId/parentSpanId 串扰。
 *
 * 本模块提供：
 *  - Node.js 环境：基于 node:async_hooks 的 AsyncLocalStorage，
 *    每个异步链自动拥有独立的活跃 span 栈，天然支持并发。
 *  - 浏览器/非 Node 环境：降级为模块级变量。浏览器为单线程事件循环，
 *    同步发起的 span 在同一宏任务中串行执行，不会交叉；
 *    真正需要并发的场景（如 Web Worker）建议每个 Worker 使用独立 SDK 实例。
 */
import type { SpanContext } from './types.js';

// Node 内置模块：在 Node ESM 下使用命名导入，浏览器环境由下方 isNode 守卫避免实际调用
import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * 活跃 Span 上下文状态
 */
export interface ActiveSpanState {
  /** 当前异步链绑定的 traceId */
  traceId?: string;
  /** 当前异步链活跃 span 栈（栈顶为最新 span） */
  stack: SpanContext[];
}

/**
 * 上下文存储抽象，屏蔽 Node / 浏览器差异
 */
interface ContextStore {
  /** 在给定上下文中运行函数，内部派生的 span 会自动继承该上下文 */
  run<T>(state: ActiveSpanState, fn: () => T): T;
  /** 获取当前异步链的状态，不存在返回 undefined */
  getStore(): ActiveSpanState | undefined;
}

const isNode =
  typeof process !== 'undefined' &&
  process.versions != null &&
  process.versions.node != null;

function createNodeStore(): ContextStore {
  const als = new AsyncLocalStorage<ActiveSpanState>();
  return {
    run<T>(state: ActiveSpanState, fn: () => T): T {
      return als.run(state, fn);
    },
    getStore(): ActiveSpanState | undefined {
      return als.getStore();
    },
  };
}

function createFallbackStore(): ContextStore {
  // 浏览器降级方案：模块级当前状态
  let current: ActiveSpanState | undefined;
  return {
    run<T>(state: ActiveSpanState, fn: () => T): T {
      const prev = current;
      current = state;
      try {
        return fn();
      } finally {
        current = prev;
      }
    },
    getStore(): ActiveSpanState | undefined {
      return current;
    },
  };
}

const store: ContextStore = isNode ? createNodeStore() : createFallbackStore();

/**
 * 在指定活跃 span 上下文中执行函数。
 * 用于 withSpan/startSpan 包装，保证内部嵌套 span 能正确拿到 parentSpanId。
 *
 * @param state - 要绑定的活跃 span 状态
 * @param fn - 在该上下文中执行的函数
 * @returns 函数返回值
 */
export function runInContext<T>(state: ActiveSpanState, fn: () => T): T {
  return store.run(state, fn);
}

/**
 * 获取当前异步链的活跃 span 状态。
 * @returns 当前上下文状态，不存在则 undefined
 */
export function getActiveState(): ActiveSpanState | undefined {
  return store.getStore();
}

/**
 * 获取当前异步链绑定的 traceId。
 * @returns traceId 或 undefined
 */
export function getActiveTraceId(): string | undefined {
  return store.getStore()?.traceId;
}

/**
 * 获取当前异步链栈顶 spanId（作为新 span 的 parentSpanId）。
 * @returns spanId 或 undefined
 */
export function getActiveSpanId(): string | undefined {
  const s = store.getStore()?.stack;
  return s && s.length > 0 ? s[s.length - 1].spanId : undefined;
}
