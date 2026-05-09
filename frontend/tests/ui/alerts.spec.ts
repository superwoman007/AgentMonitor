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

test.describe('Alerts 页面', () => {
  test.beforeEach(async ({ page }) => {
    await registerAndLogin(page, 'alert');
    await page.goto(`${BASE_URL}/alerts`);
    await page.waitForLoadState('networkidle');
  });

  test('应该显示告警管理标题', async ({ page }) => {
    await expect(page.getByRole('heading', { name: '告警管理' })).toBeVisible({ timeout: 10000 });
  });

  test('应该有添加告警按钮', async ({ page }) => {
    await expect(page.locator('button:has-text("添加"), button:has-text("Add Alert")')).toBeVisible({ timeout: 10000 });
  });

  test('应该有刷新按钮', async ({ page }) => {
    await expect(page.getByRole('button', { name: '刷新' })).toBeVisible({ timeout: 10000 });
  });

  test('未登录时应该重定向到登录页', async ({ page }) => {
    await page.evaluate(() => localStorage.clear());
    await page.goto(`${BASE_URL}/alerts`);
    await expect(page).toHaveURL(/\/login/);
  });
});
