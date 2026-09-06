/**
 * PR-12 Prompt Runtime 客户端
 *
 * 对应后端 GET /api/v2/runtime/prompts/:name?environment= 接口。
 * - 内置 ETag/304 缓存，命中 304 时不反序列化 body
 * - 支持 maxAgeMs 硬 TTL，避免高频请求下重复打后端
 * - 缓存键：projectId + promptName + environment
 */

export interface ResolvedPrompt {
  promptId: string;
  promptName: string;
  promptVersionId: string;
  versionNumber: number;
  environment: string;
  content: string;
  variablesSchema: Record<string, unknown> | null;
  modelDefaults: Record<string, unknown> | null;
  etag: string;
  deployedAt: string;
}

export interface GetPromptOptions {
  /** 运行环境，默认 production */
  environment?: 'production' | 'staging' | 'development';
  /** 硬 TTL（毫秒），默认 60_000；在 TTL 内直接复用缓存，不发请求 */
  maxAgeMs?: number;
  /** 强制跳过缓存（仍会带 If-None-Match 走 304 协商） */
  forceRefresh?: boolean;
  /** AbortSignal，用于调用方主动取消 */
  signal?: AbortSignal;
}

interface CacheEntry {
  prompt: ResolvedPrompt;
  cachedAt: number;
}

export interface PromptRuntimeClientOptions {
  baseUrl: string;
  apiKey: string;
  projectId: string;
  /** 默认 TTL，毫秒 */
  defaultMaxAgeMs?: number;
  /** 自定义 fetch（主要用于测试） */
  fetchImpl?: typeof fetch;
}

/**
 * Prompt Runtime 客户端。线程安全（JS 单线程模型下 Map 操作原子）。
 */
export class PromptRuntimeClient {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly projectId: string;
  private readonly defaultMaxAgeMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: PromptRuntimeClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.apiKey = opts.apiKey;
    this.projectId = opts.projectId;
    this.defaultMaxAgeMs = opts.defaultMaxAgeMs ?? 60_000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /**
   * 构造缓存键。
   */
  private cacheKey(promptName: string, environment: string): string {
    return `${this.projectId}::${environment}::${promptName}`;
  }

  /**
   * 按名称解析一个已发布的 Prompt。
   *
   * 行为：
   * 1. 若有未过期缓存且未 forceRefresh，直接返回缓存
   * 2. 否则发请求，带 If-None-Match；命中 304 时延长缓存寿命
   * 3. 200 时写入新缓存
   *
   * @param promptName - Prompt 名称
   * @param options - 可选环境/TTL/强制刷新/AbortSignal
   * @returns ResolvedPrompt，未发布时抛 404 错误
   */
  async get(promptName: string, options: GetPromptOptions = {}): Promise<ResolvedPrompt> {
    const environment = options.environment ?? 'production';
    const maxAgeMs = options.maxAgeMs ?? this.defaultMaxAgeMs;
    const key = this.cacheKey(promptName, environment);
    const existing = this.cache.get(key);
    const now = Date.now();

    if (!options.forceRefresh && existing && now - existing.cachedAt < maxAgeMs) {
      return existing.prompt;
    }

    const query = new URLSearchParams({ projectId: this.projectId, environment });
    const url = `${this.baseUrl}/api/v2/runtime/prompts/${encodeURIComponent(promptName)}?${query.toString()}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
    };
    if (existing) {
      headers['If-None-Match'] = existing.prompt.etag;
    }

    const res = await this.fetchImpl(url, { method: 'GET', headers, signal: options.signal });

    if (res.status === 304 && existing) {
      // 延长 TTL，复用旧内容
      this.cache.set(key, { prompt: existing.prompt, cachedAt: now });
      return existing.prompt;
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Prompt runtime ${res.status}: ${body || res.statusText}`);
    }

    const data = (await res.json()) as ResolvedPrompt;
    this.cache.set(key, { prompt: data, cachedAt: now });
    return data;
  }

  /**
   * 清空全部缓存（测试 / 紧急切换环境时使用）。
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * 当前缓存条目数（可观测性）。
   */
  get cacheSize(): number {
    return this.cache.size;
  }
}
