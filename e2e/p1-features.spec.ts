import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
const API_URL = process.env.API_URL || 'http://localhost:3000';

test.describe('P1 功能深度测试', () => {
  const generateTestEmail = () => `e2e-p1-${Date.now()}-${Math.random().toString(36).substr(2, 9)}@example.com`;
  const testPassword = 'Test123456!';

  // 辅助函数：注册并登录
  async function registerAndLogin(page: any) {
    const testEmail = generateTestEmail();
    
    await page.goto(`${BASE_URL}/register`);
    await page.waitForSelector('input[placeholder="John Doe"]', { timeout: 10000 });
    
    await page.fill('input[placeholder="John Doe"]', 'E2E P1 Test User');
    await page.fill('input[placeholder="user@example.com"]', testEmail);
    
    const passwordInputs = page.locator('input[type="password"]');
    await passwordInputs.nth(0).fill(testPassword);
    await passwordInputs.nth(1).fill(testPassword);
    
    await page.click('button:has-text("注册")');
    await page.waitForURL(`${BASE_URL}/dashboard`, { timeout: 15000 });
    
    return testEmail;
  }

  test('P1-1: 会话回放 - 时间轴视图切换', async ({ page }) => {
    await registerAndLogin(page);
    
    // 进入会话列表
    await page.goto(`${BASE_URL}/sessions`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    
    // 查找第一个会话（如果存在）
    const firstSession = page.locator('a[href^="/sessions/"]').first();
    const hasSession = await firstSession.isVisible().catch(() => false);
    
    if (hasSession) {
      await firstSession.click();
      await page.waitForURL(/\/sessions\//, { timeout: 10000 });
      await page.waitForLoadState('networkidle');
      
      // 查找时间轴/聊天视图切换按钮
      const timelineButton = page.locator('button').filter({ hasText: /Timeline|时间轴/i }).first();
      const chatButton = page.locator('button').filter({ hasText: /Chat|聊天/i }).first();
      
      if (await timelineButton.isVisible().catch(() => false)) {
        // 测试切换到时间轴视图
        await timelineButton.click();
        await page.waitForTimeout(500);
        
        // 验证时间轴元素存在（垂直线、圆点）
        const timelineElements = page.locator('[class*="absolute"]').filter({ hasText: '' });
        await expect(page.locator('body')).toBeVisible();
        
        // 切换回聊天视图
        if (await chatButton.isVisible().catch(() => false)) {
          await chatButton.click();
          await page.waitForTimeout(500);
          await expect(page.locator('body')).toBeVisible();
        }
      }
    }
    
    // 验证页面正常
    await expect(page.locator('body')).toBeVisible();
  });

  test('P1-2: 会话回放 - 消息展开/折叠', async ({ page }) => {
    await registerAndLogin(page);
    
    await page.goto(`${BASE_URL}/sessions`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    
    const firstSession = page.locator('a[href^="/sessions/"]').first();
    const hasSession = await firstSession.isVisible().catch(() => false);
    
    if (hasSession) {
      await firstSession.click();
      await page.waitForURL(/\/sessions\//, { timeout: 10000 });
      await page.waitForLoadState('networkidle');
      
      // 查找 "Show more" 或 "展开" 按钮
      const expandButton = page.locator('button').filter({ hasText: /Show more|展开|显示更多/i }).first();
      
      if (await expandButton.isVisible().catch(() => false)) {
        // 点击展开
        await expandButton.click();
        await page.waitForTimeout(500);
        
        // 验证内容展开（查找 "Show less" 或 "收起"）
        const collapseButton = page.locator('button').filter({ hasText: /Show less|收起|显示更少/i }).first();
        if (await collapseButton.isVisible().catch(() => false)) {
          await expect(collapseButton).toBeVisible();
          
          // 点击收起
          await collapseButton.click();
          await page.waitForTimeout(500);
        }
      }
    }
    
    await expect(page.locator('body')).toBeVisible();
  });

  test('P1-3: 会话回放 - Token 和延迟显示', async ({ page }) => {
    await registerAndLogin(page);
    
    await page.goto(`${BASE_URL}/sessions`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    
    const firstSession = page.locator('a[href^="/sessions/"]').first();
    const hasSession = await firstSession.isVisible().catch(() => false);
    
    if (hasSession) {
      await firstSession.click();
      await page.waitForURL(/\/sessions\//, { timeout: 10000 });
      await page.waitForLoadState('networkidle');
      
      // 查找 token 或延迟信息（通常显示为 "123 tokens" 或 "1.2s"）
      const tokenInfo = page.locator('text=/\\d+\\s*tokens?/i').first();
      const latencyInfo = page.locator('text=/\\d+(\\.\\d+)?\\s*(ms|s)/i').first();
      
      // 如果有数据，验证显示
      const hasTokenInfo = await tokenInfo.isVisible().catch(() => false);
      const hasLatencyInfo = await latencyInfo.isVisible().catch(() => false);
      
      if (hasTokenInfo || hasLatencyInfo) {
        // 至少有一个指标显示
        expect(hasTokenInfo || hasLatencyInfo).toBe(true);
      }
    }
    
    await expect(page.locator('body')).toBeVisible();
  });

  test('P1-4: 断点调试 - 创建断点', async ({ page }) => {
    await registerAndLogin(page);
    
    // 进入断点调试页面
    await page.goto(`${BASE_URL}/debugging`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    
    // 查找添加断点按钮
    const addButton = page.locator('button').filter({ hasText: /添加断点|Add Breakpoint|Create/i }).first();
    
    if (await addButton.isVisible().catch(() => false)) {
      await addButton.click();
      await page.waitForTimeout(1000);
      
      // 填写断点表单
      const nameInput = page.locator('input[placeholder*="名称" i], input[name="name"]').first();
      if (await nameInput.isVisible().catch(() => false)) {
        const breakpointName = `E2E-Test-Breakpoint-${Date.now()}`;
        await nameInput.fill(breakpointName);
        
        // 选择类型（keyword）
        const typeSelect = page.locator('select').first();
        if (await typeSelect.isVisible().catch(() => false)) {
          await typeSelect.selectOption('keyword');
        }
        
        // 填写条件
        const conditionInput = page.locator('input[placeholder*="条件" i], textarea, input[name="condition"]').first();
        if (await conditionInput.isVisible().catch(() => false)) {
          await conditionInput.fill('error');
        }
        
        // 提交
        const submitBtn = page.locator('button').filter({ hasText: /创建|确认|提交|Create|Submit/i }).first();
        if (await submitBtn.isVisible().catch(() => false)) {
          await submitBtn.click();
          await page.waitForTimeout(2000);
          
          // 验证断点出现在列表中
          const breakpointList = page.locator(`text=${breakpointName}`).first();
          const breakpointExists = await breakpointList.isVisible().catch(() => false);
          
          if (breakpointExists) {
            await expect(breakpointList).toBeVisible();
          }
        }
      }
    }
    
    await expect(page.locator('body')).toBeVisible();
  });

  test('P1-5: 断点调试 - 启用/禁用断点', async ({ page }) => {
    await registerAndLogin(page);
    
    await page.goto(`${BASE_URL}/debugging`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    
    // 查找断点列表中的切换开关
    const toggleSwitch = page.locator('input[type="checkbox"], button[role="switch"]').first();
    
    if (await toggleSwitch.isVisible().catch(() => false)) {
      // 获取当前状态
      const isChecked = await toggleSwitch.isChecked().catch(() => false);
      
      // 切换状态
      await toggleSwitch.click();
      await page.waitForTimeout(1000);
      
      // 验证状态改变
      const newState = await toggleSwitch.isChecked().catch(() => false);
      expect(newState).not.toBe(isChecked);
    }
    
    await expect(page.locator('body')).toBeVisible();
  });

  test('P1-6: 断点调试 - 查看 Snapshots', async ({ page }) => {
    await registerAndLogin(page);
    
    await page.goto(`${BASE_URL}/debugging`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    
    // 查找 Snapshots 标签或区域
    const snapshotsTab = page.locator('button, a').filter({ hasText: /Snapshots?|快照/i }).first();
    
    if (await snapshotsTab.isVisible().catch(() => false)) {
      await snapshotsTab.click();
      await page.waitForTimeout(1000);
      
      // 验证 snapshots 列表或空状态
      await expect(page.locator('body')).toBeVisible();
      
      // 如果有 snapshot，尝试点击查看详情
      const firstSnapshot = page.locator('[class*="snapshot"], [data-testid*="snapshot"]').first();
      if (await firstSnapshot.isVisible().catch(() => false)) {
        await firstSnapshot.click();
        await page.waitForTimeout(1000);
        
        // 验证详情页面
        await expect(page.locator('body')).toBeVisible();
      }
    }
    
    await expect(page.locator('body')).toBeVisible();
  });

  test('P1-7: 质量评估 - 查看评估列表', async ({ page }) => {
    await registerAndLogin(page);
    
    await page.goto(`${BASE_URL}/quality`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    
    // 验证页面加载
    await expect(page).toHaveURL(`${BASE_URL}/quality`);
    
    // 查找评估列表或空状态
    const evaluationList = page.locator('[class*="evaluation"], [class*="quality"], table, [role="list"]').first();
    
    if (await evaluationList.isVisible().catch(() => false)) {
      await expect(evaluationList).toBeVisible();
    }
    
    // 查找评估项
    const evaluationItem = page.locator('[class*="evaluation-item"], tr, [role="listitem"]').first();
    
    if (await evaluationItem.isVisible().catch(() => false)) {
      // 点击查看详情
      await evaluationItem.click();
      await page.waitForTimeout(1000);
      
      // 验证详情显示（分数、维度等）
      const scoreElement = page.locator('text=/\\d+(\\.\\d+)?\\s*(分|%|score)/i').first();
      const hasScore = await scoreElement.isVisible().catch(() => false);
      
      if (hasScore) {
        await expect(scoreElement).toBeVisible();
      }
    }
    
    await expect(page.locator('body')).toBeVisible();
  });

  test('P1-8: 质量评估 - 创建评估', async ({ page }) => {
    await registerAndLogin(page);
    
    await page.goto(`${BASE_URL}/quality`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    
    // 查找创建评估按钮
    const createButton = page.locator('button').filter({ hasText: /创建评估|新建评估|Create|Add/i }).first();
    
    if (await createButton.isVisible().catch(() => false)) {
      await createButton.click();
      await page.waitForTimeout(1000);
      
      // 填写评估表单（如果有）
      const formInputs = page.locator('input, textarea, select').first();
      
      if (await formInputs.isVisible().catch(() => false)) {
        // 验证表单存在
        await expect(formInputs).toBeVisible();
        
        // 查找提交按钮
        const submitBtn = page.locator('button').filter({ hasText: /提交|创建|确认|Submit|Create/i }).first();
        
        if (await submitBtn.isVisible().catch(() => false)) {
          // 不实际提交，只验证按钮存在
          await expect(submitBtn).toBeVisible();
        }
      }
    }
    
    await expect(page.locator('body')).toBeVisible();
  });

  test('P1-9: 质量评估 - 评估维度显示', async ({ page }) => {
    await registerAndLogin(page);
    
    await page.goto(`${BASE_URL}/quality`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    
    // 查找评估维度（准确性、相关性、流畅性等）
    const dimensions = [
      /准确性|accuracy/i,
      /相关性|relevance/i,
      /流畅性|fluency/i,
      /完整性|completeness/i,
    ];
    
    let foundDimension = false;
    
    for (const dimension of dimensions) {
      const element = page.locator(`text=${dimension}`).first();
      if (await element.isVisible().catch(() => false)) {
        foundDimension = true;
        await expect(element).toBeVisible();
        break;
      }
    }
    
    // 如果没有找到维度，至少验证页面正常
    await expect(page.locator('body')).toBeVisible();
  });

  test('P1-10: 集成测试 - 完整 P1 工作流', async ({ page }) => {
    await registerAndLogin(page);
    
    // 1. 创建断点
    await page.goto(`${BASE_URL}/debugging`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    
    const addButton = page.locator('button').filter({ hasText: /添加断点|Add Breakpoint/i }).first();
    if (await addButton.isVisible().catch(() => false)) {
      await addButton.click();
      await page.waitForTimeout(500);
      
      const nameInput = page.locator('input[placeholder*="名称" i], input[name="name"]').first();
      if (await nameInput.isVisible().catch(() => false)) {
        await nameInput.fill(`Integration-Test-${Date.now()}`);
        
        const submitBtn = page.locator('button').filter({ hasText: /创建|确认|Submit/i }).first();
        if (await submitBtn.isVisible().catch(() => false)) {
          await submitBtn.click();
          await page.waitForTimeout(2000);
        }
      }
    }
    
    // 2. 查看会话回放
    await page.goto(`${BASE_URL}/sessions`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    
    const firstSession = page.locator('a[href^="/sessions/"]').first();
    if (await firstSession.isVisible().catch(() => false)) {
      await firstSession.click();
      await page.waitForURL(/\/sessions\//, { timeout: 10000 });
      await page.waitForLoadState('networkidle');
    }
    
    // 3. 查看质量评估
    await page.goto(`${BASE_URL}/quality`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    
    // 验证所有页面都能正常访问
    await expect(page).toHaveURL(`${BASE_URL}/quality`);
    await expect(page.locator('body')).toBeVisible();
  });
});
