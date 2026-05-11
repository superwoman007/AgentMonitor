import { test, expect } from '@playwright/test';

const BASE_URL = 'http://localhost:5174';
const API_URL = 'http://localhost:3000/api/v1';

test.describe('登录功能 E2E 测试', () => {
  test('登录页面可正常加载，不会循环刷新', async ({ page }) => {
    await page.goto(`${BASE_URL}/login`);
    // 等待页面稳定，验证没有循环刷新
    await page.waitForTimeout(2000);
    const navigationCount = await page.evaluate(() => (window as any).__navCount || 0);
    // 如果循环刷新，URL 会不断变化或页面重载
    expect(page.url()).toContain('/login');
    await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.locator('button:has-text("登录")')).toBeVisible();
  });

  test('注册后登录成功', async ({ page, request }) => {
    const testEmail = `login-e2e-${Date.now()}@test.com`;
    const testPassword = 'TestPass123!';

    // 注册
    const res = await request.post(`${API_URL}/auth/register`, {
      data: { name: 'Login Test', email: testEmail, password: testPassword }
    });
    expect(res.status()).toBe(201);

    // 登录
    await page.goto(`${BASE_URL}/login`);
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button:has-text("登录")');
    await page.waitForURL(`${BASE_URL}/dashboard`, { timeout: 15000 });
    expect(page.url()).toContain('/dashboard');
  });

  test('错误密码登录失败', async ({ page, request }) => {
    const testEmail = `login-fail-${Date.now()}@test.com`;
    const testPassword = 'TestPass123!';

    await request.post(`${API_URL}/auth/register`, {
      data: { name: 'Fail Test', email: testEmail, password: testPassword }
    });

    await page.goto(`${BASE_URL}/login`);
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', 'WrongPass123!');
    await page.click('button:has-text("登录")');
    await page.waitForTimeout(2000);

    expect(page.url()).toContain('/login');
  });

  test('过期 token 不会导致登录页循环刷新', async ({ page, context }) => {
    // 先注册登录获取有效 token
    const testEmail = `expired-token-${Date.now()}@test.com`;
    const testPassword = 'TestPass123!';
    const res = await context.request.post(`${API_URL}/auth/register`, {
      data: { name: 'Expired Test', email: testEmail, password: testPassword }
    });
    const { token } = await res.json();

    // 在登录页注入过期/无效 token，模拟 persist 恢复旧 token 的场景
    await page.goto(`${BASE_URL}/login`);
    await page.evaluate((t) => {
      localStorage.setItem('auth-storage', JSON.stringify({ state: { token: t + '_invalid', user: null } }));
    }, token);

    // 刷新页面，让 zustand persist 恢复无效 token
    await page.reload();
    await page.waitForTimeout(3000);

    // 验证页面没有循环刷新，仍然稳定在登录页
    expect(page.url()).toContain('/login');
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
  });
});
