const API_BASE = '/api/v1';

const storage = (() => {
  const memory = new Map<string, string>();
  return {
    getItem: (key: string) => {
      try {
        return localStorage.getItem(key);
      } catch {
        return memory.get(key) ?? null;
      }
    },
    setItem: (key: string, value: string) => {
      try {
        localStorage.setItem(key, value);
      } catch {
        memory.set(key, value);
      }
    },
    removeItem: (key: string) => {
      try {
        localStorage.removeItem(key);
      } catch {
        memory.delete(key);
      }
    },
  };
})();

class ApiClient {
  private getToken(): string | null {
    return storage.getItem('token');
  }

  private setToken(token: string | null): void {
    if (token) {
      storage.setItem('token', token);
    } else {
      storage.removeItem('token');
    }
  }

  private async request<T>(
    path: string,
    options: RequestInit = {}
  ): Promise<T> {
    const token = this.getToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
    });

    if (response.status === 401) {
      this.setToken(null);
      window.location.href = '/login';
      throw new Error('Unauthorized');
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    if (response.status === 204) {
      return {} as T;
    }

    return response.json();
  }

  setAuthToken(token: string): void {
    this.setToken(token);
  }

  clearAuthToken(): void {
    this.setToken(null);
  }

  isAuthenticated(): boolean {
    return !!this.getToken();
  }

  auth = {
    register: (data: { email: string; password: string; name?: string }) =>
      this.request<{ token: string; user: User }>('/auth/register', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    login: (data: { email: string; password: string }) =>
      this.request<{ token: string; user: User }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    me: async () => {
      const res = await this.request<User | { user: User }>('/auth/me');
      return 'user' in (res as any) ? (res as any).user : (res as User);
    },
  };

  projects = {
    list: (params?: { limit?: number; offset?: number }) => {
      const query = new URLSearchParams();
      if (params?.limit) query.set('limit', String(params.limit));
      if (params?.offset) query.set('offset', String(params.offset));
      const qs = query.toString();
      return this.request<Project[] | { projects: Project[] }>(`/projects${qs ? `?${qs}` : ''}`).then((res) => {
        if (Array.isArray(res)) return { projects: res };
        return res;
      });
    },

    get: (id: string) =>
      this.request<Project | { project: Project }>(`/projects/${id}`).then((res) => {
        if (res && typeof res === 'object' && 'project' in (res as any)) return res as { project: Project };
        return { project: res as Project };
      }),

    create: (data: { name: string; description?: string }) =>
      this.request<Project | { project: Project }>('/projects', {
        method: 'POST',
        body: JSON.stringify(data),
      }).then((res) => {
        if (res && typeof res === 'object' && 'project' in (res as any)) return res as { project: Project };
        return { project: res as Project };
      }),

    update: (id: string, data: { name?: string; description?: string }) =>
      this.request<Project | { project: Project }>(`/projects/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }).then((res) => {
        if (res && typeof res === 'object' && 'project' in (res as any)) return res as { project: Project };
        return { project: res as Project };
      }),

    delete: (id: string) =>
      this.request<void>(`/projects/${id}`, { method: 'DELETE' }),
  };

  apiKeys = {
    list: (projectId: string) =>
      this.request<ApiKey[] | { apiKeys: ApiKey[] }>(`/apikeys?project_id=${projectId}`).then((res) => {
        if (Array.isArray(res)) return { apiKeys: res };
        return res;
      }),

    create: (data: { projectId: string; name: string }) =>
      this.request<(ApiKey & { plain_key?: string }) | { apiKey: ApiKey & { plain_key?: string } }>('/apikeys', {
        method: 'POST',
        body: JSON.stringify({ project_id: data.projectId, name: data.name }),
      }).then((res) => {
        if (res && typeof res === 'object' && 'apiKey' in (res as any)) return res as { apiKey: ApiKey & { plain_key?: string } };
        return { apiKey: res as ApiKey & { plain_key?: string } };
      }),

    delete: (id: string, _projectId?: string) =>
      this.request<void>(`/apikeys/${id}`, { method: 'DELETE' }),

    getSecret: (id: string, projectId: string) =>
      this.request<{ key?: string; secret?: string }>(`/apikeys/${id}/secret?project_id=${projectId}`).then((res) => ({
        secret: res.secret ?? res.key ?? '',
      })),
  };

  traces = {
    list: (projectId: string, params?: { sessionId?: string; limit?: number; offset?: number }) => {
      const query = new URLSearchParams({ projectId });
      if (params?.sessionId) query.set('sessionId', params.sessionId);
      if (params?.limit) query.set('limit', String(params.limit));
      if (params?.offset) query.set('offset', String(params.offset));
      return this.request<{ traces: Trace[] }>(`/traces?${query.toString()}`);
    },

    get: (id: string) => this.request<{ trace: Trace }>(`/traces/${id}`),
  };

  sessions = {
    list: (projectId: string, params?: { status?: string; limit?: number; offset?: number }) => {
      const query = new URLSearchParams({ projectId });
      if (params?.status) query.set('status', params.status);
      if (params?.limit) query.set('limit', String(params.limit));
      if (params?.offset) query.set('offset', String(params.offset));
      return this.request<{ sessions: Session[] }>(`/sessions/list?${query.toString()}`);
    },

    get: (id: string) => this.request<{ session: Session }>(`/sessions/detail/${id}`),

    create: (projectId: string, data?: { id?: string; agentId?: string; metadata?: unknown }) =>
      this.request<{ session: Session }>('/sessions', {
        method: 'POST',
        body: JSON.stringify({ projectId, ...data }),
      }),

    end: (id: string) =>
      this.request<{ session: Session }>(`/sessions/end/${id}`, { method: 'PUT' }),

    messages: {
      list: (sessionId: string, params?: { limit?: number; offset?: number }) => {
        const query = new URLSearchParams();
        if (params?.limit) query.set('limit', String(params.limit));
        if (params?.offset) query.set('offset', String(params.offset));
        const qs = query.toString();
        return this.request<{ messages: Message[] }>(`/sessions/messages/${sessionId}${qs ? `?${qs}` : ''}`);
      },

      add: (sessionId: string, data: { role: string; content: string; metadata?: unknown }) =>
        this.request<{ message: Message }>(`/sessions/${sessionId}/messages`, {
          method: 'POST',
          body: JSON.stringify(data),
        }),
    },
  };

  stats = {
    get: (projectId?: string) => {
      const query = projectId ? `?projectId=${projectId}` : '';
      return this.request<{ stats: Stats }>(`/stats${query}`);
    },
  };

  alerts = {
    list: (projectId: string) =>
      this.request<{ alerts: Alert[]; history: AlertHistory[] }>(`/alerts?projectId=${projectId}`),

    create: (projectId: string, data: { name: string; type: Alert['type']; condition: string; threshold: number; enabled: boolean }) =>
      this.request<{ alert: Alert }>('/alerts', {
        method: 'POST',
        body: JSON.stringify({ projectId, ...data }),
      }),

    update: (id: string, data: Partial<{ name: string; type: Alert['type']; condition: string; threshold: number; enabled: boolean }>) =>
      this.request<{ alert: Alert }>(`/alerts/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),

    delete: (id: string) =>
      this.request<void>(`/alerts/${id}`, { method: 'DELETE' }),

    check: (projectId: string) =>
      this.request<{ triggered: AlertHistory[] }>('/alerts/check', {
        method: 'POST',
        body: JSON.stringify({ projectId }),
      }),

    ignoreHistory: (historyId: string, minutes: number) =>
      this.request<{ mutedUntil: string }>(`/alerts/history/${historyId}/ignore`, {
        method: 'POST',
        body: JSON.stringify({ minutes }),
      }),
  };

  breakpoints = {
    list: (projectId: string) =>
      this.request<{ breakpoints: Breakpoint[] }>(`/breakpoints?projectId=${projectId}`),

    get: (id: string) =>
      this.request<{ breakpoint: Breakpoint }>(`/breakpoints/${id}`),

    create: (projectId: string, data: {
      name: string;
      type: 'keyword' | 'error' | 'latency' | 'custom';
      condition: string;
      enabled?: boolean;
    }) =>
      this.request<{ breakpoint: Breakpoint }>('/breakpoints', {
        method: 'POST',
        body: JSON.stringify({ projectId, ...data }),
      }),

    update: (id: string, data: {
      name?: string;
      type?: 'keyword' | 'error' | 'latency' | 'custom';
      condition?: string;
      enabled?: boolean;
    }) =>
      this.request<{ breakpoint: Breakpoint }>(`/breakpoints/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),

    delete: (id: string) =>
      this.request<void>(`/breakpoints/${id}`, { method: 'DELETE' }),

    toggle: (id: string) =>
      this.request<{ breakpoint: Breakpoint }>(`/breakpoints/${id}/toggle`, { method: 'POST' }),
  };

  snapshots = {
    list: (params: { sessionId?: string; breakpointId?: string; projectId?: string }) => {
      const query = new URLSearchParams();
      if (params.sessionId) query.set('sessionId', params.sessionId);
      if (params.breakpointId) query.set('breakpointId', params.breakpointId);
      if (params.projectId) query.set('projectId', params.projectId);
      return this.request<{ snapshots: Snapshot[] }>(`/snapshots?${query.toString()}`);
    },

    get: (id: string) =>
      this.request<{ snapshot: Snapshot }>(`/snapshots/${id}`),

    count: (sessionId: string) =>
      this.request<{ count: number }>(`/snapshots/count/${sessionId}`),
  };

  quality = {
    score: (projectId: string) =>
      this.request<{ score: QualityScore }>(`/quality/score?projectId=${projectId}`),

    trend: (projectId: string, days: number = 7) =>
      this.request<{ trend: QualityTrendPoint[] }>(`/quality/trend?projectId=${projectId}&days=${days}`),
  };

  cost = {
    summary: (projectId: string, days: number = 7) =>
      this.request<{ summary: CostSummary; trend: CostTrendPoint[] }>(`/cost/summary?projectId=${projectId}&days=${days}`),

    byModel: (projectId: string) =>
      this.request<{ byModel: CostByModel[] }>(`/cost/by-model?projectId=${projectId}`),

    top: (projectId: string, limit: number = 10) =>
      this.request<{ top: ExpensiveCall[] }>(`/cost/top?projectId=${projectId}&limit=${limit}`),

    suggestions: (projectId: string) =>
      this.request<{ suggestions: CostSuggestion[] }>(`/cost/suggestions?projectId=${projectId}`),
  };
}

export interface User {
  id: string;
  email: string;
  name?: string;
  created_at: string;
}

export interface Project {
  id: string;
  user_id: string;
  name: string;
  description?: string;
  created_at: string;
  updated_at: string;
}

export interface ApiKey {
  id: string;
  project_id: string;
  name: string;
  key_prefix: string;
  is_active: boolean;
  created_at: string;
  revoked_at?: string;
  key?: string;
}

export interface Trace {
  id: string;
  project_id: string;
  session_id?: string;
  agent_id?: string;
  trace_type: string;
  name: string;
  input?: unknown;
  output?: unknown;
  metadata?: unknown;
  started_at: string;
  ended_at?: string;
  latency_ms?: number;
  status: string;
  error?: string;
  created_at: string;
}

export interface Session {
  id: string;
  project_id: string;
  agent_id?: string;
  started_at: string;
  ended_at?: string;
  status: string;
  metadata?: unknown;
  created_at: string;
}

export interface Message {
  id: string;
  session_id: string;
  role: string;
  content: string;
  timestamp: string;
  metadata?: unknown;
}

export interface Stats {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  successRate: number;
  avgLatency: number;
  totalTokens: number;
  activeSessions: number;
  todayTraces: number;
}

export interface Breakpoint {
  id: string;
  project_id: string;
  name: string;
  type: 'keyword' | 'error' | 'latency' | 'custom';
  condition: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface Snapshot {
  id: string;
  session_id: string;
  breakpoint_id: string | null;
  trigger_reason: string;
  state: SnapshotState;
  timestamp: string;
  created_at: string;
}

export interface SnapshotState {
  messages?: Array<{
    role: string;
    content: string;
    timestamp: string;
  }>;
  variables?: Record<string, unknown>;
  toolCalls?: Array<{
    toolName: string;
    input: unknown;
    output?: unknown;
    error?: string;
  }>;
  metadata?: Record<string, unknown>;
  stackTrace?: string[];
  error?: {
    message: string;
    code?: string;
  };
}

export interface QualityScore {
  score: number;
  speedScore: number;
  successScore: number;
  totalTraces: number;
}

export interface QualityTrendPoint {
  date: string;
  score: number;
  speedScore: number;
  successScore: number;
  count: number;
}

export interface CostSummary {
  today: number;
  week: number;
  month: number;
  total: number;
}

export interface CostTrendPoint {
  date: string;
  cost: number;
  count: number;
}

export interface CostByModel {
  model: string;
  count: number;
  totalCost: number;
  inputCost: number;
  outputCost: number;
  inputTokens: number;
  outputTokens: number;
}

export interface ExpensiveCall {
  id: string;
  name: string;
  model: string;
  cost: number;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  startedAt: string;
}

export interface CostSuggestion {
  type: 'downgrade' | 'cache' | 'batch' | 'optimize';
  message: string;
  potentialSaving: number;
}

export interface Alert {
  id: string;
  projectId: string;
  name: string;
  type: 'latency' | 'error_rate' | 'cost' | 'custom';
  condition: string;
  threshold: number;
  enabled: boolean;
  lastTriggered: string | null;
  createdAt: string;
}

export interface AlertHistory {
  id: string;
  alertId: string;
  projectId: string;
  alertName?: string;
  alertType?: Alert['type'];
  threshold?: number;
  actual?: number | null;
  metrics?: {
    avgLatency?: number;
    errorRate?: number;
    dailyCost?: number;
  };
  condition?: string;
  fingerprint?: string;
  ignoredUntil?: string | null;
  evidenceTrace?: {
    id: string;
    sessionId: string | null;
    traceType: string;
    name: string;
    startedAt: string;
    latencyMs: number | null;
    status: string;
    error: string | null;
    cost?: number | null;
  };
  message: string;
  triggeredAt: string;
}

export const api = new ApiClient();
