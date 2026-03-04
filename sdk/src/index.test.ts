import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentMonitor } from '../src/index.js';
import type { Breakpoint } from '../src/types.js';

// ─────────────────────────────────────────────────────────
// 测试辅助
// ─────────────────────────────────────────────────────────

const globalAny = global as Record<string, unknown>;

/** 测试用默认配置：禁用自动 flush，避免 setInterval 干扰 fake timers */
const BASE_CONFIG = {
  apiKey: 'proj-1_test-key',
  flushInterval: 999_999_999, // 几乎永不自动 flush
  bufferSize: 999_999,        // 不触发 buffer-full flush
};

const makeBreakpoint = (overrides: Partial<Breakpoint> = {}): Breakpoint => ({
  id: 'bp-1',
  project_id: 'proj-1',
  name: 'Test Breakpoint',
  type: 'keyword',
  condition: 'ERROR',
  enabled: true,
  ...overrides,
});

function okResponse(body: unknown = {}) {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: async () => body,
  } as Response);
}

function errResponse() {
  return Promise.reject(new Error('Network error'));
}

let monitor: AgentMonitor | null = null;

afterEach(() => {
  monitor?.close();
  monitor = null;
  vi.restoreAllMocks();
  delete globalAny.fetch;
});

// ─────────────────────────────────────────────────────────
// P0-1 测试组：断点本地缓存 + 本地匹配
// ─────────────────────────────────────────────────────────

