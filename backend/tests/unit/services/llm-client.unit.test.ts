import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { callLLM } from '../../../src/services/llm-client.js';

describe('callLLM baseUrl 处理', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: 'test' } }],
        usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
      }),
    } as Response);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it('标准 OpenAI URL 不应追加 /v1', async () => {
    await callLLM({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1',
    });

    const fetchCall = vi.mocked(global.fetch).mock.calls[0];
    expect(fetchCall[0]).toBe('https://api.openai.com/v1/chat/completions');
  });

  it('无版本路径的 URL 应自动追加 /v1', async () => {
    await callLLM({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'sk-test',
      baseUrl: 'https://custom.api.com',
    });

    const fetchCall = vi.mocked(global.fetch).mock.calls[0];
    expect(fetchCall[0]).toBe('https://custom.api.com/v1/chat/completions');
  });

  it('DeepSeek URL (无版本路径) 应追加 /v1', async () => {
    await callLLM({
      model: 'deepseek-v4-pro',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'sk-test',
      baseUrl: 'https://api.deepseek.com',
    });

    const fetchCall = vi.mocked(global.fetch).mock.calls[0];
    expect(fetchCall[0]).toBe('https://api.deepseek.com/v1/chat/completions');
  });

  it('Kimi URL 不应追加 /v1（已包含 /v1）', async () => {
    await callLLM({
      model: 'kimi-k2.6',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'sk-test',
      baseUrl: 'https://api.moonshot.ai/v1',
    });

    const fetchCall = vi.mocked(global.fetch).mock.calls[0];
    expect(fetchCall[0]).toBe('https://api.moonshot.ai/v1/chat/completions');
  });

  it('GLM URL (含 /v4) 不应追加 /v1', async () => {
    await callLLM({
      model: 'glm-4.7',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'sk-test',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    });

    const fetchCall = vi.mocked(global.fetch).mock.calls[0];
    expect(fetchCall[0]).toBe('https://open.bigmodel.cn/api/paas/v4/chat/completions');
  });

  it('豆包 URL (含 /v3) 不应追加 /v1', async () => {
    await callLLM({
      model: 'doubao-pro-32k',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'sk-test',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    });

    const fetchCall = vi.mocked(global.fetch).mock.calls[0];
    expect(fetchCall[0]).toBe('https://ark.cn-beijing.volces.com/api/v3/chat/completions');
  });

  it('MiMo URL (含 /v1) 不应追加 /v1', async () => {
    await callLLM({
      model: 'mimo-v2-flash',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'sk-test',
      baseUrl: 'https://api.xiaomimimo.com/v1',
    });

    const fetchCall = vi.mocked(global.fetch).mock.calls[0];
    expect(fetchCall[0]).toBe('https://api.xiaomimimo.com/v1/chat/completions');
  });

  it('MiMo 应使用 api-key header 而非 Authorization Bearer', async () => {
    await callLLM({
      model: 'mimo-v2-flash',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'mimo-secret-key',
      baseUrl: 'https://api.xiaomimimo.com/v1',
    });

    const fetchCall = vi.mocked(global.fetch).mock.calls[0];
    const headers = (fetchCall[1] as RequestInit).headers as Record<string, string>;
    expect(headers['api-key']).toBe('mimo-secret-key');
    expect(headers['Authorization']).toBeUndefined();
  });

  it('非 MiMo 供应商应使用 Authorization Bearer', async () => {
    await callLLM({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1',
    });

    const fetchCall = vi.mocked(global.fetch).mock.calls[0];
    const headers = (fetchCall[1] as RequestInit).headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer sk-test');
    expect(headers['api-key']).toBeUndefined();
  });
});
