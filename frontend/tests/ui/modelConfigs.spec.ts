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

test.describe('ModelConfigs 页面', () => {
  test.beforeEach(async ({ page }) => {
    await registerAndLogin(page, 'mc');
    await page.goto(`${BASE_URL}/model-configs`);
    await page.waitForLoadState('networkidle');
  });

  test('应该显示模型配置标题', async ({ page }) => {
    await expect(page.getByRole('heading', { name: '模型配置' })).toBeVisible({ timeout: 10000 });
  });

  test('应该有创建模型配置按钮', async ({ page }) => {
    await expect(page.locator('button:has-text("创建"), button:has-text("Create Model Config")')).toBeVisible({ timeout: 10000 });
  });

  test('未登录时应该重定向到登录页', async ({ page }) => {
    await page.evaluate(() => localStorage.clear());
    await page.goto(`${BASE_URL}/model-configs`);
    await expect(page).toHaveURL(/\/login/);
  });
});
