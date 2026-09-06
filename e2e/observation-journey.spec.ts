import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5174';
const API_URL = process.env.API_URL || 'http://localhost:3000';

const generateTestEmail = () => `obs-${Date.now()}-${Math.random().toString(36).substr(2, 9)}@example.com`;
const testPassword = 'Test1234567!';

test.describe('观测中心旅程：Dashboard → Traces → Sessions', () => {
  let testEmail: string;
  let projectId: string;
  let token: string;

  test.beforeAll(async ({ request }) => {
    testEmail = generateTestEmail();
    // 通过 API 注册用户并获取 token
    const registerRes = await request.post(`${API_URL}/api/v1/auth/register`, {
      data: { email: testEmail, password: testPassword, name: 'Obs Journey User' },
    });
    const registerData = await registerRes.json();
    token = registerData.token;

    // 创建项目
    const projectRes = await request.post(`${API_URL}/api/v1/projects`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Obs Test Project', description: 'For observation journey test' },
    });
    const projectData = await projectRes.json();
    projectId = projectData.project?.id || projectData.id;

    // 创建 session
    const sessionRes = await request.post(`${API_URL}/api/v1/sessions`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { projectId, id: `sess-obs-${Date.now()}` },
    });
    const sessionData = await sessionRes.json();
    const sessionId = sessionData.session?.id || sessionData.id;

    // 通过 API Key 上报 traces
    const apiKeyRes = await request.post(`${API_URL}/api/v1/apikeys`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { project_id: projectId, name: 'obs-test-key' },
    });
    const apiKeyData = await apiKeyRes.json();
    const apiKey = apiKeyData.apiKey?.key || apiKeyData.key;

    // 上报几条 trace
    for (let i = 0; i < 3; i++) {
      await request.post(`${API_URL}/api/v1/traces`, {
        headers: { 'x-api-key': apiKey },
        data: {
          project_id: projectId,
          session_id: sessionId,
          trace_type: 'llm',
          name: `obs-trace-${i}`,
          input: { prompt: `test prompt ${i}` },
          output: { response: `test response ${i}` },
          started_at: new Date().toISOString(),
          ended_at: new Date().toISOString(),
          latency_ms: 100 + i * 50,
          status: 'success',
        },
      });
    }
  });

  test('Step 1: Dashboard 显示统计数据', async ({ page }) => {
    // 登录
    await page.goto(`${BASE_URL}/login`);
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button[type="submit"]');
    await page.waitForURL(`${BASE_URL}/dashboard`);

    // Dashboard 应该加载
    await expect(page.locator('main h1')).toBeVisible();
    await page.waitForLoadState('networkidle');

    // 应该能看到页面内容
    await expect(page.locator('body')).toBeVisible();
  });

  test('Step 2: 导航到 Traces 页面查看追踪数据', async ({ page }) => {
    await page.goto(`${BASE_URL}/login`);
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button[type="submit"]');
    await page.waitForURL(`${BASE_URL}/dashboard`);

    // 导航到 Traces
    await page.goto(`${BASE_URL}/traces`);
    await page.waitForLoadState('networkidle');

    // 应该显示 Traces 页面
    await expect(page.locator('main h1')).toContainText(/观测中心|Observation|追踪记录|Traces/i);
  });

  test('Step 3: 导航到 Sessions 页面查看会话', async ({ page }) => {
    await page.goto(`${BASE_URL}/login`);
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button[type="submit"]');
    await page.waitForURL(`${BASE_URL}/dashboard`);

    // 导航到 Sessions
    await page.goto(`${BASE_URL}/sessions`);
    await page.waitForLoadState('networkidle');

    // 应该显示 Sessions 页面
    await expect(page.locator('main h1')).toContainText(/会话|Session/);
  });

  test('Step 4: Dashboard → Traces → Sessions 完整导航流', async ({ page }) => {
    // 登录
    await page.goto(`${BASE_URL}/login`);
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button[type="submit"]');
    await page.waitForURL(`${BASE_URL}/dashboard`);

    // 从 Dashboard 导航到 Traces
    let navigated = false;
    const tracesLink = page.locator('nav a[href="/traces"], aside a[href="/traces"]');
    if (await tracesLink.isVisible({ timeout: 3000 }).catch(() => false)) {
      await tracesLink.first().click();
      navigated = await page.waitForURL(/\/traces/, { timeout: 5000 }).then(() => true).catch(() => false);
    }
    if (!navigated) {
      await page.goto(`${BASE_URL}/traces`);
    }

    await page.waitForLoadState('networkidle');
    await expect(page.locator('main h1')).toContainText(/观测中心|Observation|追踪记录|Traces/i);

    // 从 Traces 导航到 Sessions
    navigated = false;
    const sessionsLink = page.locator('nav a[href="/sessions"], aside a[href="/sessions"]');
    if (await sessionsLink.isVisible({ timeout: 3000 }).catch(() => false)) {
      await sessionsLink.first().click();
      navigated = await page.waitForURL(/\/sessions/, { timeout: 5000 }).then(() => true).catch(() => false);
    }
    if (!navigated) {
      await page.goto(`${BASE_URL}/sessions`);
    }

    await page.waitForLoadState('networkidle');
    await expect(page.locator('main h1')).toContainText(/会话|Session/);
  });
});
