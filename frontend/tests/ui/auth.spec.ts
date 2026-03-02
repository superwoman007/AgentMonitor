import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
const testEmail = `test-ui-${Date.now()}@example.com`;
const testPassword = 'Test123456!';

test.describe('认证流程', () => {
  test('应该成功注册新用户', async ({ page }) => {
    await page.goto(`${BASE_URL}/register`);
    
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.fill('input[placeholder*="名字"]', 'UI Test User');
    
    await page.click('button:has-text("注册")');
    
    // 应该跳转到 Dashboard
    await expect(page).toHaveURL(`${BASE_URL}/dashboard`);
    await expect(page.locator('h1')).toContainText('仪表盘');
  });

  test('应该成功登录', async ({ page }) => {
    await page.goto(`${BASE_URL}/login`);
    
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', testPassword);
    
    await page.click('button:has-text("登录")');
    
    await expect(page).toHaveURL(`${BASE_URL}/dashboard`);
  });

  test('应该拒绝错误密码', async ({ page }) => {
    await page.goto(`${BASE_URL}/login`);
    
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', 'WrongPassword');
    
    await page.click('button:has-text("登录")');
    
    // 应该显示错误提示
    await expect(page.locator('text=/密码错误|登录失败/')).toBeVisible();
  });

  test('应该成功登出', async ({ page }) => {
    // 先登录
    await page.goto(`${BASE_URL}/login`);
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button:has-text("登录")');
    
    // 点击用户菜单
    await page.click('button:has-text("Test User")');
    await page.click('text=登出');
    
    // 应该跳转到登录页
    await expect(page).toHaveURL(`${BASE_URL}/login`);
  });
});