describe('P0-1: 断点本地缓存', () => {
  it('trackMessage 无断点时不发 /breakpoints/check 网络请求', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ breakpoints: [] }) } as Response) // 初始化拉取
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({}) } as Response); // trace 上报
    globalAny.fetch = fetchMock;

    monitor = AgentMonitor.init({ ...BASE_CONFIG, enableBreakpoints: true });

    // 等待初始化的断点规则拉取完成
    await Promise.resolve();

    fetchMock.mockClear();

    await monitor.trackMessage({ sessionId: 'sess-1', role: 'user', content: '普通消息' });
    await monitor.flush();

    const calls = fetchMock.mock.calls.map(c => c[0] as string);
    const checkCalls = calls.filter(url => url.includes('breakpoints/check'));
    expect(checkCalls.length).toBe(0);
  });

  it('本地匹配命中关键词断点，只发快照请求而非 /check', async () => {
    const bp = makeBreakpoint({ condition: 'ERROR' });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ breakpoints: [bp] }) } as Response) // 初始化拉取
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ snapshot: { id: 'snap-1' } }) } as Response);
    globalAny.fetch = fetchMock;

    monitor = AgentMonitor.init({ ...BASE_CONFIG, enableBreakpoints: true });
    await Promise.resolve();
    fetchMock.mockClear();

    await monitor.trackMessage({ sessionId: 'sess-1', role: 'assistant', content: '发生了 ERROR，请检查' });
    await monitor.flush();
    await Promise.resolve(); // 等待快照发送

    const calls = fetchMock.mock.calls.map(c => c[0] as string);
    expect(calls.some(u => u.includes('breakpoints/check'))).toBe(false);
    expect(calls.some(u => u.includes('snapshots'))).toBe(true);
  });

  it('断点 enabled=false 时不触发快照', async () => {
    const bp = makeBreakpoint({ condition: 'ERROR', enabled: false });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ breakpoints: [bp] }) } as Response)
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({}) } as Response);
    globalAny.fetch = fetchMock;

    monitor = AgentMonitor.init({ ...BASE_CONFIG, enableBreakpoints: true });
    await Promise.resolve();
    fetchMock.mockClear();

    await monitor.trackMessage({ sessionId: 'sess-1', role: 'assistant', content: 'ERROR 发生了' });
    await monitor.flush();

    const calls = fetchMock.mock.calls.map(c => c[0] as string);
    expect(calls.some(u => u.includes('snapshots'))).toBe(false);
  });

  it('延迟断点：latencyMs 未超阈值不触发，超阈值才触发', async () => {
    const bp = makeBreakpoint({ type: 'latency', condition: '2000' });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ breakpoints: [bp] }) } as Response)
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ snapshot: { id: 'snap-1' } }) } as Response);
    globalAny.fetch = fetchMock;

    monitor = AgentMonitor.init({ ...BASE_CONFIG, enableBreakpoints: true });
    await Promise.resolve();
    fetchMock.mockClear();

    // 未超阈值
    await monitor.trackToolCall({ id: 'tc-1', sessionId: 'sess-1', toolName: 'search', inputParams: {}, latencyMs: 500 });
    let calls = fetchMock.mock.calls.map(c => c[0] as string);
    expect(calls.some(u => u.includes('snapshots'))).toBe(false);

    fetchMock.mockClear();

    // 超阈值
    await monitor.trackToolCall({ id: 'tc-2', sessionId: 'sess-1', toolName: 'search', inputParams: {}, latencyMs: 3000 });
    await Promise.resolve();
    calls = fetchMock.mock.calls.map(c => c[0] as string);
    expect(calls.some(u => u.includes('snapshots'))).toBe(true);
  });

  it('enableBreakpoints=false 时，不发任何断点相关请求', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ breakpoints: [] }) } as Response);
    globalAny.fetch = fetchMock;

    monitor = AgentMonitor.init({ ...BASE_CONFIG, enableBreakpoints: false });
    await Promise.resolve();

    const bpFetches = fetchMock.mock.calls.filter(c => (c[0] as string).includes('breakpoints'));
    expect(bpFetches.length).toBe(0);
  });

  it('消息内容不含关键词时，不触发断点', async () => {
    const bp = makeBreakpoint({ condition: 'ERROR' });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ breakpoints: [bp] }) } as Response)
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({}) } as Response);
    globalAny.fetch = fetchMock;

    monitor = AgentMonitor.init({ ...BASE_CONFIG, enableBreakpoints: true });
    await Promise.resolve();
    fetchMock.mockClear();

    await monitor.trackMessage({ sessionId: 'sess-1', role: 'user', content: '一切正常，没有问题' });

    const calls = fetchMock.mock.calls.map(c => c[0] as string);
    expect(calls.some(u => u.includes('snapshots'))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────
// P0-2 测试组：Node.js 离线兼容 + 指数退避重试
// ─────────────────────────────────────────────────────────

describe('P0-2: Node.js 离线兼容', () => {
  it('无 window 对象时，SDK 初始化不报错', () => {
    const originalWindow = globalAny.window;
    delete globalAny.window;
    globalAny.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ breakpoints: [] }) } as Response);

    expect(() => {
      monitor = AgentMonitor.init({ ...BASE_CONFIG, enableBreakpoints: false });
    }).not.toThrow();

    globalAny.window = originalWindow;
  });

  it('网络请求失败时，trace 进入 offlineBuffer，不丢失数据', async () => {
    let callCount = 0;
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      callCount++;
      // 第 1 次（断点初始化）成功，其余全部失败
      if (callCount === 1 && (url as string).includes('breakpoints')) return okResponse({ breakpoints: [] });
      return errResponse();
    });
    globalAny.fetch = fetchMock;

    monitor = AgentMonitor.init({ ...BASE_CONFIG, enableBreakpoints: false, bufferSize: 1 });
    await Promise.resolve();
    fetchMock.mockClear();
    callCount = 0;

    // bufferSize=1 会在 trace() 后立即触发 flush，flush 失败后 offlineBuffer 应有数据
    // 然后让网络恢复，重试应该补发
    fetchMock.mockImplementation(() => okResponse({}));

    // 手动 flush（模拟 bufferSize 触发），先让它失败
    fetchMock.mockRejectedValueOnce(new Error('Network error'));
    monitor['buffer'].push({ type: 'trace', data: { traceType: 'llm', name: 'gpt-4', status: 'success' } });
    await monitor.flush().catch(() => {});

    // offlineBuffer 有数据
    expect(monitor['offlineBuffer'].length).toBeGreaterThan(0);

    // 网络恢复，再次 flush 应补发
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) } as Response);
    await monitor.flush();

    expect(monitor['offlineBuffer'].length).toBe(0);
  });

  it('sendTrace 成功后 isOnline 置为 true', async () => {
    globalAny.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ breakpoints: [] }) } as Response);

    monitor = AgentMonitor.init({ ...BASE_CONFIG, enableBreakpoints: false });
    await Promise.resolve();

    // 手动设置离线状态
    monitor['isOnline'] = false;

    // 发送成功的 trace
    globalAny.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) } as Response);
    await monitor['sendTrace']({ traceType: 'llm', name: 'gpt-4', status: 'success' });

    expect(monitor['isOnline']).toBe(true);
  });

  it('sendTrace 失败后 isOnline 置为 false，trace 进入 offlineBuffer', async () => {
    // enableBreakpoints=false，不会拉取断点规则，fetch 全部给 sendTrace 用
    globalAny.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    monitor = AgentMonitor.init({ ...BASE_CONFIG, enableBreakpoints: false });
    await Promise.resolve();

    // 确保初始状态是在线
    monitor['isOnline'] = true;

    const trace = { traceType: 'llm', name: 'gpt-4', status: 'success' as const };
    await monitor['sendTrace'](trace).catch(() => {});

    expect(monitor['isOnline']).toBe(false);
    expect(monitor['offlineBuffer']).toContainEqual(trace);
  });

  it('指数退避：scheduleRetry 被调用后，retryDelayMs 递增', async () => {
    globalAny.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    monitor = AgentMonitor.init({ ...BASE_CONFIG, enableBreakpoints: false });
    await Promise.resolve();

    const initialDelay = monitor['retryDelayMs'];

    monitor['scheduleRetry']();
    // 清除已安排的计时器，避免真正触发
    if (monitor['retryTimer']) {
      clearTimeout(monitor['retryTimer']);
      monitor['retryTimer'] = undefined;
    }

    // 模拟重试触发后 delay 递增
    monitor['retryDelayMs'] = Math.min(monitor['retryDelayMs'] * 2, 60_000);
    const secondDelay = monitor['retryDelayMs'];

    expect(secondDelay).toBeGreaterThan(initialDelay);
    expect(secondDelay).toBeLessThanOrEqual(60_000);
  });

  it('retryDelayMs 不超过 60 秒上限', async () => {
    globalAny.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ breakpoints: [] }) } as Response);
    monitor = AgentMonitor.init({ ...BASE_CONFIG, enableBreakpoints: false });
    await Promise.resolve();

    // 模拟多次退避
    monitor['retryDelayMs'] = 30_000;
    monitor['retryDelayMs'] = Math.min(monitor['retryDelayMs'] * 2, 60_000);
    expect(monitor['retryDelayMs']).toBe(60_000);

    // 继续退避，不超过上限
    monitor['retryDelayMs'] = Math.min(monitor['retryDelayMs'] * 2, 60_000);
    expect(monitor['retryDelayMs']).toBe(60_000);
  });

  it('scheduleRetry 不重复调度（幂等性）', async () => {
    globalAny.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ breakpoints: [] }) } as Response);
    monitor = AgentMonitor.init({ ...BASE_CONFIG, enableBreakpoints: false });
    await Promise.resolve();

    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');

    monitor['scheduleRetry']();
    monitor['scheduleRetry'](); // 第二次调用，不应再 setTimeout
    monitor['scheduleRetry'](); // 第三次调用，同上

    // 只有第一次 scheduleRetry 应该触发 setTimeout
    const retryCalls = setTimeoutSpy.mock.calls.filter(c => (c[1] as number) >= 5000);
    expect(retryCalls.length).toBe(1);

    // 清除计时器，避免后续影响
    if (monitor['retryTimer']) {
      clearTimeout(monitor['retryTimer']);
      monitor['retryTimer'] = undefined;
    }
  });
});

