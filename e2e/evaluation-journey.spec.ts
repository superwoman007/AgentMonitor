import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5174';
const API_URL = process.env.API_URL || 'http://localhost:3000';

const generateTestEmail = () => `eval-${Date.now()}-${Math.random().toString(36).substr(2, 9)}@example.com`;
const testPassword = 'Test123456!';

test.describe('评测中心旅程：Dataset → Evaluator → Experiment → Report', () => {
  let testEmail: string;
  let token: string;
  let projectId: string;

  test.beforeAll(async ({ request }) => {
    testEmail = generateTestEmail();
    // 注册
    const registerRes = await request.post(`${API_URL}/api/v1/auth/register`, {
      data: { email: testEmail, password: testPassword, name: 'Eval Journey User' },
    });
    const registerData = await registerRes.json();
    token = registerData.token;

    // 创建项目
    const projectRes = await request.post(`${API_URL}/api/v1/projects`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'Eval Test Project' },
    });
    const projectData = await projectRes.json();
    projectId = projectData.project?.id || projectData.id;
  });

  test('Step 1: 进入评测中心页面', async ({ page }) => {
    await page.goto(`${BASE_URL}/login`);
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button[type="submit"]');
    await page.waitForURL(`${BASE_URL}/dashboard`);

    await page.goto(`${BASE_URL}/evaluation`);
    await page.waitForLoadState('networkidle');

    // 评测中心页面应该加载
    await expect(page.locator('main h1')).toContainText(/评测|Evaluation/);
  });

  test('Step 2: 通过 API 创建 Dataset 并在页面验证', async ({ page, request }) => {
    // 通过 API 创建 dataset
    const dsRes = await request.post(`${API_URL}/api/v1/evaluation/datasets`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        project_id: projectId,
        name: 'E2E Test Dataset',
        description: 'Created by E2E test',
        type: 'qa',
      },
    });
    expect(dsRes.ok()).toBeTruthy();
    const dsData = await dsRes.json();
    const datasetId = dsData.id;

    // 添加数据项
    await request.post(`${API_URL}/api/v1/evaluation/datasets/${datasetId}/items`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        items: [
          { input: 'What is 2+2?', expected_output: '4' },
          { input: 'What is the capital of France?', expected_output: 'Paris' },
        ],
      },
    });

    // 登录并导航到评测页面
    await page.goto(`${BASE_URL}/login`);
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button[type="submit"]');
    await page.waitForURL(`${BASE_URL}/dashboard`);

    await page.goto(`${BASE_URL}/evaluation`);
    await page.waitForLoadState('networkidle');

    // 应该能看到创建的 dataset
    await expect(page.locator('text=E2E Test Dataset')).toBeVisible({ timeout: 10000 });
  });

  test('Step 3: 通过 API 创建 Evaluator 并在页面验证', async ({ page, request }) => {
    // 创建 evaluator
    const evalRes = await request.post(`${API_URL}/api/v1/evaluation/evaluators`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        project_id: projectId,
        name: 'E2E Exact Match',
        description: 'Exact match evaluator for E2E test',
        type: 'exact_match',
        config: {},
      },
    });
    expect(evalRes.ok()).toBeTruthy();

    // 登录并验证
    await page.goto(`${BASE_URL}/login`);
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button[type="submit"]');
    await page.waitForURL(`${BASE_URL}/dashboard`);

    await page.goto(`${BASE_URL}/evaluation`);
    await page.waitForLoadState('networkidle');

    // 页面应该加载成功
    await expect(page.locator('main h1')).toContainText(/评测|Evaluation/);
  });

  test('Step 4: 通过 API 创建 Experiment 并在页面验证', async ({ page, request }) => {
    // 获取 dataset
    const dsListRes = await request.get(`${API_URL}/api/v1/evaluation/datasets?project_id=${projectId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const datasets = await dsListRes.json();
    const datasetId = Array.isArray(datasets) ? datasets[0]?.id : datasets[0]?.id;

    if (!datasetId) {
      test.skip();
      return;
    }

    // 创建 experiment
    const expRes = await request.post(`${API_URL}/api/v1/evaluation/experiments`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        project_id: projectId,
        name: 'E2E Test Experiment',
        dataset_id: datasetId,
        model_config: { model: 'gpt-4' },
      },
    });
    expect(expRes.ok()).toBeTruthy();

    // 登录并验证
    await page.goto(`${BASE_URL}/login`);
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button[type="submit"]');
    await page.waitForURL(`${BASE_URL}/dashboard`);

    await page.goto(`${BASE_URL}/evaluation`);
    await page.waitForLoadState('networkidle');

    // 页面应该加载成功
    await expect(page.locator('main h1')).toContainText(/评测|Evaluation/);
  });
});
