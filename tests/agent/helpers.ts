/**
 * Layer 4 测试公共辅助函数
 */

const API_URL = process.env.API_URL || 'http://localhost:3000';

export interface TestContext {
  token: string;
  userId: string;
  projectId: string;
  apiKey: string;
}

/** 注册测试用户 */
export async function registerTestUser(): Promise<{ token: string; userId: string }> {
  const email = `layer4-${Date.now()}-${Math.random().toString(36).substr(2, 5)}@test.local`;
  const res = await fetch(`${API_URL}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Test12345678!', name: 'Layer4 Test' }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Register failed: ${res.status} ${text}`);
  }

  const data = await res.json() as { token: string; user: { id: string } };
  return { token: data.token, userId: data.user.id };
}

/** 创建测试项目 */
export async function createTestProject(token: string): Promise<string> {
  const res = await fetch(`${API_URL}/api/v1/projects`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ name: `Layer4 Project ${Date.now()}` }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Create project failed: ${res.status} ${text}`);
  }

  const data = await res.json() as { project?: { id: string }; id?: string };
  return data.project?.id || data.id!;
}

/** 创建 API Key */
export async function createApiKey(token: string, projectId: string): Promise<string> {
  const res = await fetch(`${API_URL}/api/v1/apikeys`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ project_id: projectId, name: 'layer4-test-key' }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Create API key failed: ${res.status} ${text}`);
  }

  const data = await res.json() as { apiKey?: { key: string }; key?: string };
  const key = data.apiKey?.key || data.key;
  if (!key) {
    throw new Error('API Key not found in response: ' + JSON.stringify(data));
  }
  return key;
}

/** 初始化测试上下文 */
export async function initTestContext(): Promise<TestContext> {
  const { token, userId } = await registerTestUser();
  const projectId = await createTestProject(token);
  const apiKey = await createApiKey(token, projectId);
  return { token, userId, projectId, apiKey };
}

/** 查询 traces */
export async function getTraces(token: string, projectId: string, filters?: { sessionId?: string; traceType?: string }): Promise<any[]> {
  const params = new URLSearchParams({ projectId });
  if (filters?.sessionId) params.append('sessionId', filters.sessionId);
  if (filters?.traceType) params.append('traceType', filters.traceType);
  params.append('limit', '200');

  const res = await fetch(`${API_URL}/api/v1/traces?${params.toString()}`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Get traces failed: ${res.status} ${text}`);
  }

  const data = await res.json() as { traces: any[] };
  return data.traces || [];
}

/** 查询 sessions（通过 API Key 认证） */
export async function getSessions(apiKey: string, projectId: string): Promise<any[]> {
  const res = await fetch(`${API_URL}/api/v1/sessions?projectId=${projectId}&limit=200`, {
    headers: {
      'X-API-Key': apiKey,
      'Authorization': `Bearer ${apiKey}`,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Get sessions failed: ${res.status} ${text}`);
  }

  const data = await res.json() as any[] | { sessions?: any[] };
  return Array.isArray(data) ? data : (data.sessions || []);
}

/** 创建断点规则 */
export async function createBreakpoint(
  token: string,
  projectId: string,
  breakpoint: { name: string; type: string; condition: string; enabled: boolean }
): Promise<any> {
  const res = await fetch(`${API_URL}/api/v1/breakpoints`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ projectId, ...breakpoint }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Create breakpoint failed: ${res.status} ${text}`);
  }

  return res.json();
}

/** 延迟 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
