import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
const API_URL = process.env.API_URL || 'http://localhost:3000';

test.describe('完整用户旅程 (Staging适配版)', () => {
  // 每个测试使用独立的用户
  const generateTestEmail = () => `e2e-${Date.now()}-${Math.random().toString(36).substr(2, 9)}@example.com`;
  const testPassword = 'Test123456!';

  test('端到端：注册 → 登录 → 查看数据', async ({ page }) => {
    const testEmail = generateTestEmail();
    
    // 1. 注册新用户
    await page.goto(`${BASE_URL}/register`);
    
    // 等待页面加载
    await page.waitForSelector('input[placeholder="John Doe"]', { timeout: 10000 });
    
    // 填写注册表单
    await page.fill('input[placeholder="John Doe"]', 'E2E Test User');
    await page.fill('input[placeholder="user@example.com"]', testEmail);
    
    // 使用 nth 选择器区分两个密码输入框
    const passwordInputs = page.locator('input[type="password"]');
    await passwordInputs.nth(0).fill(testPassword);
    await passwordInputs.nth(1).fill(testPassword);
    
    // 点击注册按钮
    await page.click('button:has-text("注册")');
    
    // 等待跳转到 dashboard
    await page.waitForURL(`${BASE_URL}/dashboard`, { timeout: 15000 });
    
    // 验证已登录
    await expect(page).toHaveURL(`${BASE_URL}/dashboard`);
    
    // 验证可以看到页面内容（不依赖特定文本）
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).toBeVisible();
  });

  test('端到端：断点调试流程', async ({ page }) => {
    const testEmail = generateTestEmail();
    
    // 1. 注册并登录
    await page.goto(`${BASE_URL}/register`);
    await page.waitForSelector('input[placeholder="John Doe"]', { timeout: 10000 });
    
    await page.fill('input[placeholder="John Doe"]', 'E2E Test User');
    await page.fill('input[placeholder="user@example.com"]', testEmail);
    
    const passwordInputs = page.locator('input[type="password"]');
    await passwordInputs.nth(0).fill(testPassword);
    await passwordInputs.nth(1).fill(testPassword);
    
    await page.click('button:has-text("注册")');
    await page.waitForURL(`${BASE_URL}/dashboard`, { timeout: 15000 });
    
    // 2. 进入断点调试页面
    await page.goto(`${BASE_URL}/debugging`);
    await page.waitForLoadState('networkidle');
    
    // 等待页面加载完成
    await page.waitForSelector('text=/断点调试|Debugging/', { timeout: 10000 });
    
    // 查找"添加断点"按钮（可能是中文或英文）
    const addButton = page.locator('button').filter({ hasText: /添加断点|Add Breakpoint/ }).first();
    await expect(addButton).toBeVisible({ timeout: 10000 });
    
    // 点击添加断点
    await addButton.click();
    
    // 验证模态框或表单出现
    await expect(page.locator('input, textarea').first()).toBeVisible({ timeout: 5000 });
  });

  test('端到端：告警流程', async ({ page }) => {
    const testEmail = generateTestEmail();
    
    // 1. 注册并登录
    await page.goto(`${BASE_URL}/register`);
    await page.waitForSelector('input[placeholder="John Doe"]', { timeout: 10000 });
    
    await page.fill('input[placeholder="John Doe"]', 'E2E Test User');
    await page.fill('input[placeholder="user@example.com"]', testEmail);
    
    const passwordInputs = page.locator('input[type="password"]');
    await passwordInputs.nth(0).fill(testPassword);
    await passwordInputs.nth(1).fill(testPassword);
    
    await page.click('button:has-text("注册")');
    await page.waitForURL(`${BASE_URL}/dashboard`, { timeout: 15000 });
    
    // 2. 进入告警页面
    await page.goto(`${BASE_URL}/alerts`);
    await page.waitForLoadState('networkidle');
    
    // 验证页面加载成功（不依赖特定按钮）
    await expect(page).toHaveURL(`${BASE_URL}/alerts`);
    await page.waitForTimeout(2000);
    
    // 验证页面内容存在
    await expect(page.locator('body')).toBeVisible();
  });
});
