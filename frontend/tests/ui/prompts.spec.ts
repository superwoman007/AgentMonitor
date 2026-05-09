import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5174';

async function registerAndLogin(page: any, prefix: string) {
  const email = `${prefix}-${Date.now()}@example.com`;
  await page.goto(`${BASE_URL}/register`);
  await page.fill('input[placeholder="John Doe"]', `${prefix} Test`);
  await page.fill('input[type="email"]', email);
  const pwInputs = page.locator('input[type="password"]');
  await pwInputs.nth(0).fill('Test123456!');
  await pwInputs.nth(1).fill('Test123456!');
  await page.click('button[type="submit"]');
  await page.waitForURL(`${BASE_URL}/dashboard`, { timeout: 15000 });
}

test.describe('Prompts 页面', () => {
  test.beforeEach(async ({ page }) => {
    await registerAndLogin(page, 'prompt');
    await page.goto(`${BASE_URL}/prompts`);
    await page.waitForLoadState('networkidle');
  });

  test('应该显示 Prompt 工程标题', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Prompt 工程' })).toBeVisible({ timeout: 10000 });
  });

  test('应该有 Tab 切换', async ({ page }) => {
    // PromptsPage has tabs: prompts, versions, runs(playground), configs
    await expect(page.locator('button:has-text("Prompt 管理")')).toBeVisible({ timeout: 10000 });
  });

  test('应该有创建 Prompt 按钮', async ({ page }) => {
    await expect(page.locator('button:has-text("创建 Prompt"), button:has-text("Create Prompt")')).toBeVisible({ timeout: 10000 });
  });

  test('未登录时应该重定向到登录页', async ({ page }) => {
    await page.evaluate(() => localStorage.clear());
    await page.goto(`${BASE_URL}/prompts`);
    await expect(page).toHaveURL(/\/login/);
  });
});
