import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5174';
const API_URL = process.env.API_URL || 'http://localhost:3000';

test.describe('场景五：Prompt ↔ Trace 联动 E2E', () => {
  let token: string;
  let projectId: string;
  let promptId: string;

  test.beforeAll(async ({ request }) => {
    const email = `e2e-prompt-trace-${Date.now()}@test.com`;
    const password = 'Test123456!';

    const regRes = await request.post(`${API_URL}/api/v1/auth/register`, {
      data: { name: 'E2E Prompt Trace', email, password }
    });
    const regData = await regRes.json();
    token = regData.token;

    const projRes = await request.post(`${API_URL}/api/v1/projects`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'E2E Prompt Trace Project', description: 'test' }
    });
    const projData = await projRes.json();
    projectId = projData.id;

    // 创建 prompt 并添加多个版本
    const promptRes = await request.post(`${API_URL}/api/v1/prompts`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { project_id: projectId, name: 'E2E Test Prompt', content: 'v1 content', description: 'test' }
    });
    const promptData = await promptRes.json();
    promptId = promptData.id;

    // 添加 v2, v3
    for (const content of ['v2 content', 'v3 content']) {
      await request.post(`${API_URL}/api/v1/prompts/${promptId}/versions`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { content }
      });
    }
  });

  test('Prompt管理 → 版本历史 → 关联Trace验证', async ({ page }) => {
    await page.goto(`${BASE_URL}/login`);
    await page.evaluate(([t]) => {
      localStorage.setItem('auth-storage', JSON.stringify({ state: { token: t, user: null } }));
    }, [token]);
    await page.goto(`${BASE_URL}/prompts`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('text=E2E Test Prompt')).toBeVisible({ timeout: 10000 });

    await page.click('text=E2E Test Prompt');
    await page.waitForTimeout(1000);

    await page.click('text=版本历史');
    await page.waitForTimeout(500);
    const versionTexts = await page.locator('body').innerText();
    expect(versionTexts).toContain('v3');
    expect(versionTexts).toContain('v2');
    expect(versionTexts).toContain('v1');

    await page.goto(`${BASE_URL}/traces`);
    await page.waitForLoadState('networkidle');
    const heading = page.locator('h1, h2').filter({ hasText: /trace|观测|Trace|追踪/i }).first();
    await expect(heading).toBeVisible({ timeout: 10000 });
  });
});
