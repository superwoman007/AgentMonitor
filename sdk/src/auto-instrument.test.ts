import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentMonitor } from './index.js';
import { autoInstrumentOpenAI, autoInstrumentOpenAIInstance } from './auto-instrument.js';

const globalAny = global as Record<string, unknown>;

const BASE_CONFIG = {
  apiKey: 'proj-1_test-key',
  flushInterval: 999_999_999,
  bufferSize: 999_999,
};

function okResponse() {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: async () => ({}),
  } as Response);
}

let monitor: AgentMonitor | null = null;

afterEach(() => {
  monitor?.close();
  monitor = null;
  vi.restoreAllMocks();
  delete globalAny.fetch;
});

describe('Auto-instrumentation', () => {
  beforeEach(() => {
    globalAny.fetch = vi.fn().mockResolvedValue(okResponse());
  });

  it('should intercept OpenAI instance chat.completions.create and send trace', async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      choices: [{ message: { content: 'Hello!' } }],
      usage: { total_tokens: 15, prompt_tokens: 5, completion_tokens: 10 },
    });

    const openai = {
      apiKey: 'test',
      chat: {
        completions: {
          create: mockCreate,
        },
      },
    };

    monitor = AgentMonitor.init(BASE_CONFIG);
    autoInstrumentOpenAIInstance(openai, monitor);

    const result = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hi' }],
    });

    // Original method should still work
    expect(result.choices[0].message.content).toBe('Hello!');
    expect(mockCreate).toHaveBeenCalledTimes(1);

    // Trace should have been sent
    await monitor.flush();
    const fetchCalls = (globalAny.fetch as ReturnType<typeof vi.fn>).mock.calls;
    const traceCalls = fetchCalls.filter((c: any) => c[0].includes('/traces'));
    expect(traceCalls.length).toBeGreaterThanOrEqual(1);

    const traceBody = JSON.parse(traceCalls[0][1].body);
    expect(traceBody.traceType).toBe('llm');
    expect(traceBody.name).toBe('gpt-4');
    expect(traceBody.input).toMatchObject({ model: 'gpt-4', messages: [{ role: 'user', content: 'Hi' }] });
    expect(traceBody.output).toMatchObject({ choices: [{ message: { content: 'Hello!' } }] });
    expect(traceBody.status).toBe('success');
    expect(traceBody.metadata).toMatchObject({ model: 'gpt-4', usage: { total_tokens: 15 } });
    expect(traceBody.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('should capture error traces when OpenAI call fails', async () => {
    const mockCreate = vi.fn().mockRejectedValue(new Error('Rate limit exceeded'));

    const openai = {
      chat: {
        completions: {
          create: mockCreate,
        },
      },
    };

    monitor = AgentMonitor.init(BASE_CONFIG);
    autoInstrumentOpenAIInstance(openai, monitor);

    await expect(
      openai.chat.completions.create({ model: 'gpt-4', messages: [{ role: 'user', content: 'Hi' }] })
    ).rejects.toThrow('Rate limit exceeded');

    await monitor.flush();
    const fetchCalls = (globalAny.fetch as ReturnType<typeof vi.fn>).mock.calls;
    const traceCalls = fetchCalls.filter((c: any) => c[0].includes('/traces'));
    expect(traceCalls.length).toBeGreaterThanOrEqual(1);

    const traceBody = JSON.parse(traceCalls[0][1].body);
    expect(traceBody.status).toBe('error');
    expect(traceBody.error).toContain('Rate limit exceeded');
  });

  it('should be callable via monitor.autoInstrument() with instance', async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      choices: [{ message: { content: 'OK' } }],
      usage: { total_tokens: 10 },
    });

    const openai = {
      chat: {
        completions: {
          create: mockCreate,
        },
      },
    };

    monitor = AgentMonitor.init(BASE_CONFIG);
    monitor.autoInstrument({ openAIInstance: openai });

    await openai.chat.completions.create({ model: 'gpt-3.5', messages: [] });

    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('should also work with class-based OpenAI using prototype patch', async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      choices: [{ message: { content: 'Proto!' } }],
      usage: { total_tokens: 8 },
    });

    // Class with method on prototype (like real OpenAI SDK)
    function OpenAILike(this: any, opts: { apiKey: string }) {
      this.apiKey = opts.apiKey;
    }
    (OpenAILike as any).prototype.chat = {
      completions: {
        create: mockCreate,
      },
    };

    monitor = AgentMonitor.init(BASE_CONFIG);
    autoInstrumentOpenAI(OpenAILike as any, monitor);

    const openai = new (OpenAILike as any)({ apiKey: 'test' });
    const result = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hi' }],
    });

    expect(result.choices[0].message.content).toBe('Proto!');
    await monitor.flush();

    const fetchCalls = (globalAny.fetch as ReturnType<typeof vi.fn>).mock.calls;
    const traceCalls = fetchCalls.filter((c: any) => c[0].includes('/traces'));
    expect(traceCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('should not break when OpenAI is not provided', async () => {
    monitor = AgentMonitor.init(BASE_CONFIG);
    // Should not throw
    expect(() => monitor!.autoInstrument({})).not.toThrow();
  });
});
