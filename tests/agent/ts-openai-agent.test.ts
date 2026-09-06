/**
 * Layer 4 测试：TypeScript SDK + OpenAI 模拟链路
 * 验证 SDK auto-instrument 能正确拦截 OpenAI 调用并上报 trace
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import nock from 'nock';
import { AgentMonitor } from '../../sdk/src/index.js';
import { autoInstrumentOpenAIInstance } from '../../sdk/src/auto-instrument.js';
import {
  initTestContext,
  getTraces,
  delay,
  type TestContext,
} from './helpers.js';

describe('Layer 4: SDK + OpenAI 模拟链路', () => {
  let ctx: TestContext;
  let monitor: AgentMonitor;

  beforeAll(async () => {
    ctx = await initTestContext();
  });

  afterAll(() => {
    monitor?.close();
    nock.cleanAll();
  });

  it('autoInstrument 拦截实例方法并上报成功 trace', async () => {
    monitor = new AgentMonitor({
      apiKey: ctx.apiKey,
      baseUrl: process.env.API_URL || 'http://localhost:3000',
      flushInterval: 999_999,
      bufferSize: 999_999,
    });

    // 模拟 OpenAI 响应
    nock('https://api.openai.com')
      .post('/v1/chat/completions')
      .reply(200, {
        id: 'chatcmpl-test-123',
        object: 'chat.completion',
        created: Date.now(),
        model: 'gpt-4',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: 'Hello from mocked OpenAI!' },
          finish_reason: 'stop',
        }],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 8,
          total_tokens: 18,
        },
      });

    // 模拟一个内部调用真实 OpenAI API 的对象
    const openai = {
      chat: {
        completions: {
          create: async (options: any) => {
            const res = await fetch('https://api.openai.com/v1/chat/completions', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer fake-key' },
              body: JSON.stringify(options),
            });
            return res.json();
          },
        },
      },
    };

    // Auto-instrument
    autoInstrumentOpenAIInstance(openai, monitor);

    // 调用
    const result = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hello, world!' }],
      temperature: 0.7,
    });

    // 验证原始方法仍然工作
    expect(result.choices[0].message.content).toBe('Hello from mocked OpenAI!');
    expect(result.usage.total_tokens).toBe(18);

    // 确保 nock 被调用
    expect(nock.isDone()).toBe(true);

    // 手动 flush trace
    await monitor.flush();
    await delay(500);

    // 查询后端验证 trace
    const traces = await getTraces(ctx.token, ctx.projectId);
    const llmTraces = traces.filter((t: any) => t.trace_type === 'llm');

    expect(llmTraces.length).toBeGreaterThanOrEqual(1);

    const trace = llmTraces[0];
    const input = typeof trace.input === 'string' ? JSON.parse(trace.input) : trace.input;
    const output = typeof trace.output === 'string' ? JSON.parse(trace.output) : trace.output;
    const metadata = typeof trace.metadata === 'string' ? JSON.parse(trace.metadata) : trace.metadata;

    expect(trace.name).toBe('gpt-4');
    expect(trace.status).toBe('success');
    expect(input).toMatchObject({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hello, world!' }],
      temperature: 0.7,
    });
    expect(output).toMatchObject({
      choices: [{ message: { content: 'Hello from mocked OpenAI!' } }],
    });
    expect(metadata).toMatchObject({
      model: 'gpt-4',
      usage: { total_tokens: 18 },
    });
    expect(trace.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it('autoInstrument 拦截失败调用并上报错误 trace', async () => {
    monitor = new AgentMonitor({
      apiKey: ctx.apiKey,
      baseUrl: process.env.API_URL || 'http://localhost:3000',
      flushInterval: 999_999,
      bufferSize: 999_999,
    });

    nock('https://api.openai.com')
      .post('/v1/chat/completions')
      .reply(429, {
        error: { message: 'Rate limit exceeded', type: 'rate_limit_error' },
      });

    const openai = {
      chat: {
        completions: {
          create: async (options: any) => {
            const res = await fetch('https://api.openai.com/v1/chat/completions', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer fake-key' },
              body: JSON.stringify(options),
            });
            if (!res.ok) {
              const err = await res.json();
              throw new Error(err.error?.message || `HTTP ${res.status}`);
            }
            return res.json();
          },
        },
      },
    };

    autoInstrumentOpenAIInstance(openai, monitor);

    await expect(
      openai.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Trigger error' }],
      })
    ).rejects.toThrow('Rate limit exceeded');

    expect(nock.isDone()).toBe(true);

    await monitor.flush();
    await delay(500);

    const traces = await getTraces(ctx.token, ctx.projectId);
    const errorTraces = traces.filter((t: any) => t.trace_type === 'llm' && t.status === 'error');

    expect(errorTraces.length).toBeGreaterThanOrEqual(1);
    expect(errorTraces[0].name).toBe('gpt-4');
    expect(errorTraces[0].error).toContain('Rate limit exceeded');

    // 验证错误 trace 的 input 也被正确记录
    const errInput = typeof errorTraces[0].input === 'string' ? JSON.parse(errorTraces[0].input) : errorTraces[0].input;
    expect(errInput.messages[0].content).toBe('Trigger error');
  });

  it('SDK 手动 traceLLM 上报完整数据', async () => {
    monitor = new AgentMonitor({
      apiKey: ctx.apiKey,
      baseUrl: process.env.API_URL || 'http://localhost:3000',
      flushInterval: 999_999,
      bufferSize: 999_999,
    });

    await monitor.traceLLM(
      'claude-3',
      { model: 'claude-3-opus', messages: [{ role: 'user', content: 'Test' }] },
      {
        choices: [{ message: { content: 'Response', role: 'assistant' } }],
        usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
      },
      250,
      true
    );

    await monitor.flush();
    await delay(500);

    const traces = await getTraces(ctx.token, ctx.projectId);
    const llmTraces = traces.filter((t: any) => t.trace_type === 'llm' && t.name === 'claude-3');

    expect(llmTraces.length).toBeGreaterThanOrEqual(1);
    expect(llmTraces[0].status).toBe('success');
    expect(llmTraces[0].latency_ms).toBe(250);
    const metadata = typeof llmTraces[0].metadata === 'string' ? JSON.parse(llmTraces[0].metadata) : llmTraces[0].metadata;
    expect(metadata).toMatchObject({ model: 'claude-3' });
  });
});
