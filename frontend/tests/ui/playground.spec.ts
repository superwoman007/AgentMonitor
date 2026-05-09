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

test.describe('Playground 页面', () => {
  test.beforeEach(async ({ page }) => {
    await registerAndLogin(page, 'pg');
    // Playground is a tab inside PromptsPage
    await page.goto(`${BASE_URL}/prompts`);
    await page.waitForLoadState('networkidle');
  });

  test('应该能切换到 Playground Tab', async ({ page }) => {
    const tab = page.locator('button:has-text("Playground")');
    await expect(tab).toBeVisible({ timeout: 10000 });
    await tab.click();
    // After clicking, playground heading should be visible in main content
    await expect(page.getByRole('main').getByRole('heading', { name: 'Playground' })).toBeVisible({ timeout: 5000 });
  });

  test('未登录时应该重定向到登录页', async ({ page }) => {
    await page.evaluate(() => localStorage.clear());
    await page.goto(`${BASE_URL}/prompts`);
    await expect(page).toHaveURL(/\/login/);
  });
});
