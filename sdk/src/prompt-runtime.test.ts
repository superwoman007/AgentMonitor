import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PromptRuntimeClient, type ResolvedPrompt } from './prompt-runtime.js';

const SAMPLE: ResolvedPrompt = {
  promptId: 'p-1',
  promptName: 'refund-agent',
  promptVersionId: 'v-1',
  versionNumber: 3,
  environment: 'production',
  content: 'You are a refund agent v3',
  variablesSchema: { type: 'object' },
  modelDefaults: { temperature: 0.2 },
  etag: '"pv-abc123"',
  deployedAt: '2026-08-26T00:00:00.000Z',
};

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...(init.headers as Record<string, string>) },
    ...init,
  });
}

function notModified(etag: string) {
  return new Response(null, { status: 304, headers: { ETag: etag } });
}

describe('PromptRuntimeClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeClient() {
    return new PromptRuntimeClient({
      baseUrl: 'https://api.example.com',
      apiKey: 'amt_test',
      projectId: 'proj-1',
      defaultMaxAgeMs: 1000,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
  }

  it('首次请求调用 GET /runtime/prompts 并写入缓存', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(SAMPLE, { headers: { ETag: SAMPLE.etag } }));
    const client = makeClient();

    const p = await client.get('refund-agent');
    expect(p.promptVersionId).toBe('v-1');
    expect(p.versionNumber).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('/api/v2/runtime/prompts/refund-agent');
    expect(url).toContain('projectId=proj-1');
    expect(url).toContain('environment=production');
  });

  it('TTL 内直接返回缓存，不发请求', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(SAMPLE));
    const client = makeClient();

    await client.get('refund-agent');
    await client.get('refund-agent');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('TTL 过期后带 If-None-Match 协商；304 时复用旧内容并刷新 TTL', async () => {
    vi.useFakeTimers();
    try {
      fetchMock
        .mockResolvedValueOnce(jsonResponse(SAMPLE, { headers: { ETag: SAMPLE.etag } }))
        .mockResolvedValueOnce(notModified(SAMPLE.etag));
      const client = makeClient();

      const first = await client.get('refund-agent');
      expect(first.promptVersionId).toBe('v-1');

      // 推进时钟超过 TTL
      vi.advanceTimersByTime(2000);

      const second = await client.get('refund-agent');
      expect(second.promptVersionId).toBe('v-1');
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const secondCallHeaders = fetchMock.mock.calls[1][1].headers as Record<string, string>;
      expect(secondCallHeaders['If-None-Match']).toBe(SAMPLE.etag);

      // 再次未过期则不发请求
      await client.get('refund-agent');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('200 响应覆盖旧缓存', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(SAMPLE, { headers: { ETag: SAMPLE.etag } }))
      .mockResolvedValueOnce(
        jsonResponse(
          { ...SAMPLE, promptVersionId: 'v-2', versionNumber: 4, content: 'v4 content', etag: '"pv-new"' },
          { headers: { ETag: '"pv-new"' } }
        )
      );
    const client = makeClient();

    const v1 = await client.get('refund-agent');
    // 强制刷新
    const v2 = await client.get('refund-agent', { forceRefresh: true });
    expect(v1.promptVersionId).toBe('v-1');
    expect(v2.promptVersionId).toBe('v-2');
    expect(v2.content).toBe('v4 content');
  });

  it('不同环境走不同缓存键', async () => {
    const stagingSample = { ...SAMPLE, environment: 'staging' as const, etag: '"etag-stg"' };
    fetchMock
      .mockResolvedValueOnce(jsonResponse(SAMPLE, { headers: { ETag: SAMPLE.etag } }))
      .mockResolvedValueOnce(jsonResponse(stagingSample, { headers: { ETag: stagingSample.etag } }));
    const client = makeClient();

    const prod = await client.get('refund-agent', { environment: 'production' });
    const stg = await client.get('refund-agent', { environment: 'staging' });
    expect(prod.environment).toBe('production');
    expect(stg.environment).toBe('staging');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(client.cacheSize).toBe(2);
  });

  it('非 2xx/304 抛错', async () => {
    fetchMock.mockResolvedValueOnce(new Response('not found', { status: 404 }));
    const client = makeClient();
    await expect(client.get('missing')).rejects.toThrow(/404/);
  });

  it('clearCache 清空所有条目', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(SAMPLE));
    const client = makeClient();
    await client.get('refund-agent');
    expect(client.cacheSize).toBe(1);
    client.clearCache();
    expect(client.cacheSize).toBe(0);
  });
});
