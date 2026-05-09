import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5174';
const testPassword = 'Test123456!';

async function registerUser(page: any, prefix: string) {
  const email = `${prefix}-${Date.now()}@example.com`;
  await page.goto(`${BASE_URL}/register`);
  await page.fill('input[placeholder="John Doe"]', `${prefix} Test`);
  await page.fill('input[type="email"]', email);
  const pwInputs = page.locator('input[type="password"]');
  await pwInputs.nth(0).fill(testPassword);
  await pwInputs.nth(1).fill(testPassword);
  await page.click('button[type="submit"]');
  await page.waitForURL(`${BASE_URL}/dashboard`, { timeout: 15000 });
  return email;
}

test.describe('认证流程', () => {
  test('应该成功注册新用户', async ({ page }) => {
    await registerUser(page, 'auth-reg');
    await expect(page).toHaveURL(`${BASE_URL}/dashboard`);
    // Scope to main content to avoid matching sidebar h1 "AgentMonitor"
    await expect(page.getByRole('main').getByRole('heading', { name: '仪表盘' })).toBeVisible({ timeout: 10000 });
  });

  test('应该成功登录', async ({ page }) => {
    const email = await registerUser(page, 'auth-login');
    // Logout by clearing localStorage
    await page.evaluate(() => localStorage.clear());
    await page.goto(`${BASE_URL}/login`);
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(`${BASE_URL}/dashboard`, { timeout: 15000 });
  });

  test('应该拒绝错误密码', async ({ page }) => {
    const email = await registerUser(page, 'auth-wrong');
    await page.evaluate(() => localStorage.clear());
    await page.goto(`${BASE_URL}/login`);
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', 'WrongPassword');
    await page.click('button[type="submit"]');
    // Error message appears somewhere on the page after failed login
    // Check that we're still on the login page (not redirected to dashboard)
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
  });

  test('应该成功登出', async ({ page }) => {
    await registerUser(page, 'auth-logout');
    // Logout uses confirm() dialog triggered by clicking user button in header
    // Set up dialog handler BEFORE clicking
    page.on('dialog', async (dialog: any) => {
      // The dialog text is "退出登录?"
      await dialog.accept();
    });
    // Click the user button in the header (it shows user name/email)
    const userBtn = page.locator('header button:has-text("Test")');
    await expect(userBtn).toBeVisible({ timeout: 10000 });
    await userBtn.click();
    // After accepting the confirm dialog, should redirect to login
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
  });
});
