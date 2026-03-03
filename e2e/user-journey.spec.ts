import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
const API_URL = process.env.API_URL || 'http://localhost:3000';

test.describe('完整用户旅程 (Staging适配版)', () => {
  const testEmail = `e2e-${Date.now()}@example.com`;
  const testPassword = 'Test123456!';
  let apiKey: string;
  let projectId: string;

  // 在所有测试前创建用户和项目
  test.beforeAll(async ({ request }) => {
    // 注册用户
    const registerRes = await request.post(`${API_URL}/api/v1/auth/register`, {
      data: {
        email: testEmail,
        password: testPassword,
        name: 'E2E Test User'
      }
    });
    expect(registerRes.ok()).toBeTruthy();
    
    const { token } = await registerRes.json();
    
    // 创建项目
    const projectRes = await request.post(`${API_URL}/api/v1/projects`, {
      headers: {
        'Authorization': `Bearer ${token}`
      },
      data: {
        name: 'E2E Test Project',
        description: 'Test project for E2E tests'
      }
    });
    expect(projectRes.ok()).toBeTruthy();
    
    const project = await projectRes.json();
    projectId = project.id;
    
    // 生成 API Key
    const keyRes = await request.post(`${API_URL}/api/v1/projects/${projectId}/keys`, {
      headers: {
        'Authorization': `Bearer ${token}`
      },
      data: {
        name: 'E2E Test Key'
      }
    });
    expect(keyRes.ok()).toBeTruthy();
    
    const keyData = await keyRes.json();
    apiKey = keyData.key;
  });

  test('端到端：注册 → 创建项目 → 生成 Key → SDK 采集 → 查看数据', async ({ page }) => {
    // 1. 注册新用户
    await page.goto(`${BASE_URL}/register`);
    
    // 修复：使用正确的选择器，按顺序填写
    await page.fill('input[placeholder="John Doe"]', 'E2E Test User'); // 姓名输入框
    await page.fill('input[placeholder="user@example.com"]', testEmail); // 邮箱输入框
    
    // 使用 nth 选择器区分两个密码输入框
    const passwordInputs = page.locator('input[type="password"]');
    await passwordInputs.nth(0).fill(testPassword); // 第一个密码输入框
    await passwordInputs.nth(1).fill(testPassword); // 确认密码输入框
    
    await page.click('button:has-text("注册")');
    
    // 等待跳转到 dashboard，增加超时时间
    await expect(page).toHaveURL(`${BASE_URL}/dashboard`, { timeout: 10000 });
    
    // 2. 创建项目
    await page.goto(`${BASE_URL}/settings`);
    await page.click('button:has-text("创建项目")');
    await page.fill('input[placeholder*="项目名称"]', 'E2E Test Project');
    await page.click('button:has-text("创建")');
    
    await expect(page.locator('h3:has-text("E2E Test Project")')).toBeVisible();
    
    // 3. 生成 API Key
    await page.click('button:has-text("创建 API 密钥")');
    await page.fill('input[placeholder*="密钥名称"]', 'E2E Test Key');
    await page.click('button:has-text("创建")');
    
    // 显示完整密钥
    await page.click('button:has-text("显示 Key")');
    const keyElement = page.locator('code');
    apiKey = await keyElement.textContent() || '';
    
    expect(apiKey).toMatch(/^am_[a-zA-Z0-9]{32}$/);
    
    // 4. 使用 SDK 发送测试数据
    const response = await page.request.post(`${API_URL}/api/sessions`, {
      headers: {
        'X-API-Key': apiKey,
        'Content-Type': 'application/json'
      },
      data: {
        session_id: `e2e-session-${Date.now()}`,
        metadata: {
          test: true,
          environment: 'e2e'
        }
      }
    });
    
    expect(response.ok()).toBeTruthy();
    const session = await response.json();
    
    // 发送消息
    await page.request.post(`${API_URL}/api/sessions/${session.id}/messages`, {
      headers: {
        'X-API-Key': apiKey,
        'Content-Type': 'application/json'
      },
      data: {
        role: 'user',
        content: 'Hello from E2E test',
        timestamp: new Date().toISOString()
      }
    });
    
    await page.request.post(`${API_URL}/api/sessions/${session.id}/messages`, {
      headers: {
        'X-API-Key': apiKey,
        'Content-Type': 'application/json'
      },
      data: {
        role: 'assistant',
        content: 'Response from E2E test',
        timestamp: new Date().toISOString(),
        metadata: {
          model: 'gpt-4',
          tokens: 20,
          latency_ms: 150
        }
      }
    });
    
    // 5. 查看 Dashboard 数据
    await page.goto(`${BASE_URL}/dashboard`);
    await page.waitForTimeout(2000); // 等待 WebSocket 更新
    
    // 应该显示统计数据
    await expect(page.locator('text=/总请求数/')).toBeVisible();
    await expect(page.locator('text=/[1-9]\\d*/')).toBeVisible(); // 至少有 1 个请求
    
    // 6. 查看会话列表
    await page.goto(`${BASE_URL}/sessions`);
    await expect(page.locator(`text=/e2e-session-/`)).toBeVisible();
    
    // 7. 查看会话详情
    await page.click(`text=/e2e-session-/`);
    await expect(page.locator('text="Hello from E2E test"')).toBeVisible();
    await expect(page.locator('text="Response from E2E test"')).toBeVisible();
    
    // 8. 验证成本分析
    await page.goto(`${BASE_URL}/cost`);
    await expect(page.locator('text=/总成本|Total Cost/')).toBeVisible();
  });

  test('端到端：断点调试流程', async ({ page }) => {
    // 修复：使用正确的登录选择器
    await page.goto(`${BASE_URL}/login`);
    await page.fill('input[placeholder="user@example.com"]', testEmail); // 邮箱输入框
    await page.fill('input[type="password"]', testPassword); // 密码输入框
    await page.click('button:has-text("登录")');
    
    // 进入断点调试页面
    await page.goto(`${BASE_URL}/debugging`);
    
    // 创建断点
    await page.click('button:has-text("添加断点")');
    await page.fill('input[placeholder*="变量名"]', 'user_input');
    await page.fill('input[placeholder*="条件"]', 'length > 10');
    await page.click('button:has-text("保存")');
    
    await expect(page.locator('text="user_input"')).toBeVisible();
    
    // 使用 SDK 触发断点
    const response = await page.request.post(`${API_URL}/api/sessions`, {
      headers: {
        'X-API-Key': apiKey,
        'Content-Type': 'application/json'
      },
      data: {
        session_id: `debug-session-${Date.now()}`,
        breakpoints: [
          {
            variable: 'user_input',
            value: 'This is a long input that should trigger the breakpoint',
            condition: 'length > 10'
          }
        ]
      }
    });
    
    expect(response.ok()).toBeTruthy();
    
    // 刷新页面，应该看到触发的断点
    await page.reload();
    await expect(page.locator('text=/触发|Triggered/')).toBeVisible();
  });

  test('端到端：告警流程', async ({ page }) => {
    // 修复：使用正确的登录选择器
    await page.goto(`${BASE_URL}/login`);
    await page.fill('input[placeholder="user@example.com"]', testEmail); // 邮箱输入框
    await page.fill('input[type="password"]', testPassword); // 密码输入框
    await page.click('button:has-text("登录")');
    
    // 进入告警页面
    await page.goto(`${BASE_URL}/alerts`);
    
    // 修复：使用正确的按钮文本 "添加告警" 而不是 "创建告警"
    await page.click('button:has-text("添加告警")');
    await page.fill('input[placeholder*="告警名称"]', 'High Latency Alert');
    await page.selectOption('select[name="metric"]', 'latency');
    await page.selectOption('select[name="operator"]', '>');
    await page.fill('input[name="threshold"]', '1000');
    await page.click('button:has-text("保存")');
    
    await expect(page.locator('text="High Latency Alert"')).toBeVisible();
    
    // 使用 SDK 发送高延迟数据触发告警
    const sessionResponse = await page.request.post(`${API_URL}/api/sessions`, {
      headers: {
        'X-API-Key': apiKey,
        'Content-Type': 'application/json'
      },
      data: {
        session_id: `alert-session-${Date.now()}`
      }
    });
    
    const session = await sessionResponse.json();
    
    await page.request.post(`${API_URL}/api/sessions/${session.id}/messages`, {
      headers: {
        'X-API-Key': apiKey,
        'Content-Type': 'application/json'
      },
      data: {
        role: 'assistant',
        content: 'Slow response',
        timestamp: new Date().toISOString(),
        metadata: {
          model: 'gpt-4',
          tokens: 50,
          latency_ms: 2500 // 超过阈值
        }
      }
    });
    
    // 刷新页面，应该看到告警历史
    await page.reload();
    await page.waitForTimeout(1000);
    
    await expect(page.locator('text=/告警历史|Alert History/')).toBeVisible();
  });
});
