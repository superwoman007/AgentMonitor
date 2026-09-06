/**
 * 极简 AgentMonitor HTTP API 客户端（浏览器 fetch 兼容，Node 18+ 内置）。
 */

export interface ApiClientOptions {
  baseUrl: string;
  token: string;
}

export interface ApiError extends Error {
  status: number;
  body: unknown;
}

export class ApiClient {
  readonly baseUrl: string;
  readonly token: string;
  constructor(opts: ApiClientOptions) {
    this.baseUrl = opts.baseUrl;
    this.token = opts.token;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    if (!res.ok) {
      const err = new Error(
        typeof parsed === 'object' && parsed && 'error' in parsed
          ? String((parsed as { error: unknown }).error)
          : `HTTP ${res.status}`
      ) as ApiError;
      err.status = res.status;
      err.body = parsed;
      throw err;
    }
    return parsed as T;
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }
  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }
}

/**
 * 平台 Run 状态（与后端枚举对齐）。
 */
export type RunStatus = 'queued' | 'running' | 'cancelling' | 'completed' | 'failed' | 'cancelled';

export interface RunSummary {
  totalItems: number;
  completedItems: number;
  passedItems: number;
  failedItems: number;
  skippedItems?: number;
  avgScore: number | null;
  avgLatencyMs: number | null;
  totalTokens?: number;
}

export interface Run {
  id: string;
  experiment_id: string;
  status: RunStatus;
  run_number: number;
  summary: RunSummary | null;
  gate_result?: { passed: boolean; passRate: number } | null;
  created_at: string;
  completed_at: string | null;
}
