import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5174';

async function registerAndLogin(page: any, prefix: string) {
  const email = `${prefix}-${Date.now()}@example.com`;
  await page.goto(`${BASE_URL}/register`);
  await page.fill('input[placeholder="John Doe"]', `${prefix} Test`);
  await page.fill('input[type="email"]', email);
  const pwInputs = page.locator('input[type="password"');
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

  test('应该能创建模型配置', async ({ page }) => {
    await page.click('button:has-text("创建"), button:has-text("Create Model Config")');
    await page.fill('input[type="text"]', 'Test GPT-4');
    // Provider 默认 openai，model 默认 gpt-4o
    await page.fill('input[type="password"]', 'sk-test-create-key');
    await page.click('button[type="submit"]');

    await expect(page.locator('text=Test GPT-4')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=gpt-4o')).toBeVisible();
  });

  test('应该能编辑模型配置', async ({ page }) => {
    // 先创建一个
    await page.click('button:has-text("创建"), button:has-text("Create Model Config")');
    await page.fill('input[type="text"]', 'Edit Target');
    await page.fill('input[type="password"]', 'sk-edit-key');
    await page.click('button[type="submit"]');
    await expect(page.locator('text=Edit Target')).toBeVisible({ timeout: 10000 });

    // 点击编辑
    await page.locator('div:has-text("Edit Target")').locator('text=编辑, text=Edit').first().click();
    await page.fill('input[type="text"]', 'Edited Name');
    await page.click('button[type="submit"]');

    await expect(page.locator('text=Edited Name')).toBeVisible({ timeout: 10000 });
  });

  test('应该能测试模型连通性', async ({ page }) => {
    // 先创建一个
    await page.click('button:has-text("创建"), button:has-text("Create Model Config")');
    await page.fill('input[type="text"]', 'Test Connection');
    await page.fill('input[type="password"]', 'sk-invalid-key-for-test');
    await page.click('button[type="submit"]');
    await expect(page.locator('text=Test Connection')).toBeVisible({ timeout: 10000 });

    // 点击测试
    await page.locator('div:has-text("Test Connection")').locator('text=测试连通性, text=Test Connection').first().click();

    // 等待测试完成（成功或失败都应该有结果提示）
    await expect(
      page.locator('text=连接成功, text=Connection succeeded, text=连接失败, text=Connection failed').first()
    ).toBeVisible({ timeout: 15000 });
  });

  test('未登录时应该重定向到登录页', async ({ page }) => {
    await page.evaluate(() => localStorage.clear());
    await page.goto(`${BASE_URL}/model-configs`);
    await expect(page).toHaveURL(/\/login/);
  });
});
