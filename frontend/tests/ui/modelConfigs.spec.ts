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

  test('供应商下拉框应包含国内供应商', async ({ page }) => {
    await page.click('button:has-text("创建"), button:has-text("Create Model Config")');
    const select = page.locator('select').first();
    await expect(select).toBeVisible({ timeout: 10000 });

    const options = await select.locator('option').allTextContents();
    expect(options).toContain('DeepSeek');
    expect(options).toContain('Kimi (Moonshot)');
    expect(options).toContain('GLM (智谱AI)');
    expect(options).toContain('豆包 (Doubao)');
    expect(options).toContain('MiMo (小米)');
  });

  test('选择国内供应商后模型下拉框应自动更新', async ({ page }) => {
    await page.click('button:has-text("创建"), button:has-text("Create Model Config")');

    // 选择 DeepSeek
    await page.locator('select').first().selectOption('deepseek');

    // 模型应为下拉框且包含 deepseek-v4-pro
    const modelSelect = page.locator('select').nth(1);
    await expect(modelSelect).toBeVisible({ timeout: 10000 });
    const modelOptions = await modelSelect.locator('option').allTextContents();
    expect(modelOptions).toContain('DeepSeek-V4-Pro');
  });

  test('选择 MiMo 后应显示 api-key 认证提示', async ({ page }) => {
    await page.click('button:has-text("创建"), button:has-text("Create Model Config")');
    await page.locator('select').first().selectOption('mimo');

    // 等待 api-key 提示文字出现
    await expect(
      page.locator('text=使用 api-key 请求头, text=Uses api-key header')
    ).toBeVisible({ timeout: 10000 });
  });

  test('每个配置卡片应有文档链接', async ({ page }) => {
    // 先创建一个配置
    await page.click('button:has-text("创建"), button:has-text("Create Model Config")');
    await page.fill('input[type="text"]', 'Docs Link Test');
    await page.fill('input[type="password"]', 'sk-docs-test');
    await page.click('button[type="submit"]');
    await expect(page.locator('text=Docs Link Test')).toBeVisible({ timeout: 10000 });

    // 验证文档链接存在
    await expect(page.locator('div:has-text("Docs Link Test")').locator('text=文档, text=Docs').first()).toBeVisible();
  });

  test('未登录时应该重定向到登录页', async ({ page }) => {
    await page.evaluate(() => localStorage.clear());
    await page.goto(`${BASE_URL}/model-configs`);
    await expect(page).toHaveURL(/\/login/);
  });
});
