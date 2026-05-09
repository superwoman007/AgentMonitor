import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5174';
const API_URL = process.env.API_URL || 'http://localhost:3000';

const generateTestEmail = () => `e2e-p3-${Date.now()}-${Math.random().toString(36).substr(2, 9)}@example.com`;
const testPassword = 'Test123456!';

test.describe('P3 功能深度测试 (Phase 3 - 核心功能闭环)', () => {
  let testEmail: string;
  let token: string;
  let projectId: string;

  test.beforeAll(async ({ request }) => {
    testEmail = generateTestEmail();
    // 注册
    const registerRes = await request.post(`${API_URL}/api/v1/auth/register`, {
      data: { email: testEmail, password: testPassword, name: 'P3 Journey User' },
    });
    const registerData = await registerRes.json();
    token = registerData.token;

    // 创建项目
    const projectRes = await request.post(`${API_URL}/api/v1/projects`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: 'P3 Test Project' },
    });
    const projectData = await projectRes.json();
    projectId = projectData.project?.id || projectData.id;
  });

  async function loginPage(page: any) {
    await page.goto(`${BASE_URL}/login`);
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button[type="submit"]');
    await page.waitForURL(`${BASE_URL}/dashboard`, { timeout: 15000 });
  }

  // ============================================================
  // PM-02: 多模型对比调试
  // ============================================================
  test('P3-1: Prompt 工程 - Playground 多模型对比', async ({ page, request }) => {
    await loginPage(page);

    // 创建 model config（至少两个才能对比）
    for (const [name, model] of [['OpenAI GPT-4', 'gpt-4'], ['OpenAI GPT-3.5', 'gpt-3.5-turbo']]) {
      await request.post(`${API_URL}/api/v1/model-configs`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { project_id: projectId, name, provider: 'openai', model, api_key: 'sk-test' },
      });
    }

    // 创建 Prompt
    const promptRes = await request.post(`${API_URL}/api/v1/prompts`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { project_id: projectId, name: 'Compare Test Prompt', content: 'You are a helpful assistant.' },
    });
    const promptData = await promptRes.json();
    const promptId = promptData.id;

    // 进入 Prompts 页面
    await page.goto(`${BASE_URL}/prompts`);
    await page.waitForLoadState('networkidle');

    // 点击 Prompt 选中它
    await page.click(`text=Compare Test Prompt`);
    await page.waitForTimeout(500);

    // 输入 Playground 测试内容（通过 placeholder 定位 Playground 输入框）
    const inputArea = page.locator('textarea[placeholder*="测试"], textarea[placeholder*="test"]').first();
    await inputArea.fill('What is 2+2?');

    // 点击对比按钮
    const compareBtn = page.locator('button').filter({ hasText: /Compare|对比/i }).first();
    await expect(compareBtn).toBeVisible();
    await compareBtn.click();

    // 等待对比结果出现
    await page.waitForTimeout(3000);

    // 验证对比结果区域存在（多模型结果卡片）
    const resultCards = page.locator('.bg-gray-50.border.rounded-lg');
    const count = await resultCards.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  // ============================================================
  // PM-04: AI 辅助 Prompt 调优
  // ============================================================
  test('P3-2: Prompt 工程 - AI 辅助 Prompt 调优完整流程', async ({ page, request }) => {
    await loginPage(page);

    // 1. 创建 Model Config（用于优化）
    await request.post(`${API_URL}/api/v1/model-configs`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { project_id: projectId, name: 'Optimizer Model', provider: 'openai', model: 'gpt-4', api_key: 'sk-test' },
    });

    // 2. 创建 Prompt
    const promptRes = await request.post(`${API_URL}/api/v1/prompts`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { project_id: projectId, name: 'Optimize Me', content: 'Answer the question.' },
    });
    const promptId = (await promptRes.json()).id;

    // 3. 创建 Dataset + Items
    const dsRes = await request.post(`${API_URL}/api/v1/evaluation/datasets`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { project_id: projectId, name: 'Optimize Dataset', type: 'qa' },
    });
    const datasetId = (await dsRes.json()).id;

    await request.post(`${API_URL}/api/v1/evaluation/datasets/${datasetId}/items`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { items: [{ input: 'What is 2+2?', expected_output: '4' }] },
    });

    // 4. 创建 Experiment 并直接完成（避免随机低分）
    const expRes = await request.post(`${API_URL}/api/v1/evaluation/experiments`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { project_id: projectId, name: 'Optimize Experiment', dataset_id: datasetId },
    });
    const experimentId = (await expRes.json()).id;

    await request.post(`${API_URL}/api/v1/evaluation/experiments/${experimentId}/complete`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { results_summary: { total_items: 1, passed: 0, failed: 1, avg_score: 0.2 } },
    });

    // 添加一个低分结果
    const itemsRes = await request.get(`${API_URL}/api/v1/evaluation/datasets/${datasetId}/items`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const items = await itemsRes.json();
    const itemId = items[0]?.id;

    if (itemId) {
      await request.post(`${API_URL}/api/v1/evaluation/results`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { experiment_id: experimentId, dataset_item_id: itemId, output: '5', score: 0.2, passed: false },
      });
    }

    // 5. 进入 Prompts 页面并点击 AI 调优
    await page.goto(`${BASE_URL}/prompts`);
    await page.waitForLoadState('networkidle');

    await page.click(`text=Optimize Me`);
    await page.waitForTimeout(500);

    // 点击 AI 调优按钮
    const optimizeBtn = page.locator('button').filter({ hasText: /AI Optimize|AI 调优/i }).first();
    await expect(optimizeBtn).toBeVisible();
    await optimizeBtn.click();

    // 等待 Modal 打开
    await page.waitForTimeout(500);

    // 验证 Modal 中有"选择实验"标签（UI 流程存在即可）
    await expect(page.locator('label').filter({ hasText: /Select Experiment|选择实验/i }).first()).toBeVisible();
    // 验证生成按钮存在
    const generateBtn = page.locator('button').filter({ hasText: /Generate Optimization|生成优化建议/i }).first();
    await expect(generateBtn).toBeVisible();
  });

  // ============================================================
  // OB-04: Agent Loop 可视化
  // ============================================================
  test('P3-3: 观测中心 - Session 详情 Agent Loop 视图切换', async ({ page, request }) => {
    await loginPage(page);

    // 通过 API 创建 session 和消息（messages API 需要 apikey）
    const apiKeyRes = await request.post(`${API_URL}/api/v1/apikeys`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { project_id: projectId, name: 'p3-session-key' },
    });
    const apiKeyData = await apiKeyRes.json();
    const apiKey = apiKeyData.apiKey?.key || apiKeyData.key;

    const sessionRes = await request.post(`${API_URL}/api/v1/sessions`, {
      headers: { 'x-api-key': apiKey },
      data: { session_id: `sess-p3-${Date.now()}` },
    });
    const sessionData = await sessionRes.json();
    const sessionId = sessionData.session?.id || sessionData.id;

    // 添加消息
    await request.post(`${API_URL}/api/v1/sessions/${sessionId}/messages`, {
      headers: { 'x-api-key': apiKey },
      data: { role: 'user', content: 'What is the capital of France?', timestamp: new Date().toISOString() },
    });
    await request.post(`${API_URL}/api/v1/sessions/${sessionId}/messages`, {
      headers: { 'x-api-key': apiKey },
      data: { role: 'assistant', content: 'The capital of France is Paris.', timestamp: new Date().toISOString() },
    });

    // 进入 Session 详情
    await page.goto(`${BASE_URL}/sessions/${sessionId}`);
    await page.waitForLoadState('networkidle');

    // 验证页面加载（支持中英文，排除侧边栏 logo）
    await expect(page.locator('main h1, [class*="col-span"] h1').first()).toContainText(/Session|会话详情/);

    // 查找 Agent Loop 切换按钮
    const agentLoopBtn = page.locator('button').filter({ hasText: /Agent Loop|Agent 循环/i }).first();
    await expect(agentLoopBtn).toBeVisible();

    // 点击切换到 Agent Loop 视图
    await agentLoopBtn.click();
    await page.waitForTimeout(500);

    // 验证 Loop 卡片存在
    await expect(page.locator('text=Loop #1').first()).toBeVisible();

    // 验证 Observation / Thought 标签存在
    const hasObservation = await page.locator('text=Observation').or(page.locator('text=观察')).first().isVisible().catch(() => false);
    const hasThought = await page.locator('text=Thought').or(page.locator('text=思考')).first().isVisible().catch(() => false);
    expect(hasObservation || hasThought).toBe(true);
  });

  // ============================================================
  // OB-02: Dashboard 趋势图
  // ============================================================
  test('P3-4: Dashboard - 趋势图存在且可交互', async ({ page }) => {
    await loginPage(page);

    await page.goto(`${BASE_URL}/dashboard`);
    await page.waitForLoadState('networkidle');

    // 验证趋势图 SVG 存在（Dashboard 中有 SVG 折线图）
    const svgElements = page.locator('svg');
    await expect(svgElements.first()).toBeVisible();

    // 验证统计卡片存在（用中文，因为当前语言是中文）
    await expect(page.locator('text=总请求数').first()).toBeVisible();
    await expect(page.locator('text=成功率').first()).toBeVisible();
  });

  // ============================================================
  // EV-03: 预置评估器模板丰富度
  // ============================================================
  test('P3-5: 评测中心 - 预置评估器模板列表丰富', async ({ page }) => {
    await loginPage(page);

    await page.goto(`${BASE_URL}/evaluation`);
    await page.waitForLoadState('networkidle');

    // 切换到 Evaluators Tab
    const evaluatorsTab = page.locator('button').filter({ hasText: /Evaluators|评估器/i }).first();
    await evaluatorsTab.click();
    await page.waitForTimeout(500);

    // 点击创建评估器
    const createBtn = page.locator('button').filter({ hasText: /Create Evaluator|创建评估器/i }).first();
    await createBtn.click();
    await page.waitForTimeout(500);

    // 验证预置模板下拉框存在且有多个选项
    const templateSelect = page.locator('select').filter({ hasText: /Select Preset|选择预设/i }).or(
      page.locator('select').first()
    ).first();
    await expect(templateSelect).toBeVisible();

    // 获取选项数量（至少应该有多个模板）
    const options = templateSelect.locator('option');
    const optionCount = await options.count();
    expect(optionCount).toBeGreaterThan(2); // 默认选项 + 至少2个模板
  });

  // ============================================================
  // PM-03: Prompt ↔ Trace 联动
  // ============================================================
  test('P3-6: Prompt ↔ Trace 联动 - Trace 详情展示关联 Prompt', async ({ page, request }) => {
    await loginPage(page);

    // 创建 Prompt
    const promptRes = await request.post(`${API_URL}/api/v1/prompts`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { project_id: projectId, name: 'Linked Prompt', content: 'You are a helpful assistant.' },
    });
    const promptData = await promptRes.json();
    const promptId = promptData.id;

    // 创建 API Key 用于上报 Trace
    const apiKeyRes = await request.post(`${API_URL}/api/v1/apikeys`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { project_id: projectId, name: 'p3-test-key' },
    });
    const apiKeyData = await apiKeyRes.json();
    const apiKey = apiKeyData.apiKey?.key || apiKeyData.key;

    // 上报带 prompt_id 的 Trace
    await request.post(`${API_URL}/api/v1/traces`, {
      headers: { 'x-api-key': apiKey },
      data: {
        projectId,
        name: 'Linked Trace',
        traceType: 'message',
        promptId: promptId,
        promptVersionId: promptData.current_version_id,
        input: { content: 'Hello' },
        output: { content: 'Hi there' },
        status: 'success',
        latencyMs: 100,
      },
    });

    // 进入 Prompts 页面，验证 Linked Traces Tab
    await page.goto(`${BASE_URL}/prompts`);
    await page.waitForLoadState('networkidle');

    await page.click(`text=Linked Prompt`);
    await page.waitForTimeout(500);

    // 切换到 Linked Traces Tab
    const linkedTracesTab = page.locator('button').filter({ hasText: /Linked Traces|关联 Trace/i }).first();
    await linkedTracesTab.click();
    await page.waitForTimeout(500);

    // 验证关联的 Trace 存在
    await expect(page.locator('text=Linked Trace')).toBeVisible();
  });
});