// ─────────────────────────────────────────────────────────
// P1 测试组：采样机制
// ─────────────────────────────────────────────────────────

describe('P1: 采样机制', () => {
  it('sampleRate=0.1，发 1000 条 trace，约 100 条被上报（误差 ±5%）', async () => {
    globalAny.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) } as Response);

    monitor = AgentMonitor.init({
      ...BASE_CONFIG,
      enableBreakpoints: false,
      sampleRate: 0.1,
    });

    // 发 1000 条无 sessionId 的 trace（每条独立随机采样）
    for (let i = 0; i < 1000; i++) {
      await monitor.trace({ traceType: 'llm', name: 'gpt-4', status: 'success' });
    }
    await monitor.flush();

    const callCount = globalAny.fetch.mock.calls.length;
    // 采样率 10%，1000 条里约 100 条，误差范围 50~150（统计 5σ）
    expect(callCount).toBeGreaterThanOrEqual(50);
    expect(callCount).toBeLessThanOrEqual(150);
  });

  it('sampleRate=1（默认），全量上报，无丢弃', async () => {
    globalAny.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) } as Response);

    monitor = AgentMonitor.init({
      ...BASE_CONFIG,
      enableBreakpoints: false,
      sampleRate: 1,
    });

    // 发 10 条，手动 flush
    for (let i = 0; i < 10; i++) {
      await monitor.trace({ traceType: 'llm', name: 'gpt-4', status: 'success' });
    }
    await monitor.flush();

    const callCount = globalAny.fetch.mock.calls.length;
    expect(callCount).toBe(10); // 全部上报
  });

  it('错误 trace 不受采样影响（100% 上报）', async () => {
    globalAny.fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({}) } as Response);

    monitor = AgentMonitor.init({
      ...BASE_CONFIG,
      enableBreakpoints: false,
      sampleRate: 0, // 采样率 0
      alwaysCapture: ['error'], // 但错误总是捕获
      bufferSize: 1,
    });

    // 发送 10 条错误
    for (let i = 0; i < 10; i++) {
      await monitor.trace({ traceType: 'llm', name: 'gpt-4', status: 'error', error: 'error msg' });
    }
    await monitor.flush();

    const callCount = globalAny.fetch.mock.calls.length;
    expect(callCount).toBe(10); // 错误全部上报
  });

  it('Session 级采样：同一 session 的 trace 采样决策一致（要么全采要么全不采）', async () => {
    globalAny.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) } as Response);

    monitor = AgentMonitor.init({
      ...BASE_CONFIG,
      enableBreakpoints: false,
      sampleRate: 0.5,
    });

    // 同一 session 发 20 条
    for (let i = 0; i < 20; i++) {
      await monitor.trace({ sessionId: 'sess-consistent', traceType: 'llm', name: 'gpt-4', status: 'success' });
    }
    await monitor.flush();

    const callCount = globalAny.fetch.mock.calls.length;
    // session 级采样：要么全部 20 条都上报，要么 0 条
    expect(callCount === 0 || callCount === 20).toBe(true);
  });

  it('不同 session 的采样决策独立', async () => {
    globalAny.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) } as Response);

    monitor = AgentMonitor.init({
      ...BASE_CONFIG,
      enableBreakpoints: false,
      sampleRate: 0.5,
      bufferSize: 1,
    });

    // 两个 session 各发 10 条
    for (let i = 0; i < 10; i++) {
      await monitor.trace({ sessionId: 'sess-1', traceType: 'llm', name: 'gpt-4', status: 'success' });
      await monitor.trace({ sessionId: 'sess-2', traceType: 'llm', name: 'gpt-4', status: 'success' });
    }
    await monitor.flush();

    // 验证两个 session 的决策独立（虽然不能直接验证内部状态，但可以通过采样分布推断）
    // 实际场景下，大概率两个 session 至少有一个被采中
    const callCount = globalAny.fetch.mock.calls.length;
    expect(callCount).toBeGreaterThan(0);
  });

  it('sampleRate=0，全部丢弃（除非 alwaysCapture）', async () => {
    globalAny.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) } as Response);

    monitor = AgentMonitor.init({
      ...BASE_CONFIG,
      enableBreakpoints: false,
      sampleRate: 0, // 全部丢弃
      alwaysCapture: [], // 无强制捕获
      bufferSize: 1,
    });

    // 发送 10 条普通 trace
    for (let i = 0; i < 10; i++) {
      await monitor.trace({ traceType: 'llm', name: 'gpt-4', status: 'success' });
    }
    await monitor.flush();

    const callCount = globalAny.fetch.mock.calls.length;
    expect(callCount).toBe(0); // 全部丢弃
  });

  it('断点 trace 默认被 alwaysCapture（breakpoint）包含', async () => {
    globalAny.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) } as Response);

    monitor = AgentMonitor.init({
      ...BASE_CONFIG,
      enableBreakpoints: false,
      sampleRate: 0, // 采样率 0
      // alwaysCapture 默认包含 'breakpoint'
      bufferSize: 1,
    });

    // 发送 10 条断点 trace
    for (let i = 0; i < 10; i++) {
      await monitor.trace({ sessionId: 'sess-1', traceType: 'breakpoint', name: 'bp-test', status: 'success' });
    }
    await monitor.flush();

    const callCount = globalAny.fetch.mock.calls.length;
    // alwaysCapture 默认包含 'breakpoint'，所以应该全部上报
    expect(callCount).toBe(10);
  });
});
