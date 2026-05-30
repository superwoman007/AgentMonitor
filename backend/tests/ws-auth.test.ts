import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import WebSocket from 'ws';
import { register } from '../src/services/auth';
import { createProject } from '../src/services/project';

describe('WebSocket Authentication', () => {
  let app: FastifyInstance;
  let baseUrl: string;
  let validToken: string;
  let userId: string;
  let projectId: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    baseUrl = `ws://127.0.0.1:${port}`;

    // Create test user and project
    const auth = await register(`ws-auth-test-${Date.now()}@test.com`, 'Test12345678!');
    validToken = auth.token;
    userId = auth.user.id;
    const project = await createProject(userId, 'ws-test-project');
    projectId = project.id;
  });

  afterAll(async () => {
    await app.close();
  });

  function connectWs(token?: string): Promise<{ ws: WebSocket; firstMessage: Record<string, unknown> }> {
    return new Promise((resolve, reject) => {
      const url = token ? `${baseUrl}/ws?token=${token}` : `${baseUrl}/ws`;
      const ws = new WebSocket(url);
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
      ws.once('close', (code) => {
        clearTimeout(timer);
        if (code !== 1000) {
          reject(new Error(`Connection closed with code ${code}`));
        }
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

  describe('连接认证', () => {
    it('无 token 连接应被拒绝', async () => {
      try {
        await connectWs();
        fail('Should have been rejected');
      } catch (error) {
        expect((error as Error).message).toMatch(/closed|rejected|401/i);
      }
    });

    it('无效 token 连接应被拒绝', async () => {
      try {
        await connectWs('invalid-token-xyz');
        fail('Should have been rejected');
      } catch (error) {
        expect((error as Error).message).toMatch(/closed|rejected|401/i);
      }
    });

    it('有效 token 应成功连接并收到 connected 消息', async () => {
      const { ws, firstMessage } = await connectWs(validToken);
      expect(firstMessage.type).toBe('connected');
      expect(firstMessage.userId).toBe(userId);
      ws.close();
    });
  });

  describe('项目订阅权限', () => {
    it('订阅自己的项目应成功', async () => {
      const { ws } = await connectWs(validToken);
      ws.send(JSON.stringify({ type: 'subscribe', projectId }));
      const msg = await waitForMessage(ws);
      expect(msg.type).toBe('subscribed');
      expect(msg.projectId).toBe(projectId);
      ws.close();
    });

    it('订阅不属于自己的项目应被拒绝', async () => {
      const { ws } = await connectWs(validToken);
      ws.send(JSON.stringify({ type: 'subscribe', projectId: 'non-existent-project' }));
      const msg = await waitForMessage(ws);
      expect(msg.type).toBe('error');
      expect(msg.error).toMatch(/not found|unauthorized|forbidden/i);
      ws.close();
    });
  });

  describe('心跳机制', () => {
    it('应响应 ping 消息', async () => {
      const { ws } = await connectWs(validToken);
      ws.send(JSON.stringify({ type: 'ping' }));
      const msg = await waitForMessage(ws);
      expect(msg.type).toBe('pong');
      ws.close();
    });
  });

  describe('连接管理', () => {
    it('应处理无效 JSON 而不断开连接', async () => {
      const { ws } = await connectWs(validToken);
      ws.send('not-valid-json');
      await new Promise((r) => setTimeout(r, 200));
      expect(ws.readyState).toBe(WebSocket.OPEN);
      ws.close();
    });
  });
});
