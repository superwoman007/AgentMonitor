import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import WebSocket from 'ws';

describe('WebSocket API', () => {
  let app: FastifyInstance;
  let baseUrl: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    baseUrl = `ws://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  /**
   * Connect and collect the first message (the "connected" greeting).
   * We attach the message listener BEFORE the connection opens to avoid
   * a race where the server sends before we listen.
   */
  function connectWs(): Promise<{ ws: WebSocket; firstMessage: Record<string, unknown> }> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${baseUrl}/ws`);
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error('Timeout connecting'));
      }, 5000);

      ws.once('message', (data: WebSocket.RawData) => {
        clearTimeout(timer);
        resolve({ ws, firstMessage: JSON.parse(data.toString()) });
      });
      ws.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  function waitForMessage(ws: WebSocket, timeout = 3000): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout waiting for message')), timeout);
      ws.once('message', (data: WebSocket.RawData) => {
        clearTimeout(timer);
        resolve(JSON.parse(data.toString()));
      });
    });
  }

  it('应该成功建立 WebSocket 连接并收到 connected 消息', async () => {
    const { ws, firstMessage } = await connectWs();

    expect(firstMessage.type).toBe('connected');

    ws.close();
  });

  it('应该响应 ping 消息', async () => {
    const { ws } = await connectWs();

    ws.send(JSON.stringify({ type: 'ping' }));
    const pong = await waitForMessage(ws);

    expect(pong.type).toBe('pong');

    ws.close();
  });

  it('应该支持 subscribe 订阅项目', async () => {
    const { ws } = await connectWs();

    ws.send(JSON.stringify({ type: 'subscribe', projectId: 'test-project-123' }));

    await new Promise((r) => setTimeout(r, 100));

    expect(ws.readyState).toBe(WebSocket.OPEN);

    ws.close();
  });

  it('应该支持 auth 认证消息', async () => {
    const { ws } = await connectWs();

    ws.send(JSON.stringify({ type: 'auth', userId: 'user-123' }));

    await new Promise((r) => setTimeout(r, 100));

    expect(ws.readyState).toBe(WebSocket.OPEN);

    ws.close();
  });

  it('应该处理无效 JSON 而不断开连接', async () => {
    const { ws } = await connectWs();

    ws.send('not-valid-json');

    await new Promise((r) => setTimeout(r, 200));

    expect(ws.readyState).toBe(WebSocket.OPEN);

    ws.close();
  });

  it('应该在客户端断开后清理连接', async () => {
    const { ws } = await connectWs();

    ws.close();

    await new Promise((r) => setTimeout(r, 200));

    expect(ws.readyState).toBe(WebSocket.CLOSED);
  });

  it('应该支持多个并发连接', async () => {
    const { ws: ws1 } = await connectWs();
    const { ws: ws2 } = await connectWs();

    ws1.send(JSON.stringify({ type: 'ping' }));
    ws2.send(JSON.stringify({ type: 'ping' }));

    const pong1 = await waitForMessage(ws1);
    const pong2 = await waitForMessage(ws2);

    expect(pong1.type).toBe('pong');
    expect(pong2.type).toBe('pong');

    ws1.close();
    ws2.close();
  });
});
