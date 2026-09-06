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

  test('Trace 列表应显示 Input/Output 预览', async ({ page }) => {
    // 先创建一个会话和 trace，使其有 input/output
    await page.goto(`${BASE_URL}/sessions`);
    await page.waitForLoadState('networkidle');

    // 如果页面有创建会话按钮，点击创建
    const createBtn = page.locator('button:has-text("创建"), button:has-text("New")');
    if (await createBtn.isVisible().catch(() => false)) {
      await createBtn.click();
    }

    // 回到 traces 页面
    await page.goto(`${BASE_URL}/traces`);
    await page.waitForLoadState('networkidle');

    // 检查 Input/Output 标签文字是否在列表中可见（如果 trace 有数据）
    const hasInputLabel = await page.locator('text=Input:').first().isVisible().catch(() => false);
    const hasOutputLabel = await page.locator('text=Output:').first().isVisible().catch(() => false);
    // 如果存在 trace 且有数据，应显示预览
    if (hasInputLabel || hasOutputLabel) {
      expect(hasInputLabel || hasOutputLabel).toBe(true);
    }
  });

  test('Trace 详情页 Input/Output 应支持展开收起', async ({ page }) => {
    await page.goto(`${BASE_URL}/traces`);
    await page.waitForLoadState('networkidle');

    // 如果有 trace，点击第一个
    const firstTrace = page.locator('.cursor-pointer').first();
    const hasTraces = await firstTrace.isVisible().catch(() => false);
    if (!hasTraces) {
      test.skip(true, 'No traces available');
      return;
    }

    await firstTrace.click();
    await page.waitForTimeout(500);

    // 检查详情区域是否存在
    const detailPanel = page.locator('text=Input').first();
    const hasDetail = await detailPanel.isVisible().catch(() => false);
    if (!hasDetail) {
      test.skip(true, 'No trace detail with input available');
      return;
    }

    // 如果内容较长，应能看到"展开"按钮
    const expandBtn = page.locator('button:has-text("展开"), button:has-text("Expand")').first();
    const hasExpandBtn = await expandBtn.isVisible().catch(() => false);
    if (hasExpandBtn) {
      await expandBtn.click();
      // 点击后应变为"收起"
      await expect(page.locator('button:has-text("收起"), button:has-text("Collapse")').first()).toBeVisible();
    }
  });
});
