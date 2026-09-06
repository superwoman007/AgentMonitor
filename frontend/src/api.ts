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

  private isRetryableMethod(method: string): boolean {
    return ['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());
  }

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
    const method = (options.method || 'GET').toUpperCase();
    const token = this.getToken();
    const headers: Record<string, string> = {
      ...(options.headers as Record<string, string>),
    };
    const hasBody = options.body !== undefined && options.body !== null;
    const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
    const hasContentType = Object.keys(headers).some((key) => key.toLowerCase() === 'content-type');

    if (hasBody && !isFormData && !hasContentType) {
      headers['Content-Type'] = 'application/json';
    }

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    let response: Response;
    const requestUrl = path.startsWith('/api/') ? path : `${API_BASE}${path}`;
    try {
      response = await fetch(requestUrl, {
        ...options,
        headers,
      });
    } catch (err) {
      // Network error — retry with exponential backoff
      if (this.isRetryableMethod(method) && attempt < this.MAX_RETRIES) {
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
      // Also clear the persisted Zustand auth state; otherwise a reload restores
      // the invalid token and creates an endless 401 -> reload loop.
      storage.removeItem('auth-storage');
      if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
        window.location.replace('/login');
      }
      throw new Error('Unauthorized');
    }

    // Retry on 5xx server errors
    if (response.status >= 500 && this.isRetryableMethod(method) && attempt < this.MAX_RETRIES) {
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

  /**
   * 通用 GET 请求：供暂未封装为独立资源的接口使用，统一走鉴权头、401 刷新、去重与重试逻辑。
   * @param path - 以 /api 开头的完整路径
   * @returns 解析后的响应体
   */
  get<T = unknown>(path: string): Promise<T> {
    return this.request<T>(path);
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

    integrationStatus: (projectId: string) =>
      this.request<IntegrationStatus>(`/api/v2/projects/${projectId}/integration-status`),
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
      versions: {
        create: (datasetId: string, data: { description?: string } = {}) =>
          this.request<DatasetVersion>(`/evaluation/datasets/${datasetId}/versions`, {
            method: 'POST',
            body: JSON.stringify(data),
          }),
        list: (datasetId: string) =>
          this.request<{ versions: DatasetVersion[] }>(`/evaluation/datasets/${datasetId}/versions`),
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
      versions: {
        list: (evaluatorId: string) =>
          this.request<{ versions: EvaluatorVersion[] }>(`/evaluation/evaluators/${evaluatorId}/versions`),
      },
    },
    experiments: {
      list: (projectId: string) =>
        this.request<EvaluationExperiment[]>(`/evaluation/experiments?project_id=${projectId}`),
      get: (id: string) =>
        this.request<EvaluationExperiment>(`/evaluation/experiments/${id}`),
      create: (data: {
        project_id: string;
        name: string;
        description?: string;
        dataset_id: string;
        model_config?: Record<string, unknown>;
        prompt_id?: string;
        prompt_version_id?: string;
        target_model_config_id?: string;
        run_config?: Record<string, unknown>;
        evaluator_id?: string;
        dataset_version_id?: string;
        target_version_id?: string;
        evaluator_suite_version_id?: string;
        default_run_config?: Record<string, unknown>;
        default_gate_config?: Record<string, unknown>;
      }) =>
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

  targetsV2 = {
    list: (projectId: string) =>
      this.request<{ targets: AgentTarget[] }>(`/api/v2/evaluation/targets?projectId=${projectId}`),
    create: (data: {
      projectId: string;
      name: string;
      description?: string;
      type: AgentTargetType;
      invocationConfig: Record<string, unknown>;
      inputMapping?: Record<string, string>;
      outputMapping?: Record<string, string>;
      sourceRevision?: Record<string, unknown>;
      enabled?: boolean;
    }) =>
      this.request<{ target: AgentTarget; version: AgentTargetVersion }>(`/api/v2/evaluation/targets`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  };

  suitesV2 = {
    create: (data: {
      projectId: string;
      name: string;
      description?: string;
      members: Array<{
        evaluatorVersionId: string;
        alias: string;
        weight?: number;
        required?: boolean;
        passThreshold?: number;
        ordinal?: number;
      }>;
      aggregationConfig?: {
        strategy?: 'weighted_avg' | 'all_required' | 'any_pass';
        passThreshold?: number;
      };
    }) =>
      this.request<{ suite: EvaluatorSuite; version: EvaluatorSuiteVersion; members: EvaluatorSuiteMember[] }>(
        `/api/v2/evaluation/suites`,
        {
          method: 'POST',
          body: JSON.stringify(data),
        }
      ),
  };

  /**
   * PR-11：V2 Run 报告、Bad Cases、Compare、导出。
   * 路由前缀 /api/v2/evaluation（在 fetch 层通过绝对路径访问，不走 /api/v1）。
   */
  runsV2 = {
    listByExperiment: async (experimentId: string): Promise<{ runs: V2Run[] }> => {
      const data = await this.request<{ runs: V2Run[] } | V2Run[]>(
        `/api/v2/evaluation/experiments/${experimentId}/runs`
      );
      return { runs: Array.isArray(data) ? data : data.runs ?? [] };
    },
    get: (runId: string) =>
      this.request<{ run: V2Run }>(`/api/v2/evaluation/runs/${runId}`),
    report: (runId: string) =>
      this.request<V2RunReport>(`/api/v2/evaluation/runs/${runId}/report`),
    items: (
      runId: string,
      filter: {
        status?: string;
        passed?: boolean;
        caseKey?: string;
        caseKeyPrefix?: string;
        evaluatorAlias?: string;
        scoreMin?: number;
        scoreMax?: number;
        errorCode?: string;
        cursor?: string;
        limit?: number;
      } = {}
    ) => {
      const query = new URLSearchParams();
      if (filter.status) query.set('status', filter.status);
      if (typeof filter.passed === 'boolean') query.set('passed', String(filter.passed));
      if (filter.caseKey) query.set('caseKey', filter.caseKey);
      if (filter.caseKeyPrefix) query.set('caseKeyPrefix', filter.caseKeyPrefix);
      if (filter.evaluatorAlias) query.set('evaluatorAlias', filter.evaluatorAlias);
      if (filter.scoreMin !== undefined) query.set('scoreMin', String(filter.scoreMin));
      if (filter.scoreMax !== undefined) query.set('scoreMax', String(filter.scoreMax));
      if (filter.errorCode) query.set('errorCode', filter.errorCode);
      if (filter.cursor) query.set('cursor', filter.cursor);
      if (filter.limit !== undefined) query.set('limit', String(filter.limit));
      const suffix = query.toString();
      return this.request<V2RunItemsPage>(
        `/api/v2/evaluation/runs/${runId}/items${suffix ? `?${suffix}` : ''}`
      );
    },
    events: (runId: string) =>
      this.request<{ events: V2RunEvent[] }>(`/api/v2/evaluation/runs/${runId}/events`),
    badCases: (runId: string, limit = 20) =>
      this.request<V2BadCasesReport>(
        `/api/v2/evaluation/runs/${runId}/bad-cases?limit=${limit}`
      ),
    compare: (baselineRunId: string, candidateRunId: string) =>
      this.request<V2RunComparison>(`/api/v2/evaluation/runs:compare`, {
        method: 'POST',
        body: JSON.stringify({ baselineRunId, candidateRunId }),
      }),
    retryItem: (runItemId: string) =>
      this.request<{ run: V2Run; items: number; retry_of_run_id: string; source_run_item_id: string }>(
        `/api/v2/evaluation/run-items/${runItemId}/retry`,
        { method: 'POST' }
      ),
    addItemToDataset: (
      runItemId: string,
      data: { datasetId?: string; datasetName?: string; expectedOutput?: string }
    ) =>
      this.request<{ item: DatasetItem; dataset: Dataset; run_item_id: string }>(
        `/api/v2/evaluation/run-items/${runItemId}/add-to-dataset`,
        { method: 'POST', body: JSON.stringify(data) }
      ),
    /**
     * 拉取 JUnit XML 文本，用于 CI 下载。
     */
    exportJunit: async (runId: string): Promise<string> => {
      const token = this.getToken();
      const res = await fetch(`/api/v2/evaluation/runs/${runId}/export?format=junit`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`Failed to export JUnit: HTTP ${res.status}`);
      return res.text();
    },
    exportJson: (runId: string) =>
      this.request<{ run: V2Run; items: V2RunItemsPage; events: V2RunEvent[] }>(
        `/api/v2/evaluation/runs/${runId}/export`
      ),
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
    createVersion: (
      promptId: string,
      data: {
        content?: string;
        config?: Record<string, unknown>;
        description?: string;
        auto_regression?: boolean;
        regression_dataset_id?: string;
        regression_model_config_id?: string;
        regression_evaluator_id?: string;
      }
    ) =>
      this.request<{ version: PromptVersion; prompt: Prompt | null; regression_experiment: EvaluationExperiment | null }>(`/prompts/${promptId}/versions`, { method: 'POST', body: JSON.stringify(data) }),
    linkedTraces: (promptId: string) =>
      this.request<{ traces: Trace[] }>(`/prompts/${promptId}/traces`),
    optimize: (promptId: string, data: { experiment_id: string; model_config_id?: string }) =>
      this.request<{ original_prompt: string; optimized_prompt: string; analysis: string; improvements: string[] }>(`/prompts/${promptId}/optimize`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    applyOptimization: (promptId: string, data: { optimized_prompt: string; description?: string }) =>
      this.request<PromptVersion>(`/prompts/${promptId}/optimize/apply`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  };

  /**
   * PR-12：Prompt Deployment 与 Runtime API。
   */
  promptDeployments = {
    environments: () =>
      this.request<{ environments: string[] }>('/api/v2/prompt-deployments/environments'),
    list: (projectId: string, promptId?: string) => {
      const q = new URLSearchParams({ projectId });
      if (promptId) q.set('promptId', promptId);
      return this.request<{ deployments: PromptDeployment[] }>(
        `/api/v2/prompt-deployments?${q.toString()}`
      );
    },
    get: (promptId: string, environment: string) =>
      this.request<{ deployment: PromptDeployment }>(
        `/api/v2/prompt-deployments/${promptId}?environment=${environment}`
      ),
    deploy: (
      promptId: string,
      data: {
        projectId: string;
        promptVersionId: string;
        environment: string;
        note?: string;
      }
    ) =>
      this.request<{ deployment: PromptDeployment }>(`/api/v2/prompt-deployments/${promptId}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    remove: (promptId: string, projectId: string, environment: string) =>
      this.request<void>(
        `/api/v2/prompt-deployments/${promptId}?projectId=${projectId}&environment=${environment}`,
        { method: 'DELETE' }
      ),
    /**
     * Runtime 解析（按 Prompt 名称 + 环境）。
     */
    resolve: (params: {
      projectId: string;
      promptName: string;
      environment?: string;
      etag?: string;
      bucketKey?: string;
    }): Promise<{ data: ResolvedRuntimePrompt | null; status: number; etag?: string }> => {
      const q = new URLSearchParams({ projectId: params.projectId });
      if (params.environment) q.set('environment', params.environment);
      if (params.bucketKey) q.set('bucketKey', params.bucketKey);
      const token = this.getToken();
      return fetch(`/api/v2/runtime/prompts/${encodeURIComponent(params.promptName)}?${q.toString()}`, {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(params.etag ? { 'If-None-Match': params.etag } : {}),
        },
      }).then(async (res) => {
        if (res.status === 304) return { data: null, status: 304 };
        if (!res.ok) throw new Error(`Runtime resolve failed: HTTP ${res.status}`);
        const data = (await res.json()) as ResolvedRuntimePrompt;
        return { data, status: res.status, etag: res.headers.get('etag') ?? undefined };
      });
    },
  };

  /**
   * PR-13a：Scheduled Run 定时回归调度管理。
   */
  schedules = {
    list: (projectId: string, experimentId?: string) => {
      const q = new URLSearchParams({ projectId });
      if (experimentId) q.set('experimentId', experimentId);
      return this.request<{ schedules: ScheduledRun[] }>(
        `/api/v2/evaluation/schedules?${q.toString()}`
      );
    },
    create: (data: {
      projectId: string;
      experimentId: string;
      name: string;
      scheduleType: 'interval' | 'cron';
      intervalMinutes?: number;
      cronExpr?: string;
      enabled?: boolean;
    }) =>
      this.request<{ schedule: ScheduledRun }>(`/api/v2/evaluation/schedules`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (
      scheduleId: string,
      data: {
        projectId: string;
        name?: string;
        scheduleType?: 'interval' | 'cron';
        intervalMinutes?: number;
        cronExpr?: string;
        enabled?: boolean;
      }
    ) =>
      this.request<{ schedule: ScheduledRun }>(
        `/api/v2/evaluation/schedules/${scheduleId}`,
        { method: 'PATCH', body: JSON.stringify(data) }
      ),
    remove: (scheduleId: string, projectId: string) =>
      this.request<void>(
        `/api/v2/evaluation/schedules/${scheduleId}?projectId=${projectId}`,
        { method: 'DELETE' }
      ),
    runNow: (scheduleId: string, projectId: string) =>
      this.request<{ runId: string; status: string }>(
        `/api/v2/evaluation/schedules/${scheduleId}/run-now?projectId=${projectId}`,
        { method: 'POST' }
      ),
    executions: (scheduleId: string, projectId: string, limit = 20) =>
      this.request<{ executions: ScheduledRunExecution[] }>(
        `/api/v2/evaluation/schedules/${scheduleId}/executions?projectId=${projectId}&limit=${limit}`
      ),
  };

  /**
   * PR-13b：Trace Sampling 采样规则管理。
   */
  samplingRules = {
    list: (projectId: string) =>
      this.request<{ rules: SamplingRule[] }>(
        `/api/v2/evaluation/sampling-rules?projectId=${projectId}`
      ),
    create: (data: {
      projectId: string;
      name: string;
      targetDatasetId: string;
      traceTypeFilter?: string;
      nameContains?: string;
      statusFilter?: string;
      errorOnly?: boolean;
      sampleRate?: number;
      maxItemsTotal?: number;
      enabled?: boolean;
    }) =>
      this.request<{ rule: SamplingRule }>(`/api/v2/evaluation/sampling-rules`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (
      ruleId: string,
      data: {
        projectId: string;
        name?: string;
        enabled?: boolean;
        sampleRate?: number;
        maxItemsTotal?: number | null;
      }
    ) =>
      this.request<{ rule: SamplingRule }>(
        `/api/v2/evaluation/sampling-rules/${ruleId}`,
        { method: 'PATCH', body: JSON.stringify(data) }
      ),
    remove: (ruleId: string, projectId: string) =>
      this.request<void>(
        `/api/v2/evaluation/sampling-rules/${ruleId}?projectId=${projectId}`,
        { method: 'DELETE' }
      ),
    runNow: (ruleId: string, projectId: string) =>
      this.request<{ ruleId: string; matched: number; sampled: number; skippedRate: number; skippedDup: number }>(
        `/api/v2/evaluation/sampling-rules/${ruleId}/run-now?projectId=${projectId}`,
        { method: 'POST' }
      ),
  };

  /**
   * PR-13c：持久化告警规则与告警事件。
   */
  alertRulesV2 = {
    list: (projectId: string) =>
      this.request<{ rules: AlertRuleV2[] }>(
        `/api/v2/evaluation/alert-rules?projectId=${projectId}`
      ),
    create: (data: {
      projectId: string;
      name: string;
      eventType: 'run_failed' | 'run_regression' | 'run_completed';
      threshold?: number;
      webhookUrl?: string;
      cooldownMinutes?: number;
    }) =>
      this.request<{ rule: AlertRuleV2 }>(`/api/v2/evaluation/alert-rules`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (
      ruleId: string,
      data: { projectId: string; enabled?: boolean; name?: string; threshold?: number | null; webhookUrl?: string | null }
    ) =>
      this.request<{ rule: AlertRuleV2 }>(`/api/v2/evaluation/alert-rules/${ruleId}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    remove: (ruleId: string, projectId: string) =>
      this.request<void>(
        `/api/v2/evaluation/alert-rules/${ruleId}?projectId=${projectId}`,
        { method: 'DELETE' }
      ),
    events: (projectId: string, limit = 50) =>
      this.request<{ events: AlertEventV2[] }>(
        `/api/v2/evaluation/alert-events?projectId=${projectId}&limit=${limit}`
      ),
  };

  /**
   * P1：Trace 人工标注。
   */
  traceAnnotations = {
    enums: () =>
      this.request<{ rootCauses: string[]; verdicts: string[] }>(
        '/api/v2/trace-annotations/enums'
      ),
    get: (traceId: string, projectId: string) =>
      this.request<{ annotation: TraceAnnotation } | null>(
        `/api/v2/trace-annotations/${traceId}?projectId=${projectId}`
      ).catch(() => null),
    list: (projectId: string, filter: { rootCause?: string; verdict?: string } = {}) => {
      const q = new URLSearchParams({ projectId });
      if (filter.rootCause) q.set('rootCause', filter.rootCause);
      if (filter.verdict) q.set('verdict', filter.verdict);
      return this.request<{ annotations: TraceAnnotation[] }>(
        `/api/v2/trace-annotations?${q.toString()}`
      );
    },
    save: (
      traceId: string,
      data: {
        projectId: string;
        rootCause?: string | null;
        verdict?: string | null;
        note?: string | null;
        tags?: string[];
      }
    ) =>
      this.request<{ annotation: TraceAnnotation }>(
        `/api/v2/trace-annotations/${traceId}`,
        { method: 'PUT', body: JSON.stringify(data) }
      ),
    remove: (traceId: string, projectId: string) =>
      this.request<void>(
        `/api/v2/trace-annotations/${traceId}?projectId=${projectId}`,
        { method: 'DELETE' }
      ),
    stats: (projectId: string) =>
      this.request<{ stats: Record<string, number> }>(
        `/api/v2/trace-annotations-stats?projectId=${projectId}`
      ),
  };

  /**
   * P1：Prompt A/B 实验变体。
   */
  promptAbVariants = {
    list: (promptId: string, projectId: string, environment: string) =>
      this.request<{ variants: PromptAbVariant[] }>(
        `/api/v2/prompt-ab-variants/${promptId}?projectId=${projectId}&environment=${environment}`
      ),
    upsert: (
      promptId: string,
      variantKey: string,
      data: {
        projectId: string;
        environment: string;
        promptVersionId: string;
        weight: number;
        note?: string;
        enabled?: boolean;
      }
    ) =>
      this.request<{ variant: PromptAbVariant }>(
        `/api/v2/prompt-ab-variants/${promptId}/${encodeURIComponent(variantKey)}`,
        { method: 'PUT', body: JSON.stringify(data) }
      ),
    remove: (promptId: string, variantKey: string, projectId: string, environment: string) =>
      this.request<void>(
        `/api/v2/prompt-ab-variants/${promptId}/${encodeURIComponent(variantKey)}?projectId=${projectId}&environment=${environment}`,
        { method: 'DELETE' }
      ),
    analytics: (promptId: string, projectId: string, environment: string, days = 14) =>
      this.request<{ report: PromptAbAnalyticsReport }>(
        `/api/v2/prompt-ab-analytics/${promptId}?projectId=${projectId}&environment=${environment}&days=${days}`
      ),
  };

  playground = {
    run: (data: { project_id: string; prompt_id?: string; prompt_version_id?: string; model_config_id?: string; model?: string; input: string }) =>
      this.request<PlaygroundRun>('/playground/run', { method: 'POST', body: JSON.stringify(data) }),
    compare: (data: { project_id: string; prompt_id?: string; prompt_version_id?: string; input: string; model_config_ids: string[] }) =>
      this.request<{ results: PlaygroundRun[]; summary: { totalModels: number; avgLatencyMs: number; fastestModel: string; slowestModel: string } }>(
        '/playground/compare',
        { method: 'POST', body: JSON.stringify(data) }
      ),
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
    test: (id: string) =>
      this.request<{ success: boolean; latency_ms: number; model: string; response_preview?: string; token_usage?: unknown; error?: string }>(`/model-configs/${id}/test`, { method: 'POST' }),
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

export interface DatasetVersion {
  id: string;
  dataset_id: string;
  version_number: number;
  item_count: number;
  description: string | null;
  created_by: string | null;
  created_at: string;
}

export interface Evaluator {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  type: string;
  config: Record<string, unknown>;
  current_version_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface EvaluatorVersion {
  id: string;
  evaluator_id: string;
  version_number: number;
  name: string | null;
  description: string | null;
  type: string;
  config: Record<string, unknown>;
  created_at: string;
}

export interface EvaluationExperiment {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  dataset_id: string;
  model_config: Record<string, unknown> | null;
  prompt_id: string | null;
  prompt_version_id: string | null;
  target_model_config_id: string | null;
  evaluator_id: string | null;
  run_config: Record<string, unknown> | null;
  dataset_version_id?: string | null;
  target_version_id?: string | null;
  evaluator_suite_version_id?: string | null;
  lifecycle_status?: string | null;
  default_run_config?: Record<string, unknown> | null;
  default_gate_config?: Record<string, unknown> | null;
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

export type AgentTargetType = 'prompt_model' | 'http_agent' | 'external_runner' | 'trace_replay';

export interface AgentTarget {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  target_type: AgentTargetType;
  current_version_id: string | null;
  enabled: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AgentTargetVersion {
  id: string;
  target_id: string;
  version_number: number;
  target_type: AgentTargetType;
  invocation_config: Record<string, unknown>;
  input_mapping: Record<string, string> | null;
  output_mapping: Record<string, string> | null;
  source_revision: Record<string, unknown> | null;
  created_by: string | null;
  created_at: string;
}

export interface EvaluatorSuite {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  current_version_id: string | null;
  enabled: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface EvaluatorSuiteVersion {
  id: string;
  suite_id: string;
  version_number: number;
  description: string | null;
  aggregation_config: Record<string, unknown> | null;
  created_by: string | null;
  created_at: string;
}

export interface EvaluatorSuiteMember {
  id: string;
  suite_version_id: string;
  evaluator_version_id: string;
  alias: string;
  weight: number;
  required: boolean;
  pass_threshold: number | null;
  ordinal: number;
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

export interface IntegrationWarning {
  code: string;
  message: string;
  documentationUrl: string;
}

export interface IntegrationStatus {
  connected: boolean;
  lastEventAt: string | null;
  traceCount: number;
  detectedSdk: {
    language: string;
    version: string;
    frameworks: string[];
  } | null;
  hooks: {
    agent: boolean;
    llm: boolean;
    tool: boolean;
    retrieval: boolean;
    decision: boolean;
  };
  fieldCompleteness: {
    parentSpanId: number;
    tokenUsage: number;
    promptVersion: number;
    agentVersion: number;
  };
  warnings: IntegrationWarning[];
  sampleTraceId: string | null;
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
  prompt_id?: string | null;
  prompt_version_id?: string | null;
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

export interface V2RunSummary {
  totalItems: number;
  passedItems: number;
  failedItems: number;
  skippedItems: number;
  avgScore: number | null;
  avgLatencyMs: number | null;
  scoreDistribution?: Record<string, number>;
  gateResult?: { passed: boolean; reason?: string } | null;
}

export interface V2Run {
  id: string;
  project_id: string;
  experiment_id: string;
  run_number: number;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'cancelling';
  trigger_type: string;
  retry_of_run_id: string | null;
  status_reason?: string | null;
  config_snapshot?: {
    experiment?: {
      datasetVersionId?: string;
      targetVersionId?: string;
      suiteVersionId?: string;
    };
  } | null;
  summary: V2RunSummary | null;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface V2Score {
  evaluator_alias: string;
  status: string;
  score: number | null;
  passed: boolean | null;
  error: string | null;
  reasoning: string | null;
  raw_output: string | null;
}

export interface V2RunItem {
  id: string;
  dataset_version_item_id: string;
  case_key: string;
  status: string;
  phase: string;
  input_snapshot: Record<string, unknown>;
  expected_snapshot: Record<string, unknown> | null;
  target_output: string | null;
  target_error: string | null;
  trace_id: string | null;
  latency_ms: number | null;
  started_at: string | null;
  completed_at: string | null;
  scores: V2Score[];
}

export interface V2RunItemsPage {
  items: V2RunItem[];
  nextCursor: string | null;
}

export interface V2RunEvent {
  id: string;
  run_id: string;
  sequence: number;
  event_type: string;
  payload: Record<string, unknown> | null;
  actor: string | null;
  created_at: string;
}

export interface V2BadCaseGroup {
  evaluatorAlias: string;
  failedCount: number;
  cases: Array<{
    runItemId: string;
    caseKey: string;
    score: number | null;
    error: string | null;
    reasoning: string | null;
    rawOutput: string | null;
    inputSnapshot: Record<string, unknown>;
    expectedSnapshot: Record<string, unknown> | null;
    targetOutput: string | null;
    targetError: string | null;
    traceId: string | null;
  }>;
}

export interface V2BadCasesReport {
  runId: string;
  totalItems: number;
  failedItems: number;
  byEvaluator: V2BadCaseGroup[];
  targetErrors: Array<{
    runItemId: string;
    caseKey: string;
    targetError: string;
    inputSnapshot: Record<string, unknown>;
    expectedSnapshot: Record<string, unknown> | null;
    targetOutput: string | null;
    traceId: string | null;
  }>;
}

export interface V2RunReport {
  run: V2Run;
  items: V2RunItemsPage;
  badCases: V2BadCasesReport;
}

export interface V2RunComparison {
  baseline: { runId: string; status: string; summary: V2RunSummary | null };
  candidate: { runId: string; status: string; summary: V2RunSummary | null };
  passRateDelta: number | null;
  fixedCases: string[];
  regressedCases: string[];
  stillFailing: string[];
  newFailed: string[];
}

export interface PromptDeployment {
  id: string;
  project_id: string;
  prompt_id: string;
  environment: 'production' | 'staging' | 'development';
  prompt_version_id: string;
  deployed_by: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface ResolvedRuntimePrompt {
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
  variantKey?: string | null;
  bucket?: number | null;
}

/**
 * PR-13c：持久化告警规则。
 */
export interface AlertRuleV2 {
  id: string;
  project_id: string;
  name: string;
  event_type: 'run_failed' | 'run_regression' | 'run_completed';
  condition: string | null;
  threshold: number | null;
  webhook_url: string | null;
  channels: string[];
  enabled: boolean;
  cooldown_minutes: number;
  last_triggered_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * P1：Trace 人工标注。
 */
export interface TraceAnnotation {
  id: string;
  project_id: string;
  trace_id: string;
  run_item_id: string | null;
  root_cause: string | null;
  verdict: string | null;
  note: string | null;
  tags: string[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * P1：Prompt A/B 实验变体。
 */
export interface PromptAbVariant {
  id: string;
  project_id: string;
  prompt_id: string;
  environment: string;
  variant_key: string;
  prompt_version_id: string;
  weight: number;
  note: string | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Prompt A/B 效果分析：单个变体汇总。
 */
export interface PromptAbAnalyticsVariantSummary {
  variantKey: string | null;
  label: string;
  promptVersionId: string;
  versionNumber: number | null;
  configuredWeight: number | null;
  sampleCount: number;
  trafficShare: number | null;
  successRate: number | null;
  avgLatencyMs: number | null;
  avgEvalScore: number | null;
  evalPassRate: number | null;
}

/**
 * Prompt A/B 效果分析：每日趋势点。
 */
export interface PromptAbAnalyticsTimelinePoint {
  day: string;
  variantKey: string | null;
  sampleCount: number;
  successRate: number | null;
  avgLatencyMs: number | null;
  avgEvalScore: number | null;
  evalPassRate: number | null;
}

/**
 * Prompt A/B 效果分析报告。
 */
export interface PromptAbAnalyticsReport {
  promptId: string;
  promptName: string;
  environment: string;
  days: number;
  generatedAt: string;
  baselinePromptVersionId: string;
  totalSamples: number;
  variants: PromptAbAnalyticsVariantSummary[];
  timeline: PromptAbAnalyticsTimelinePoint[];
}

export interface AlertEventV2 {
  id: string;
  rule_id: string | null;
  project_id: string;
  event_type: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  message: string;
  payload: Record<string, unknown> | null;
  fingerprint: string;
  delivery_status: 'pending' | 'delivered' | 'failed' | 'skipped';
  delivered_at: string | null;
  delivery_error: string | null;
  created_at: string;
}

/**
 * PR-13b：Trace Sampling 采样规则。
 */
export interface SamplingRule {
  id: string;
  project_id: string;
  name: string;
  target_dataset_id: string;
  trace_type_filter: string | null;
  name_contains: string | null;
  status_filter: string | null;
  error_only: boolean;
  sample_rate: number;
  max_items_total: number | null;
  enabled: boolean;
  matched_count: number;
  sampled_count: number;
  last_scanned_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * PR-13a：Scheduled Run 定时回归调度。
 */
export interface ScheduledRun {
  id: string;
  project_id: string;
  experiment_id: string;
  name: string;
  schedule_type: 'interval' | 'cron';
  interval_minutes: number | null;
  cron_expr: string | null;
  enabled: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
  last_run_id: string | null;
  last_status: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * DoD-11：定时调度执行历史。
 */
export interface ScheduledRunExecution {
  id: string;
  schedule_id: string;
  project_id: string;
  experiment_id: string;
  trigger_mode: 'scheduled' | 'manual';
  status: 'running' | 'created' | 'failed';
  run_id: string | null;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
  next_run_at: string | null;
  created_at: string;
}

export const api = new ApiClient();
