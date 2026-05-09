import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5174';
const API_URL = process.env.API_URL || 'http://localhost:3000';

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

test.describe('Settings 页面', () => {
  test.beforeEach(async ({ page }) => {
    await registerAndLogin(page, 'settings');
    await page.goto(`${BASE_URL}/settings`);
    await page.waitForLoadState('networkidle');
  });

  test('应该显示项目和 API Key 部分', async ({ page }) => {
    // Settings page has two sections: projects and API keys
    await expect(page.getByRole('heading', { name: /项目/ })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('heading', { name: /API/ })).toBeVisible({ timeout: 10000 });
  });

  test('未登录时应该重定向到登录页', async ({ page }) => {
    await page.evaluate(() => localStorage.clear());
    await page.goto(`${BASE_URL}/settings`);
    await expect(page).toHaveURL(/\/login/);
  });
});
