import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
let authToken: string;

test.beforeAll(async ({ request }) => {
  // 创建测试用户并获取 token
  const testEmail = `test-settings-${Date.now()}@example.com`;
  const response = await request.post(`${BASE_URL}/api/auth/register`, {
    data: {
      email: testEmail,
      password: 'Test123456!',
      name: 'Settings Test User'
    }
  });
  
  const body = await response.json();
  authToken = body.token;
});

test.describe('Settings 页面', () => {
  test.beforeEach(async ({ page }) => {
    // 设置 token 到 localStorage
    await page.goto(BASE_URL);
    await page.evaluate((token) => {
      localStorage.setItem('token', token);
    }, authToken);
    
    await page.goto(`${BASE_URL}/settings`);
  });

  test('应该显示项目和 API Key 部分', async ({ page }) => {
    await expect(page.locator('h2:has-text("项目")')).toBeVisible();
    await expect(page.locator('h2:has-text("API 密钥")')).toBeVisible();
  });

  test('应该成功创建项目', async ({ page }) => {
    await page.click('button:has-text("创建项目")');
    
    // 填写项目信息
    await page.fill('input[placeholder*="项目名称"]', 'UI Test Project');
    await page.fill('textarea[placeholder*="描述"]', 'Created by UI test');
    
    await page.click('button:has-text("创建")');
    
    // 应该显示新项目
    await expect(page.locator('h3:has-text("UI Test Project")')).toBeVisible();
  });

  test('应该成功创建 API Key', async ({ page }) => {
    await page.click('button:has-text("创建 API 密钥")');
    
    await page.fill('input[placeholder*="密钥名称"]', 'UI Test Key');
    
    await page.click('button:has-text("创建")');
    
    // 应该显示新 Key（带前缀）
    await expect(page.locator('text=/am_[a-zA-Z0-9]+/')).toBeVisible();
  });

  test('应该成功显示完整密钥', async ({ page }) => {
    // 先创建一个 Key
    await page.click('button:has-text("创建 API 密钥")');
    await page.fill('input[placeholder*="密钥名称"]', 'Show Key Test');
    await page.click('button:has-text("创建")');
    
    // 点击「显示 Key」
    await page.click('button:has-text("显示 Key")');
    
    // 应该显示完整密钥（32 字符）
    await expect(page.locator('code:has-text(/am_[a-zA-Z0-9]{32}/)')).toBeVisible();
    
    // 应该有复制按钮
    await expect(page.locator('button:has-text("复制")')).toBeVisible();
  });

  test('应该成功隐藏密钥', async ({ page }) => {
    // 先显示密钥
    await page.click('button:has-text("显示 Key")');
    await expect(page.locator('code')).toBeVisible();
    
    // 点击「隐藏」
    await page.click('button:has-text("隐藏")');
    
    // 密钥应该消失
    await expect(page.locator('code')).not.toBeVisible();
  });

  test('应该成功复制密钥', async ({ page, context }) => {
    // 授予剪贴板权限
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    
    // 显示密钥
    await page.click('button:has-text("显示 Key")');
    
    // 点击复制
    await page.click('button:has-text("复制")');
    
    // 验证剪贴板内容
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText).toMatch(/^am_[a-zA-Z0-9]{32}$/);
  });

  test('应该成功吊销 API Key', async ({ page }) => {
    // 先创建一个 Key
    await page.click('button:has-text("创建 API 密钥")');
    await page.fill('input[placeholder*="密钥名称"]', 'Revoke Test Key');
    await page.click('button:has-text("创建")');
    
    // 点击「吊销」
    await page.click('button:has-text("吊销")');
    
    // 确认对话框
    page.on('dialog', dialog => dialog.accept());
    
    // Key 应该标记为「已吊销」
    await expect(page.locator('span:has-text("已吊销")')).toBeVisible();
  });

  test('应该成功编辑项目', async ({ page }) => {
    // 点击「编辑」
    await page.click('button:has-text("编辑")');
    
    // 修改项目名称
    await page.fill('input[value*="UI Test Project"]', 'Updated Project Name');
    
    await page.click('button:has-text("保存")');
    
    // 应该显示更新后的名称
    await expect(page.locator('h3:has-text("Updated Project Name")')).toBeVisible();
  });
});
