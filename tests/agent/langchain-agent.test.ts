/**
 * Layer 4 测试：LangChain 模拟集成
 * 验证 SDK 能与 LangChain-like 对象协同工作并正确上报 trace
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import nock from 'nock';
import { AgentMonitor } from '../../sdk/src/index.js';
import { autoInstrumentOpenAI } from '../../sdk/src/auto-instrument.js';
import {
  initTestContext,
  getTraces,
  delay,
  type TestContext,
} from './helpers.js';

describe('Layer 4: LangChain-like 模拟集成', () => {
  let ctx: TestContext;
  let monitor: AgentMonitor;

  beforeAll(async () => {
    ctx = await initTestContext();
  });

  afterEach(() => {
    monitor?.close();
    nock.cleanAll();
  });

  afterAll(() => {
    monitor?.close();
    nock.cleanAll();
  });

  it('LangChain-like chain trace: fake LLMChain calls traceLLM and trace is recorded', async () => {
    monitor = new AgentMonitor({
      apiKey: ctx.apiKey,
      baseUrl: 'http://localhost:3000',
      flushInterval: 999_999,
      bufferSize: 999_999,
    });

    class FakeLLMChain {
      async run(input: string): Promise<string> {
        const response = `Chain result for: ${input}`;
        await monitor.traceLLM(
          'fake-llm-model',
          {
            model: 'fake-llm-model',
            messages: [{ role: 'user', content: input }],
          },
          {
            choices: [{ message: { role: 'assistant', content: response } }],
            usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
          },
          60,
          true
        );
        return response;
      }
    }

    const chain = new FakeLLMChain();
    const result = await chain.run('hello chain');
    expect(result).toBe('Chain result for: hello chain');

    await monitor.flush();
    await delay(500);

    const traces = await getTraces(ctx.token, ctx.projectId);
    const llmTraces = traces.filter((t: any) => t.trace_type === 'llm');
    expect(llmTraces.length).toBeGreaterThanOrEqual(1);

    const trace = llmTraces.find((t: any) => t.name === 'fake-llm-model');
    expect(trace).toBeDefined();
    expect(trace.status).toBe('success');

    const input = typeof trace.input === 'string' ? JSON.parse(trace.input) : trace.input;
    const metadata = typeof trace.metadata === 'string' ? JSON.parse(trace.metadata) : trace.metadata;

    expect(input).toMatchObject({
      model: 'fake-llm-model',
      messages: [{ role: 'user', content: 'hello chain' }],
    });
    expect(metadata).toMatchObject({
      model: 'fake-llm-model',
      usage: { total_tokens: 10 },
    });
    expect(trace.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it('LangChain-like agent with tool calls: fake AgentExecutor uses wrap for tools and traceLLM for LLM', async () => {
    monitor = new AgentMonitor({
      apiKey: ctx.apiKey,
      baseUrl: 'http://localhost:3000',
      flushInterval: 999_999,
      bufferSize: 999_999,
    });

    const searchTool = async (query: string) => `Search results for ${query}`;
    const wrappedSearch = monitor.wrap(searchTool, { name: 'search_tool' });

    class FakeAgentExecutor {
      async run(input: string): Promise<string> {
        // Tool call via wrap (produces function trace)
        const toolResult = await wrappedSearch(input);

        // Also explicitly track as tool_call trace for structured tool logging
        await monitor.trackToolCall({
          toolName: 'search_tool',
          inputParams: { query: input },
          output: toolResult,
          latencyMs: 25,
        });

        // LLM call
        const llmResponse = `Agent answer using: ${toolResult}`;
        await monitor.traceLLM(
          'agent-llm',
          {
            model: 'agent-llm',
            messages: [
              { role: 'user', content: input },
              { role: 'system', content: `Tool result: ${toolResult}` },
            ],
          },
          {
            choices: [{ message: { role: 'assistant', content: llmResponse } }],
            usage: { prompt_tokens: 8, completion_tokens: 6, total_tokens: 14 },
          },
          90,
          true
        );

        return llmResponse;
      }
    }

    const agent = new FakeAgentExecutor();
    const result = await agent.run('weather in tokyo');
    expect(result).toBe('Agent answer using: Search results for weather in tokyo');

    await monitor.flush();
    await delay(500);

    const traces = await getTraces(ctx.token, ctx.projectId);

    // Verify tool_call traces exist
    const toolCallTraces = traces.filter((t: any) => t.trace_type === 'tool_call');
    expect(toolCallTraces.length).toBeGreaterThanOrEqual(1);
    const toolTrace = toolCallTraces.find((t: any) => t.name === 'search_tool');
    expect(toolTrace).toBeDefined();
    expect(toolTrace.status).toBe('success');

    const toolInput = typeof toolTrace.input === 'string' ? JSON.parse(toolTrace.input) : toolTrace.input;
    expect(toolInput).toMatchObject({ query: 'weather in tokyo' });

    // Verify llm traces exist
    const llmTraces = traces.filter((t: any) => t.trace_type === 'llm');
    expect(llmTraces.length).toBeGreaterThanOrEqual(1);
    const llmTrace = llmTraces.find((t: any) => t.name === 'agent-llm');
    expect(llmTrace).toBeDefined();
    expect(llmTrace.status).toBe('success');

    const llmInput = typeof llmTrace.input === 'string' ? JSON.parse(llmTrace.input) : llmTrace.input;
    const llmMetadata = typeof llmTrace.metadata === 'string' ? JSON.parse(llmTrace.metadata) : llmTrace.metadata;
    expect(llmInput.messages[0].content).toBe('weather in tokyo');
    expect(llmMetadata.model).toBe('agent-llm');

    // Verify wrap-generated function trace also exists
    const functionTraces = traces.filter((t: any) => t.trace_type === 'function');
    expect(functionTraces.length).toBeGreaterThanOrEqual(1);
    const funcTrace = functionTraces.find((t: any) => t.name === 'search_tool');
    expect(funcTrace).toBeDefined();
    expect(funcTrace.status).toBe('success');
  });

  it('Auto-instrument with fake OpenAI class: autoInstrumentOpenAI patches prototype, instance call captures trace', async () => {
    monitor = new AgentMonitor({
      apiKey: ctx.apiKey,
      baseUrl: 'http://localhost:3000',
      flushInterval: 999_999,
      bufferSize: 999_999,
    });

    nock('https://api.openai.com')
      .post('/v1/chat/completions')
      .reply(200, {
        id: 'chatcmpl-class-789',
        object: 'chat.completion',
        created: Date.now(),
        model: 'gpt-3.5-turbo',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Class-based mock response' },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 4,
          completion_tokens: 4,
          total_tokens: 8,
        },
      });

    class FakeOpenAI {
      apiKey: string;
      constructor(apiKey: string) {
        this.apiKey = apiKey;
      }
    }

    (FakeOpenAI.prototype as any).chat = {
      completions: {
        create: async function (options: any) {
          const res = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer fake-class-key',
            },
            body: JSON.stringify(options),
          });
          return res.json();
        },
      },
    };

    // Patch the class itself (strategy 1: prototype patching)
    autoInstrumentOpenAI(FakeOpenAI, monitor);

    const client = new FakeOpenAI('fake-key');
    const result = await client.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: 'Class test input' }],
      temperature: 0.5,
    });

    expect(result.choices[0].message.content).toBe('Class-based mock response');
    expect(result.usage.total_tokens).toBe(8);
    expect(nock.isDone()).toBe(true);

    await monitor.flush();
    await delay(500);

    const traces = await getTraces(ctx.token, ctx.projectId);
    const llmTraces = traces.filter((t: any) => t.trace_type === 'llm' && t.name === 'gpt-3.5-turbo');
    expect(llmTraces.length).toBeGreaterThanOrEqual(1);

    const trace = llmTraces[0];
    expect(trace.status).toBe('success');

    const input = typeof trace.input === 'string' ? JSON.parse(trace.input) : trace.input;
    const metadata = typeof trace.metadata === 'string' ? JSON.parse(trace.metadata) : trace.metadata;

    expect(input).toMatchObject({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: 'Class test input' }],
      temperature: 0.5,
    });
    expect(metadata).toMatchObject({
      model: 'gpt-3.5-turbo',
      usage: { total_tokens: 8 },
    });
    expect(trace.latency_ms).toBeGreaterThanOrEqual(0);
  });
});
