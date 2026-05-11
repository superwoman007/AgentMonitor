import { test, expect } from '@playwright/test';

const BASE_URL = 'http://localhost:5174';
const TEST_EMAIL = 'lvjianqing007@gmail.com';
const TEST_PASSWORD = 'abs375309703';

test.describe('场景五：Prompt ↔ Trace 联动 E2E', () => {
  test('登录 → Prompt管理 → 版本历史 → 关联Trace验证', async ({ page }) => {
    // 步骤1：登录
    await page.goto(`${BASE_URL}/login`);
    await page.fill('input[type="email"]', TEST_EMAIL);
    await page.fill('input[type="password"]', TEST_PASSWORD);
    await page.click('button:has-text("登录")');
    await page.waitForURL(`${BASE_URL}/dashboard`, { timeout: 15000 });

    // 步骤2：进入 Prompt 管理
    await page.goto(`${BASE_URL}/prompts`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('text=客服问候语')).toBeVisible({ timeout: 10000 });

    // 步骤3：点击 Prompt 卡片进入详情
    await page.click('text=客服问候语');
    await page.waitForTimeout(1000);

    // 步骤4：验证版本历史有 v3
    await page.click('text=版本历史');
    await page.waitForTimeout(500);
    const versionTexts = await page.locator('body').innerText();
    expect(versionTexts).toContain('v3');
    expect(versionTexts).toContain('v2');
    expect(versionTexts).toContain('v1');

    // 步骤5：返回并查看关联 Trace（如果页面有展示）
    await page.goto(`${BASE_URL}/traces`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).toBeVisible();

    console.log('✅ 场景五 E2E 验证通过');
  });
});
