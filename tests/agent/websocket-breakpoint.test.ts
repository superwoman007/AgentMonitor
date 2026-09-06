/**
 * WebSocket real-time push + breakpoint end-to-end flow
 * Validates that the backend pushes trace and snapshot events over WebSocket
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { AgentMonitor } from '../../sdk/src/index.js';
import {
  initTestContext,
  delay,
  createBreakpoint,
  getTraces,
  type TestContext,
} from './helpers.js';

const API_URL = process.env.API_URL || 'http://localhost:3000';
// WebSocket 地址由 API_URL 派生（http→ws、https→wss），保证测试服务端口可通过环境变量切换。
const WS_URL = API_URL.replace(/^http/, 'ws') + '/ws';

/** Wait for a specific message type over an open WebSocket */
function waitForWsMessage(ws: WebSocket, expectedType: string, timeoutMs = 10000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timeout waiting for WS message type: ${expectedType}`));
    }, timeoutMs);

    const onMessage = (event: MessageEvent) => {
      try {
        const raw = typeof event.data === 'string' ? event.data : event.data.toString();
        const msg = JSON.parse(raw);
        if (msg.type === expectedType) {
          cleanup();
          resolve(msg);
        }
      } catch {
        // Ignore non-JSON frames
      }
    };

    const onClose = () => {
      cleanup();
      reject(new Error('WebSocket closed unexpectedly'));
    };

    const onError = () => {
      cleanup();
      reject(new Error('WebSocket error'));
    };

    const cleanup = () => {
      clearTimeout(timer);
      ws.removeEventListener('message', onMessage);
      ws.removeEventListener('close', onClose);
      ws.removeEventListener('error', onError);
    };

    ws.addEventListener('message', onMessage);
    ws.addEventListener('close', onClose);
    ws.addEventListener('error', onError);
  });
}

/** Connect, subscribe, and authenticate a WebSocket */
async function connectAndAuth(projectId: string, userId: string, token?: string): Promise<WebSocket> {
  // 握手阶段通过 query token 鉴权（JWT），与后端 WS 鉴权契约一致。
  const wsUrl = token ? `${WS_URL}?token=${encodeURIComponent(token)}` : WS_URL;
  const ws = new WebSocket(wsUrl);

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('WebSocket connection timeout'));
    }, 5000);

    const onOpen = () => {
      clearTimeout(timer);
      cleanup();
      resolve();
    };

    const onError = () => {
      clearTimeout(timer);
      cleanup();
      reject(new Error('WebSocket connection error'));
    };

    const cleanup = () => {
      ws.removeEventListener('open', onOpen);
      ws.removeEventListener('error', onError);
    };

    ws.addEventListener('open', onOpen);
    ws.addEventListener('error', onError);
  });

  ws.send(JSON.stringify({ type: 'subscribe', projectId }));
  ws.send(JSON.stringify({ type: 'auth', userId }));
  await delay(200);

  return ws;
}

describe('WebSocket real-time push + breakpoint end-to-end', () => {
  let ctx: TestContext;
  let monitor: AgentMonitor;

  beforeAll(async () => {
    ctx = await initTestContext();
  });

  afterAll(() => {
    monitor?.close();
  });

  it('WebSocket receives new_trace when SDK sends trace', { timeout: 15000 }, async () => {
    monitor = new AgentMonitor({
      apiKey: ctx.apiKey,
      baseUrl: API_URL,
      flushInterval: 999_999,
      bufferSize: 999_999,
      enableBreakpoints: false,
    });

    const ws = await connectAndAuth(ctx.projectId, ctx.userId, ctx.token);
    const msgPromise = waitForWsMessage(ws, 'new_trace', 10000);

    try {
      await monitor.trace({
        traceType: 'message',
        name: 'ws_test_message',
        input: { role: 'user', content: 'Hello WebSocket' },
        output: { content: 'Hello back' },
        status: 'success',
      });

      await monitor.flush();
      await delay(500);

      const msg = await msgPromise;
      expect(msg.data).toBeDefined();
      const traceType = msg.data.trace_type || msg.data.traceType;
      expect(traceType).toBe('message');
    } finally {
      ws.close();
    }
  });

  it('Keyword breakpoint triggers and snapshot is created', { timeout: 15000 }, async () => {
    monitor = new AgentMonitor({
      apiKey: ctx.apiKey,
      baseUrl: API_URL,
      flushInterval: 999_999,
      bufferSize: 999_999,
      enableBreakpoints: false,
    });

    await createBreakpoint(ctx.token, ctx.projectId, {
      name: 'error-keyword-bp',
      type: 'keyword',
      condition: 'ERROR',
      enabled: true,
    });

    const session = monitor.startSession();
    await monitor.trackMessage({
      sessionId: session.id,
      role: 'assistant',
      content: 'Something went wrong: ERROR',
    });

    await monitor.flush();
    await delay(1000);

    // Verify snapshot was created via REST API
    const res = await fetch(`${API_URL}/api/v1/snapshots?projectId=${ctx.projectId}&sessionId=${session.id}`, {
      headers: { 'Authorization': `Bearer ${ctx.token}` },
    });
    expect(res.ok).toBe(true);
    const data = await res.json() as { snapshots?: any[] };
    expect(data.snapshots?.length).toBeGreaterThanOrEqual(1);
    expect(data.snapshots![0].trigger_reason).toContain('error-keyword-bp');
  });

  it('Latency breakpoint triggers for slow trace', { timeout: 15000 }, async () => {
    monitor = new AgentMonitor({
      apiKey: ctx.apiKey,
      baseUrl: API_URL,
      flushInterval: 999_999,
      bufferSize: 999_999,
      enableBreakpoints: false,
    });

    await createBreakpoint(ctx.token, ctx.projectId, {
      name: 'slow-latency-bp',
      type: 'latency',
      condition: '100',
      enabled: true,
    });

    const session = monitor.startSession();
    await monitor.trackToolCall({
      sessionId: session.id,
      toolName: 'slow_function',
      inputParams: {},
      output: {},
      latencyMs: 5000,
    });

    await monitor.flush();
    await delay(1000);

    // Verify snapshot was created via REST API
    const res = await fetch(`${API_URL}/api/v1/snapshots?projectId=${ctx.projectId}&sessionId=${session.id}`, {
      headers: { 'Authorization': `Bearer ${ctx.token}` },
    });
    expect(res.ok).toBe(true);
    const data = await res.json() as { snapshots?: any[] };
    expect(data.snapshots?.length).toBeGreaterThanOrEqual(1);
    expect(data.snapshots![0].trigger_reason).toContain('slow-latency-bp');
  });
});
