import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http, { type IncomingMessage, type Server } from 'http';
import { AddressInfo } from 'net';
import { AgentTargetVersion } from '../src/services/agent-target.js';
import { invokeTarget } from '../src/services/target-adapter.js';

function createVersion(config: Record<string, unknown>): AgentTargetVersion {
  return {
    id: 'version-test',
    target_id: 'target-test',
    version_number: 1,
    target_type: 'http_agent',
    invocation_config: config,
    input_mapping: null,
    output_mapping: null,
    source_revision: null,
    created_by: null,
    created_at: new Date(),
  };
}

interface MockServerHandle {
  url: string;
  close: () => Promise<void>;
}

function startMockServer(
  handler: (req: IncomingMessage, body: string) => Promise<{ status?: number; payload: unknown }>
): Promise<MockServerHandle> {
  return new Promise((resolve, reject) => {
    const server: Server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', async () => {
        const raw = Buffer.concat(chunks).toString('utf-8');
        try {
          const result = await handler(req, raw);
          res.writeHead(result.status ?? 200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result.payload));
        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: String(error) }));
        }
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
    server.on('error', reject);
  });
}

describe('Target Adapter (PR-06): http_agent', () => {
  let server: MockServerHandle;
  const received: { headers: Record<string, string | string[] | undefined>; body: unknown } = { headers: {}, body: null };

  beforeAll(async () => {
    server = await startMockServer(async (req, body) => {
      received.headers = req.headers as Record<string, string | string[] | undefined>;
      received.body = body ? JSON.parse(body) : null;
      return {
        payload: {
          status: 'success',
          output: { answer: 'agent reply', trace_id: 'agent-trace-xyz' },
          usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 },
        },
      };
    });
  });

  afterAll(async () => {
    await server.close();
  });

  it('发送标准协议信封，携带 X-AgentMonitor-Run-Id 等关联头', async () => {
    const version = createVersion({
      url: server.url,
      outputPath: '/output/answer',
      traceIdPath: '/output/trace_id',
      usagePath: '/usage',
    });

    const result = await invokeTarget(version, 'hello agent', {
      runId: 'run-123',
      runItemId: 'item-456',
      experimentId: 'exp-789',
    });

    expect(result.error).toBeUndefined();
    expect(result.output).toBe('agent reply');
    expect(result.traceId).toBe('agent-trace-xyz');
    expect(result.tokenUsage).toEqual({ promptTokens: 7, completionTokens: 3, totalTokens: 10 });

    const sentBody = received.body as Record<string, unknown>;
    expect(sentBody.protocolVersion).toBe('1.0');
    expect((sentBody.run as Record<string, unknown>).id).toBe('run-123');
    expect((sentBody.run as Record<string, unknown>).experimentId).toBe('exp-789');

    expect(received.headers['x-agentmonitor-run-id']).toBe('run-123');
    expect(received.headers['x-agentmonitor-run-item-id']).toBe('item-456');
    expect(received.headers['x-agentmonitor-request-id']).toBeTruthy();
  });

  it('支持 bearer 鉴权与自定义请求头', async () => {
    const version = createVersion({
      url: server.url,
      outputPath: '/output/answer',
      authentication: { type: 'bearer', secretRef: 'secret-token' },
      headers: { 'X-Custom-Header': 'custom-value' },
    });

    const result = await invokeTarget(version, 'auth check');
    expect(result.error).toBeUndefined();
    expect(received.headers['authorization']).toBe('Bearer secret-token');
    expect(received.headers['x-custom-header']).toBe('custom-value');
  });

  it('支持 api_key 鉴权（自定义 headerName）', async () => {
    const version = createVersion({
      url: server.url,
      outputPath: '/output/answer',
      authentication: { type: 'api_key', secretRef: 'abc123', headerName: 'X-My-Key' },
    });

    const result = await invokeTarget(version, 'apikey check');
    expect(result.error).toBeUndefined();
    expect(received.headers['x-my-key']).toBe('abc123');
  });

  it('请求模板中的白名单变量 {{sample.input}} 会被渲染，禁止任意 JS 表达式', async () => {
    const version = createVersion({
      url: server.url,
      outputPath: '/output/answer',
      requestTemplate: {
        message: '{{sample.input}}',
        run_id: '{{run.id}}',
        nested: { trace: '{{context.traceId}}' },
      },
    });

    const result = await invokeTarget(version, 'render-me', { runId: 'run-tpl', traceId: 'trace-tpl' });
    expect(result.error).toBeUndefined();
    const sentBody = received.body as Record<string, unknown>;
    expect(sentBody.message).toBe('render-me');
    expect(sentBody.run_id).toBe('run-tpl');
    expect((sentBody.nested as Record<string, unknown>).trace).toBe('trace-tpl');
  });

  it('Agent 返回 status=error 时被正确标记为错误', async () => {
    const errorServer = await startMockServer(async () => ({
      payload: { status: 'error', error: { message: 'agent failed internally' } },
    }));
    try {
      const version = createVersion({ url: errorServer.url });
      const result = await invokeTarget(version, 'trigger error');
      expect(result.output).toBe('');
      expect(result.error).toContain('agent failed internally');
    } finally {
      await errorServer.close();
    }
  });

  it('HTTP 非 2xx 响应被标记为错误并返回错误信息', async () => {
    const failServer = await startMockServer(async () => ({
      status: 503,
      payload: { error: 'service unavailable' },
    }));
    try {
      const version = createVersion({ url: failServer.url });
      const result = await invokeTarget(version, 'boom');
      expect(result.output).toBe('');
      expect(result.error).toContain('service unavailable');
    } finally {
      await failServer.close();
    }
  });

  it('超时配置触发 AbortController 并返回超时错误', async () => {
    const slowServer = await startMockServer(
      () => new Promise((resolve) => setTimeout(() => resolve({ payload: { ok: true } }), 300))
    );
    try {
      const version = createVersion({ url: slowServer.url, timeoutMs: 50 });
      const result = await invokeTarget(version, 'wait');
      expect(result.output).toBe('');
      expect(result.error).toMatch(/aborted|timeout|fetch failed/i);
    } finally {
      await slowServer.close();
    }
  });

  it('outputPath 缺失时回退使用整个响应体', async () => {
    const simpleServer = await startMockServer(async () => ({
      payload: { plain: 'text-response' },
    }));
    try {
      const version = createVersion({ url: simpleServer.url });
      const result = await invokeTarget(version, 'no pointer');
      expect(result.error).toBeUndefined();
      const parsed = JSON.parse(result.output);
      expect(parsed.plain).toBe('text-response');
    } finally {
      await simpleServer.close();
    }
  });
});
