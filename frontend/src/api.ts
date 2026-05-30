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
  private inflight = new Map<string, Promise<unknown>>();
  private MAX_RETRIES = 2;
  private RETRY_BASE_MS = 500;

  private getToken(): string | null {
    return storage.getItem('token');
  }

  private getRefreshToken(): string | null {
    return storage.getItem('refreshToken');
  }

  private setToken(token: string | null): void {
    if (token) {
      storage.setItem('token', token);
    } else {
      storage.removeItem('token');
    }
  }

  private setRefreshToken(token: string | null): void {
    if (token) {
      storage.setItem('refreshToken', token);
    } else {
      storage.removeItem('refreshToken');
    }
  }

  private async tryRefreshToken(): Promise<boolean> {
    const refreshToken = this.getRefreshToken();
    if (!refreshToken) return false;
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) return false;
      const data = await res.json();
      this.setToken(data.token);
      if (data.refreshToken) this.setRefreshToken(data.refreshToken);
      return true;
    } catch {
      return false;
    }
  }

  private async request<T>(
    path: string,
    options: RequestInit = {}
  ): Promise<T> {
    const method = options.method || 'GET';

    // Deduplicate identical GET requests in flight
    if (method === 'GET') {
      const key = path;
      const existing = this.inflight.get(key);
      if (existing) return existing as Promise<T>;

      const promise = this.doRequest<T>(path, options).finally(() => {
        this.inflight.delete(key);
      });
      this.inflight.set(key, promise);
      return promise;
    }

    return this.doRequest<T>(path, options);
  }

  private async doRequest<T>(
    path: string,
    options: RequestInit = {},
    attempt = 0
  ): Promise<T> {
    const token = this.getToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    let response: Response;
    try {
      response = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers,
      });
    } catch (err) {
      // Network error — retry with exponential backoff
      if (attempt < this.MAX_RETRIES) {
        await new Promise(r => setTimeout(r, this.RETRY_BASE_MS * Math.pow(2, attempt)));
        return this.doRequest<T>(path, options, attempt + 1);
      }
      throw err;
    }

    if (response.status === 401) {
      // Try refresh token before giving up
      if (attempt === 0) {
        const refreshed = await this.tryRefreshToken();
        if (refreshed) {
          return this.doRequest<T>(path, options, attempt + 1);
        }
      }
      this.setToken(null);
      this.setRefreshToken(null);
      window.location.href = '/login';
      throw new Error('Unauthorized');
    }

    // Retry on 5xx server errors
    if (response.status >= 500 && attempt < this.MAX_RETRIES) {
      await new Promise(r => setTimeout(r, this.RETRY_BASE_MS * Math.pow(2, attempt)));
      return this.doRequest<T>(path, options, attempt + 1);
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

  setAuthRefreshToken(token: string): void {
    this.setRefreshToken(token);
  }

  clearAuthToken(): void {
    this.setToken(null);
    this.setRefreshToken(null);
  }

  isAuthenticated(): boolean {
    return !!this.getToken();
  }

  auth = {
    register: (data: { email: string; password: string; name?: string }) =>
      this.request<{ token: string; refreshToken: string; user: User }>('/auth/register', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    login: (data: { email: string; password: string }) =>
      this.request<{ token: string; refreshToken: string; user: User }>('/auth/login', {
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
    list: (projectId: string, params?: { sessionId?: string; parentTraceId?: string; evalStatus?: string; traceType?: string; status?: string; name?: string; startDate?: string; endDate?: string; latencyMin?: number; latencyMax?: number; limit?: number; offset?: number }) => {
      const query = new URLSearchParams({ projectId });
      if (params?.sessionId) query.set('sessionId', params.sessionId);
      if (params?.parentTraceId !== undefined) query.set('parentTraceId', params.parentTraceId);
      if (params?.evalStatus) query.set('evalStatus', params.evalStatus);
      if (params?.traceType) query.set('traceType', params.traceType);
      if (params?.status) query.set('status', params.status);
      if (params?.name) query.set('name', params.name);
      if (params?.startDate) query.set('startDate', params.startDate);
      if (params?.endDate) query.set('endDate', params.endDate);
      if (params?.latencyMin !== undefined) query.set('latencyMin', String(params.latencyMin));
      if (params?.latencyMax !== undefined) query.set('latencyMax', String(params.latencyMax));
      if (params?.limit) query.set('limit', String(params.limit));
      if (params?.offset) query.set('offset', String(params.offset));
      return this.request<{ traces: Trace[] }>(`/traces?${query.toString()}`);
    },

    get: (id: string) => this.request<{ trace: Trace; childCount: number }>(`/traces/${id}`),
    getTree: (id: string) => this.request<TraceTreeResponse>(`/traces/${id}/tree`),
    exportOtel: (id: string) => this.request<{ span: Record<string, unknown> }>(`/traces/${id}/otel`),
    exportSessionOtel: (sessionId: string, projectId: string) => this.request<{ resourceSpans: unknown[] }>(`/traces/session/${sessionId}/otel?projectId=${projectId}`),
    importOtel: (data: { resourceSpans: unknown[] }) => this.request<{ imported: number; traceIds: string[] }>('/traces/otel-export', { method: 'POST', body: JSON.stringify(data) }),
    addToDataset: (id: string, data: { datasetId?: string; datasetName?: string; expectedOutput?: string }) => this.request<{ item: DatasetItem; dataset: Dataset }>(`/traces/${id}/add-to-dataset`, { method: 'POST', body: JSON.stringify(data) }),
    bulkExportDataset: (data: { projectId: string; traceIds?: string[]; filters?: { status?: string; traceType?: string; sessionId?: string }; datasetName?: string; datasetId?: string }) => this.request<{ imported: number; dataset: Dataset; traceIds: string[] }>('/traces/bulk-export-dataset', { method: 'POST', body: JSON.stringify(data) }),
    addEval: (id: string, data: { evaluator?: string; score: number; passed: number | boolean; details?: Record<string, unknown> }) =>
      this.request<{ success: boolean; evalResult: TraceEvalResult }>(`/traces/${id}/eval`, { method: 'POST', body: JSON.stringify(data) }),
    getEvals: (id: string) =>
      this.request<{ evaluations: TraceEvalResult[] }>(`/traces/${id}/evaluations`),
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

    timeline: (sessionId: string) =>
      this.request<{ timeline: TimelineItem[] }>(`/sessions/${sessionId}/timeline`),
    exportDataset: (sessionId: string, data?: { name?: string }) =>
      this.request<{ dataset: Dataset; itemCount: number }>(`/sessions/${sessionId}/export-dataset`, {
        method: 'POST',
        body: JSON.stringify(data || {}),
      }),
  };

  stats = {
    get: (projectId?: string) => {
      const query = projectId ? `?projectId=${projectId}` : '';
      return this.request<{ stats: Stats }>(`/stats${query}`);
    },
    observation: (projectId: string) =>
      this.request<ObservationStats>(`/stats/observation?project_id=${projectId}`),
    trend: (projectId: string, days: number = 7) =>
      this.request<{ trend: TrendPoint[] }>(`/stats/trend?project_id=${projectId}&days=${days}`),
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

  evaluation = {
    datasets: {
      list: (projectId: string) =>
        this.request<Dataset[]>(`/evaluation/datasets?project_id=${projectId}`),
      create: (data: { project_id: string; name: string; description?: string; type?: string; auto_create_evaluators?: boolean }) =>
        this.request<Dataset & { preset_evaluators?: Evaluator[] }>('/evaluation/datasets', { method: 'POST', body: JSON.stringify(data) }),
      update: (id: string, data: { name?: string; description?: string; type?: string }) =>
        this.request<Dataset>(`/evaluation/datasets/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
      delete: (id: string) =>
        this.request<void>(`/evaluation/datasets/${id}`, { method: 'DELETE' }),
      createPresetEvaluators: (id: string, projectId: string) =>
        this.request<{ evaluators: Evaluator[] }>(`/evaluation/datasets/${id}/preset-evaluators`, { method: 'POST', body: JSON.stringify({ project_id: projectId }) }),
      items: {
        list: (datasetId: string) =>
          this.request<DatasetItem[]>(`/evaluation/datasets/${datasetId}/items`),
        add: (datasetId: string, items: Array<{ input: string; expected_output?: string }>) =>
          this.request<DatasetItem[]>(`/evaluation/datasets/${datasetId}/items`, {
            method: 'POST',
            body: JSON.stringify({ items }),
          }),
        update: (itemId: string, data: { input?: string; expected_output?: string }) =>
          this.request<DatasetItem>(`/evaluation/datasets/items/${itemId}`, { method: 'PUT', body: JSON.stringify(data) }),
        delete: (itemId: string) =>
          this.request<void>(`/evaluation/datasets/items/${itemId}`, { method: 'DELETE' }),
      },
    },
    evaluatorTemplates: {
      list: (type?: string) =>
        this.request<{ templates: EvaluatorTemplate[] }>(`/evaluation/evaluator-templates${type ? `?type=${type}` : ''}`),
    },
    evaluators: {
      list: (projectId: string) =>
        this.request<Evaluator[]>(`/evaluation/evaluators?project_id=${projectId}`),
      create: (data: { project_id: string; name: string; description?: string; type: string; config?: Record<string, unknown> }) =>
        this.request<Evaluator>('/evaluation/evaluators', { method: 'POST', body: JSON.stringify(data) }),
      update: (id: string, data: { name?: string; description?: string; type?: string; config?: Record<string, unknown> }) =>
        this.request<Evaluator>(`/evaluation/evaluators/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
      delete: (id: string) =>
        this.request<void>(`/evaluation/evaluators/${id}`, { method: 'DELETE' }),
    },
    experiments: {
      list: (projectId: string) =>
        this.request<EvaluationExperiment[]>(`/evaluation/experiments?project_id=${projectId}`),
      create: (data: { project_id: string; name: string; description?: string; dataset_id: string; model_config?: Record<string, unknown> }) =>
        this.request<EvaluationExperiment>('/evaluation/experiments', { method: 'POST', body: JSON.stringify(data) }),
      start: (id: string) =>
        this.request<EvaluationExperiment>(`/evaluation/experiments/${id}/start`, { method: 'POST' }),
      complete: (id: string, results_summary?: Record<string, unknown>) =>
        this.request<EvaluationExperiment>(`/evaluation/experiments/${id}/complete`, {
          method: 'POST',
          body: JSON.stringify({ results_summary }),
        }),
      delete: (id: string) =>
        this.request<void>(`/evaluation/experiments/${id}`, { method: 'DELETE' }),
      results: (id: string) =>
        this.request<EvaluationResult[]>(`/evaluation/experiments/${id}/results`),
      progress: (id: string) =>
        this.request<ExperimentProgress>(`/evaluation/experiments/${id}/progress`),
      report: (id: string) =>
        this.request<any>(`/evaluation/experiments/${id}/report`),
      badcases: (id: string) =>
        this.request<{ badcases: any[] }>(`/evaluation/experiments/${id}/badcases`),
      scriptTemplate: (id: string) =>
        this.request<{ typescript: string; python: string }>(`/evaluation/experiments/${id}/script-template`),
    },
    autoEvalTasks: {
      list: (projectId: string) =>
        this.request<{ tasks: AutoEvalTask[] }>(`/evaluation/auto-eval-tasks?project_id=${projectId}`),
      create: (data: { project_id: string; name: string; dataset_id: string; evaluator_id?: string; interval_hours?: number; sample_count?: number; trace_type_filter?: string; enabled?: boolean }) =>
        this.request<AutoEvalTask>('/evaluation/auto-eval-tasks', { method: 'POST', body: JSON.stringify(data) }),
      update: (id: string, data: { name?: string; interval_hours?: number; sample_count?: number; trace_type_filter?: string; enabled?: boolean }) =>
        this.request<AutoEvalTask>(`/evaluation/auto-eval-tasks/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
      delete: (id: string) =>
        this.request<void>(`/evaluation/auto-eval-tasks/${id}`, { method: 'DELETE' }),
      trigger: (id: string) =>
        this.request<{ success: boolean; message: string }>(`/evaluation/auto-eval-tasks/${id}/trigger`, { method: 'POST' }),
    },
    results: {
      calibrate: (id: string, data: { calibrated_score: number; calibrated_passed: boolean; calibration_note?: string }) =>
        this.request<EvaluationResult>(`/evaluation/results/${id}/calibrate`, { method: 'PUT', body: JSON.stringify(data) }),
    },
  };

  prompts = {
    list: (projectId: string) =>
      this.request<Prompt[]>(`/prompts?project_id=${projectId}`),
    create: (data: { project_id: string; name: string; description?: string; content: string; config?: Record<string, unknown> }) =>
      this.request<Prompt>('/prompts', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: { content?: string; config?: Record<string, unknown>; description?: string }) =>
      this.request<Prompt>(`/prompts/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) =>
      this.request<void>(`/prompts/${id}`, { method: 'DELETE' }),
    versions: {
      list: (promptId: string) =>
        this.request<PromptVersion[]>(`/prompts/${promptId}/versions`),
      get: (versionId: string) =>
        this.request<PromptVersion>(`/prompts/versions/${versionId}`),
    },
    rollback: (promptId: string, versionId: string) =>
      this.request<Prompt>(`/prompts/${promptId}/rollback/${versionId}`, { method: 'POST' }),
    createVersion: (promptId: string, data: { content?: string; config?: Record<string, unknown>; description?: string; auto_regression?: boolean; regression_dataset_id?: string }) =>
      this.request<{ version: PromptVersion; prompt: Prompt | null; regression_experiment: EvaluationExperiment | null }>(`/prompts/${promptId}/versions`, { method: 'POST', body: JSON.stringify(data) }),
  };

  playground = {
    run: (data: { project_id: string; prompt_id?: string; prompt_version_id?: string; model: string; input: string; output?: string; latency_ms?: number; status?: string }) =>
      this.request<PlaygroundRun>('/playground/run', { method: 'POST', body: JSON.stringify(data) }),
    runs: (projectId: string, promptId?: string) =>
      this.request<PlaygroundRun[]>(`/playground/runs?project_id=${projectId}${promptId ? `&prompt_id=${promptId}` : ''}`),
  };

  modelConfigs = {
    list: (projectId: string) =>
      this.request<ModelConfig[]>(`/model-configs?project_id=${projectId}`),
    create: (data: { project_id: string; name: string; provider: string; model: string; config?: Record<string, unknown>; api_key?: string; base_url?: string }) =>
      this.request<ModelConfig>('/model-configs', { method: 'POST', body: JSON.stringify(data) }),
    delete: (id: string) =>
      this.request<void>(`/model-configs/${id}`, { method: 'DELETE' }),
  };

  feedbacks = {
    create: (data: { projectId: string; sessionId?: string; messageId?: string; rating: number; reason?: string; comment?: string; dimensions?: Record<string, unknown> }) =>
      this.request<{ feedback: UserFeedback }>('/feedbacks', { method: 'POST', body: JSON.stringify(data) }),
    list: (projectId: string, params?: { rating?: number; limit?: number; offset?: number }) => {
      const query = new URLSearchParams({ projectId });
      if (params?.rating !== undefined) query.set('rating', String(params.rating));
      if (params?.limit) query.set('limit', String(params.limit));
      if (params?.offset) query.set('offset', String(params.offset));
      return this.request<{ feedbacks: UserFeedback[] }>(`/feedbacks?${query.toString()}`);
    },
    stats: (projectId: string) =>
      this.request<{ stats: FeedbackStats }>(`/feedbacks/stats?projectId=${projectId}`),
  };
}

export interface Dataset {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  type: string;
  item_count: number;
  created_at: string;
  updated_at: string;
}

export interface DatasetItem {
  id: string;
  dataset_id: string;
  input: string;
  expected_output: string | null;
  metadata: string | null;
  created_at: string;
}

export interface Evaluator {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  type: string;
  config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface EvaluationExperiment {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  dataset_id: string;
  model_config: Record<string, unknown> | null;
  status: 'pending' | 'running' | 'completed' | 'failed';
  results_summary: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface EvaluationResult {
  id: string;
  experiment_id: string;
  dataset_item_id: string;
  evaluator_id: string | null;
  output: string | null;
  score: number | null;
  passed: number;
  details: Record<string, unknown> | null;
  latency_ms: number | null;
  created_at: string;
}

export interface Prompt {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  content: string;
  config: Record<string, unknown> | null;
  current_version_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface PromptVersion {
  id: string;
  prompt_id: string;
  content: string;
  config: Record<string, unknown> | null;
  version_number: number;
  description: string | null;
  created_at: string;
}

export interface PlaygroundRun {
  id: string;
  project_id: string;
  prompt_id: string | null;
  prompt_version_id: string | null;
  model: string;
  input: string;
  output: string | null;
  latency_ms: number | null;
  status: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface ModelConfig {
  id: string;
  project_id: string;
  name: string;
  provider: string;
  model: string;
  api_key: string | null;
  base_url: string | null;
  config: Record<string, unknown> | null;
  created_at: string;
}

export interface EvaluatorTemplate {
  id: string;
  name: string;
  type: string;
  description: string;
  default_config: Record<string, unknown>;
  applicable_dataset_types: string[];
  criteria_options?: string[];
}

export interface ExperimentProgress {
  experiment_id: string;
  status: string;
  total_items: number;
  completed_items: number;
  completion_rate: number;
}

export interface AutoEvalTask {
  id: string;
  project_id: string;
  name: string;
  dataset_id: string;
  evaluator_id: string | null;
  interval_hours: number;
  sample_count: number;
  trace_type_filter: string | null;
  enabled: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string;
  updated_at: string;
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

/**
 * Span 树节点接口（新格式）
 */
export interface SpanTreeNode {
  spanId: string;
  name: string;
  traceType: string;
  startedAt: string;
  endedAt: string | null;
  latencyMs: number | null;
  status: string;
  error: string | null;
  input: unknown;
  output: unknown;
  attributes: unknown;
  tokens: { prompt?: number; completion?: number; total?: number } | null;
  costUsd: number | null;
  children: SpanTreeNode[];
}

/**
 * Span 统计信息接口（新格式）
 */
export interface SpanStats {
  totalSpans: number;
  totalLatencyMs: number;
  totalTokens: { prompt: number; completion: number; total: number };
  totalCostUsd: number;
  errorCount: number;
}

/**
 * Trace Tree 响应类型（兼容新旧格式）
 */
export type TraceTreeResponse =
  | { trace: Trace; children: Trace[] }
  | { trace: Trace; spans: SpanTreeNode[]; stats: SpanStats };

export interface Trace {
  id: string;
  project_id: string;
  session_id?: string;
  agent_id?: string;
  parent_trace_id?: string | null;
  trace_type: string;
  name: string;
  input?: unknown;
  output?: unknown;
  metadata?: unknown;
  trace_id?: string | null;
  span_id?: string | null;
  parent_span_id?: string | null;
  started_at: string;
  ended_at?: string;
  latency_ms?: number;
  status: string;
  error?: string;
  latest_eval_score?: number | null;
  latest_eval_passed?: number | null;
  created_at: string;
}

export interface TraceEvalResult {
  id: string;
  trace_id: string;
  evaluator: string | null;
  score: number | null;
  passed: number | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

export interface ToolCall {
  id: string;
  session_id: string;
  message_id?: string | null;
  tool_name: string;
  input?: unknown;
  output?: unknown;
  status: string;
  started_at: string;
  ended_at?: string;
  created_at: string;
}

export interface TimelineItem {
  type: 'message' | 'trace' | 'tool_call';
  id: string;
  timestamp: string;
  data: unknown;
}

export interface ObservationStats {
  totalTraces: number;
  totalSessions: number;
  totalToolCalls: number;
  traceTypeBreakdown: Array<{ type: string; count: number }>;
  avgLatency: number;
  successRate: number;
  topTools: Array<{ name: string; count: number }>;
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

export interface TrendPoint {
  date: string;
  traceCount: number;
  tokenCount: number;
  successRate: number;
  errorCount: number;
  avgLatency: number;
}

export interface Breakpoint {
  id: string;
  project_id: string;
  name: string;
  type: 'keyword' | 'error' | 'latency' | 'custom';
  condition: string;
  enabled: boolean;
  hit_threshold: number;
  hit_count: number;
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

export interface UserFeedback {
  id: string;
  project_id: string;
  session_id: string | null;
  message_id: string | null;
  rating: number;
  reason: string | null;
  comment: string | null;
  dimensions: Record<string, unknown> | null;
  created_at: string;
}

export interface FeedbackStats {
  total: number;
  positive: number;
  negative: number;
  neutral: number;
  positiveRate: number;
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
