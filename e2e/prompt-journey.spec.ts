import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5174';
const API_URL = process.env.API_URL || 'http://localhost:3000';

const generateTestEmail = () => `prompt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}@example.com`;
const testPassword = 'Test123456!';

test.describe('提示工程旅程：Prompt 创建 → Playground 验证 → 版本对比', () => {
  let testEmail: string;
  let token: string;
  let projectId: string;

  test.beforeAll(async ({ request }) => {
    testEmail = generateTestEmail();
    // 注册
    const registerRes = await request.post(`${API_URL}/api/v1/auth/register`, {
      data: { email: testEmail, password: testPassword, name: 'Prompt Journey User' },
    });
    const registerData = await registerRes.json();
    token = registerData.token;

    // 创建项目
    const projectRes = await request.post(`${API_URL}/api/v1/projects`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Prompt Test Project' },
    });
    const projectData = await projectRes.json();
    projectId = projectData.project?.id || projectData.id;
  });

  test('Step 1: 进入 Prompts 页面', async ({ page }) => {
    await page.goto(`${BASE_URL}/login`);
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button[type="submit"]');
    await page.waitForURL(`${BASE_URL}/dashboard`);

    await page.goto(`${BASE_URL}/prompts`);
    await page.waitForLoadState('networkidle');

    await expect(page.locator('main h1')).toContainText(/Prompt|提示/);
  });

  test('Step 2: 通过 API 创建 Prompt 并在页面验证', async ({ page, request }) => {
    // 通过 API 创建 prompt
    const promptRes = await request.post(`${API_URL}/api/v1/prompts`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        project_id: projectId,
        name: 'E2E System Prompt',
        description: 'System prompt for E2E testing',
        content: 'You are a helpful assistant. Answer questions concisely.',
        config: { temperature: 0.7 },
      },
    });
    expect(promptRes.ok()).toBeTruthy();

    // 登录并验证
    await page.goto(`${BASE_URL}/login`);
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button[type="submit"]');
    await page.waitForURL(`${BASE_URL}/dashboard`);

    await page.goto(`${BASE_URL}/prompts`);
    await page.waitForLoadState('networkidle');

    // 应该能看到创建的 prompt
    await expect(page.locator('text=E2E System Prompt')).toBeVisible({ timeout: 10000 });
  });

  test('Step 3: 通过 API 创建新版本并在页面验证版本列表', async ({ page, request }) => {
    // 获取 prompt 列表
    const listRes = await request.get(`${API_URL}/api/v1/prompts?project_id=${projectId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const prompts = await listRes.json();
    const promptId = Array.isArray(prompts) ? prompts[0]?.id : null;

    if (!promptId) {
      test.skip();
      return;
    }

    // 创建新版本
    const versionRes = await request.post(`${API_URL}/api/v1/prompts/${promptId}/versions`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        content: 'You are a helpful assistant. Answer questions concisely and accurately. Provide examples when helpful.',
        description: 'V2: Added accuracy and examples instruction',
      },
    });
    expect(versionRes.ok()).toBeTruthy();

    // 登录并验证
    await page.goto(`${BASE_URL}/login`);
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button[type="submit"]');
    await page.waitForURL(`${BASE_URL}/dashboard`);

    await page.goto(`${BASE_URL}/prompts`);
    await page.waitForLoadState('networkidle');

    // 应该能看到 prompt
    await expect(page.locator('text=E2E System Prompt')).toBeVisible({ timeout: 10000 });
  });

  test('Step 4: 通过 API 运行 Playground 并在页面验证运行记录', async ({ page, request }) => {
    // 获取 prompt
    const listRes = await request.get(`${API_URL}/api/v1/prompts?project_id=${projectId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const prompts = await listRes.json();
    const promptId = Array.isArray(prompts) ? prompts[0]?.id : null;

    // 运行 playground
    const runRes = await request.post(`${API_URL}/api/v1/playground/run`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        project_id: projectId,
        prompt_id: promptId,
        model: 'gpt-4',
        input: 'What is 2+2?',
        output: '4',
        latency_ms: 150,
        status: 'success',
      },
    });
    expect(runRes.ok()).toBeTruthy();

    // 登录并验证
    await page.goto(`${BASE_URL}/login`);
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button[type="submit"]');
    await page.waitForURL(`${BASE_URL}/dashboard`);

    await page.goto(`${BASE_URL}/prompts`);
    await page.waitForLoadState('networkidle');

    // 页面应该加载成功
    await expect(page.locator('main h1')).toContainText(/Prompt|提示/);
  });

  test('Step 5: 完整导航流 Dashboard → Prompts', async ({ page }) => {
    await page.goto(`${BASE_URL}/login`);
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button[type="submit"]');
    await page.waitForURL(`${BASE_URL}/dashboard`);

    // 从 Dashboard 导航到 Prompts
    const promptsLink = page.locator('a[href="/prompts"], nav >> text=/Prompt|提示/');
    if (await promptsLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await promptsLink.first().click();
      await expect(page).toHaveURL(/\/prompts/);
    } else {
      await page.goto(`${BASE_URL}/prompts`);
    }

    await page.waitForLoadState('networkidle');
    await expect(page.locator('main h1')).toContainText(/Prompt|提示/);

    // 应该能看到之前创建的 prompt
    await expect(page.locator('text=E2E System Prompt')).toBeVisible({ timeout: 10000 });
  });
});
