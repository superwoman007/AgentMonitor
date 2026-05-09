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

test.describe('Traces 页面', () => {
  test.beforeEach(async ({ page }) => {
    await registerAndLogin(page, 'trace');
    await page.goto(`${BASE_URL}/traces`);
    await page.waitForLoadState('networkidle');
  });

  test('应该显示观测中心标题', async ({ page }) => {
    // h1 in main content, not the h3 in sidebar nav
    await expect(page.getByRole('main').getByRole('heading', { name: '观测中心' })).toBeVisible({ timeout: 10000 });
  });

  test('应该显示筛选下拉框', async ({ page }) => {
    // TracesPage has 3 select dropdowns for filtering
    await expect(page.locator('select').first()).toBeVisible({ timeout: 10000 });
  });

  test('应该有刷新按钮', async ({ page }) => {
    await expect(page.getByRole('button', { name: '刷新' })).toBeVisible({ timeout: 10000 });
  });

  test('未登录时应该重定向到登录页', async ({ page }) => {
    await page.evaluate(() => localStorage.clear());
    await page.goto(`${BASE_URL}/traces`);
    await expect(page).toHaveURL(/\/login/);
  });
});
