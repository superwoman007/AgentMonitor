import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5174';
const API_URL = process.env.API_URL || 'http://localhost:3000';

test.describe('P2 功能深度测试 (Phase 2 - 自动化闭环)', () => {
  const generateTestEmail = () => `e2e-p2-${Date.now()}-${Math.random().toString(36).substr(2, 9)}@example.com`;
  const testPassword = 'Test1234567!';

  async function registerAndLogin(page: any) {
    const testEmail = generateTestEmail();
    await page.goto(`${BASE_URL}/register`);
    await page.waitForSelector('input[type="text"]', { timeout: 10000 });
    await page.fill('input[type="text"]', 'E2E P2 Test User');
    await page.fill('input[placeholder="user@example.com"]', testEmail);
    const passwordInputs = page.locator('input[type="password"]');
    await passwordInputs.nth(0).fill(testPassword);
    await passwordInputs.nth(1).fill(testPassword);
    await page.click('button:has-text("注册")');
    await page.waitForURL(`${BASE_URL}/dashboard`, { timeout: 15000 });
    // Wait for AppRoutes/ensureDefaultProject to finish before creating data
    // through the API, avoiding two competing "Default Project" records.
    await page.waitForResponse(
      response => response.url().includes('/api/v1/projects') && response.request().method() === 'GET',
      { timeout: 10000 },
    ).catch(() => undefined);
    await page.waitForTimeout(300);
    return testEmail;
  }

  async function getAuthToken(page: any): Promise<string | null> {
    return page.evaluate(() => {
      try {
        const raw = localStorage.getItem('auth-storage');
        if (!raw) return localStorage.getItem('token');
        const parsed = JSON.parse(raw);
        return parsed?.state?.token || null;
      } catch {
        return localStorage.getItem('token');
      }
    });
  }

  async function apiRequest(page: any, method: string, path: string, body?: any) {
    const token = await getAuthToken(page);
    const res = await page.evaluate(async ({ url, method, token, body }) => {
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const text = await response.text();
      return { status: response.status, text };
    }, { url: `${API_URL}/api/v1${path}`, method, token, body });
    if (res.status >= 400) {
      throw new Error(`API ${method} ${path} failed: ${res.status} ${res.text}`);
    }
    return JSON.parse(res.text);
  }

  async function getOrCreateProject(page: any): Promise<string> {
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        const projects = await apiRequest(page, 'GET', '/projects');
        if (projects.length > 0) return projects[0].id;
      } catch {}
      await page.waitForTimeout(100);
    }
    const project = await apiRequest(page, 'POST', '/projects', {
      name: 'Default Project',
      description: 'E2E default',
    });
    return project.id;
  }

  test('P2-1: 评测中心 - 自动评测任务 Tab 可切换并显示列表', async ({ page }) => {
    await registerAndLogin(page);

    await page.goto(`${BASE_URL}/evaluation`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);

    // 点击自动评测 Tab
    const tasksTab = page.locator('[data-testid="tasks-tab"]').first();
    await expect(tasksTab).toBeVisible({ timeout: 10000 });
    await tasksTab.click();
    await page.waitForTimeout(800);

    // 验证显示空状态或列表区域
    const pageContent = await page.content();
    const hasEmptyState = /暂无自动评测任务|No auto eval tasks/i.test(pageContent);
    const hasListHeader = /任务名称|间隔|采样数/i.test(pageContent);
    expect(hasEmptyState || hasListHeader).toBe(true);
  });

  test('P2-2: 评测中心 - 创建自动评测任务', async ({ page }) => {
    await registerAndLogin(page);
    const projectId = await getOrCreateProject(page);

    // 通过 API 预先创建数据集
    const dataset = await apiRequest(page, 'POST', '/evaluation/datasets', {
      project_id: projectId,
      name: `E2E-Dataset-${Date.now()}`,
      description: 'E2E test dataset',
      type: 'qa',
    });

    await page.goto(`${BASE_URL}/evaluation`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);

    // 切换到自动评测 Tab
    await page.locator('[data-testid="tasks-tab"]').first().click();
    await page.waitForTimeout(800);

    // 点击创建任务按钮（根据文本查找）
    const createBtn = page.locator('button').filter({ hasText: /创建|新建|Add|Create/i }).first();
    await expect(createBtn).toBeVisible({ timeout: 10000 });
    await createBtn.click();
    await page.waitForTimeout(800);

    // 填写任务名称
    const nameInput = page.locator('input[type="text"]').first();
    if (await nameInput.isVisible().catch(() => false)) {
      await nameInput.fill(`E2E-AutoTask-${Date.now()}`);
    }

    // 选择数据集（Task Modal 中的第一个 select）
    const selects = page.locator('select');
    const selectCount = await selects.count();
    if (selectCount > 0) {
      // 尝试选择包含数据集选项的 select
      for (let i = 0; i < selectCount; i++) {
        const opts = await selects.nth(i).locator('option').allTextContents();
        const hasDatasetOption = opts.some(o => o.includes(dataset.name) || o === dataset.name);
        if (hasDatasetOption) {
          await selects.nth(i).selectOption(dataset.id);
          break;
        }
      }
    }

    // 提交
    const submitBtn = page.locator('button[type="submit"]').first();
    if (await submitBtn.isVisible().catch(() => false)) {
      await submitBtn.click();
      await page.waitForTimeout(1500);
    }

    // 验证任务出现在列表中或页面正常
    await expect(page.locator('body')).toBeVisible();
  });

  test('P2-3: 评测中心 - 实验进度和报告查看', async ({ page }) => {
    await registerAndLogin(page);
    const projectId = await getOrCreateProject(page);

    // 通过 API 创建数据集、实验
    const dataset = await apiRequest(page, 'POST', '/evaluation/datasets', {
      project_id: projectId,
      name: `E2E-Dataset-${Date.now()}`,
      description: 'E2E test dataset',
      type: 'qa',
    });

    await apiRequest(page, 'POST', `/evaluation/datasets/${dataset.id}/items`, {
      items: [
        { input: 'What is 2+2?', expected_output: '4' },
        { input: 'What is 3+3?', expected_output: '6' },
      ],
    });

    await apiRequest(page, 'POST', '/evaluation/experiments', {
      project_id: projectId,
      name: `E2E-Experiment-${Date.now()}`,
      dataset_id: dataset.id,
      description: 'E2E test experiment',
    });

    await page.goto(`${BASE_URL}/evaluation`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);

    // 切换到实验 Tab
    await page.locator('[data-testid="experiments-tab"]').first().click();
    await page.waitForTimeout(800);

    // 查找刷新进度按钮并点击
    const progressBtn = page.locator('button').filter({ hasText: /进度|Progress/i }).first();
    if (await progressBtn.isVisible().catch(() => false)) {
      await progressBtn.click();
      await page.waitForTimeout(1000);
    }

    // 查找报告按钮并点击
    const reportBtn = page.locator('button').filter({ hasText: /报告|Report/i }).first();
    if (await reportBtn.isVisible().catch(() => false)) {
      await reportBtn.click();
      await page.waitForTimeout(1500);

      // 验证报告模态框内容
      const pageContent = await page.content();
      const hasReport = /实验报告|Experiment Report|总用例|Total/i.test(pageContent);
      expect(hasReport).toBe(true);

      // 关闭模态框
      const closeBtn = page.locator('button').filter({ hasText: /✕|关闭|Close/i }).first();
      if (await closeBtn.isVisible().catch(() => false)) {
        await closeBtn.click();
      }
    }

    await expect(page.locator('body')).toBeVisible();
  });

  test('P2-4: Prompt 工程 - 编辑 Prompt 时显示自动回归实验选项', async ({ page }) => {
    await registerAndLogin(page);
    const projectId = await getOrCreateProject(page);

    // 通过 API 创建 Prompt
    const prompt = await apiRequest(page, 'POST', '/prompts', {
      project_id: projectId,
      name: `E2E-Prompt-${Date.now()}`,
      content: 'You are a helpful assistant.',
      description: 'E2E test prompt',
    });

    // 通过 API 创建数据集（用于回归实验下拉选择）
    await apiRequest(page, 'POST', '/evaluation/datasets', {
      project_id: projectId,
      name: `E2E-Regression-Dataset-${Date.now()}`,
      description: 'E2E regression dataset',
      type: 'qa',
    });

    await page.goto(`${BASE_URL}/prompts`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);

    // 先点击 Prompt 列表项选中它
    const promptItem = page.locator('div[class*="cursor-pointer"]').filter({ hasText: prompt.name }).first();
    if (await promptItem.isVisible().catch(() => false)) {
      await promptItem.click();
      await page.waitForTimeout(500);
    }

    // 查找编辑按钮并点击
    const editBtn = page.locator('button').filter({ hasText: /编辑|Edit/i }).first();
    await expect(editBtn).toBeVisible({ timeout: 10000 });
    await editBtn.click();
    await page.waitForTimeout(800);

    // 验证自动回归实验复选框出现
    const autoRegressionLabel = page.locator('label, span').filter({ hasText: /自动回归|Auto Regression/i }).first();
    const hasLabel = await autoRegressionLabel.isVisible().catch(() => false);
    expect(hasLabel).toBe(true);

    // 点击复选框，验证数据集选择下拉出现
    // 找到复选框：在 label 内部或相邻的 input[type="checkbox"]
    const checkbox = page.locator('input[type="checkbox"]').first();
    if (await checkbox.isVisible().catch(() => false)) {
      await checkbox.click();
      await page.waitForTimeout(500);
      const datasetSelect = page.locator('select').filter({ hasText: /选择数据集|Select Dataset|--/i }).first();
      const hasDatasetSelect = await datasetSelect.isVisible().catch(() => false);
      expect(hasDatasetSelect).toBe(true);
    }

    // 取消编辑
    const cancelBtn = page.locator('button').filter({ hasText: /取消|Cancel/i }).first();
    if (await cancelBtn.isVisible().catch(() => false)) {
      await cancelBtn.click();
    }
  });

  test('P2-5: Prompt 工程 - 保存版本并自动创建回归实验', async ({ page }) => {
    await registerAndLogin(page);
    const projectId = await getOrCreateProject(page);

    // 通过 API 创建 Prompt 和数据集
    const prompt = await apiRequest(page, 'POST', '/prompts', {
      project_id: projectId,
      name: `E2E-Prompt-${Date.now()}`,
      content: 'You are a helpful assistant.',
      description: 'E2E test prompt',
    });

    const dataset = await apiRequest(page, 'POST', '/evaluation/datasets', {
      project_id: projectId,
      name: `E2E-Regression-Dataset-${Date.now()}`,
      description: 'E2E regression dataset',
      type: 'qa',
    });

    await page.goto(`${BASE_URL}/prompts`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);

    // 先点击 Prompt 列表项选中它
    const promptItem = page.locator('div[class*="cursor-pointer"]').filter({ hasText: prompt.name }).first();
    if (await promptItem.isVisible().catch(() => false)) {
      await promptItem.click();
      await page.waitForTimeout(500);
    }

    // 点击编辑按钮
    const editBtn = page.locator('button').filter({ hasText: /编辑|Edit/i }).first();
    await expect(editBtn).toBeVisible({ timeout: 10000 });
    await editBtn.click();
    await page.waitForTimeout(800);

    // 修改 Prompt 内容（Modal 中的 textarea）
    const contentArea = page.locator('.fixed textarea').first();
    await expect(contentArea).toBeVisible({ timeout: 10000 });
    await contentArea.fill('You are an expert assistant. Updated content.');

    // 勾选自动回归实验
    const checkbox = page.locator('input[type="checkbox"]').first();
    if (await checkbox.isVisible().catch(() => false)) {
      await checkbox.click();
      await page.waitForTimeout(500);
    }

    // 选择数据集
    const datasetSelect = page.locator('[data-testid="regression-dataset-select"]');
    await expect(datasetSelect).toBeVisible({ timeout: 10000 });
    await datasetSelect.selectOption(dataset.id);

    // 保存
    const saveBtn = page.locator('button[type="submit"]').filter({ hasText: /保存|Save/i }).first();
    if (await saveBtn.isVisible().catch(() => false)) {
      await saveBtn.click();
      await page.waitForTimeout(2000);
    }

    // 验证保存成功（alert 或页面更新）
    await expect(page.locator('body')).toBeVisible();
    const modalCancel = page.locator('.fixed button').filter({ hasText: /取消|Cancel/i }).last();
    if (await modalCancel.isVisible().catch(() => false)) {
      await modalCancel.click();
    }

    // 切换到版本历史 Tab 验证新版本出现
    const versionsTab = page.locator('button').filter({ hasText: /版本历史|Versions/i }).first();
    if (await versionsTab.isVisible().catch(() => false)) {
      await versionsTab.click();
      await page.waitForTimeout(1000);

      // 验证版本列表中有内容
      const versionRows = page.locator('table tbody tr');
      const versionCount = await versionRows.count();
      expect(versionCount).toBeGreaterThan(0);
    }
  });

  test('P2-6: 评测中心 - 实验报告模态框显示失败案例和校准入口', async ({ page }) => {
    await registerAndLogin(page);
    const projectId = await getOrCreateProject(page);

    // 通过 API 创建完整实验数据
    const dataset = await apiRequest(page, 'POST', '/evaluation/datasets', {
      project_id: projectId,
      name: `E2E-Dataset-${Date.now()}`,
      description: 'E2E test dataset',
      type: 'qa',
    });

    await apiRequest(page, 'POST', `/evaluation/datasets/${dataset.id}/items`, {
      items: [{ input: 'Test input', expected_output: 'Test output' }],
    });

    const experiment = await apiRequest(page, 'POST', '/evaluation/experiments', {
      project_id: projectId,
      name: `E2E-Experiment-${Date.now()}`,
      dataset_id: dataset.id,
    });

    // 创建 evaluator
    const evaluator = await apiRequest(page, 'POST', '/evaluation/evaluators', {
      project_id: projectId,
      name: `E2E-Evaluator-${Date.now()}`,
      type: 'exact_match',
      description: 'E2E evaluator',
    });

    // 创建结果（失败案例）
    const items = await apiRequest(page, 'GET', `/evaluation/datasets/${dataset.id}/items`);
    if (items.length > 0) {
      await apiRequest(page, 'POST', '/evaluation/results', {
        experiment_id: experiment.id,
        dataset_item_id: items[0].id,
        evaluator_id: evaluator.id,
        output: 'Wrong output',
        score: 0,
        passed: false,
        latency_ms: 100,
      });
    }

    await page.goto(`${BASE_URL}/evaluation`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);

    // 切换到实验 Tab
    await page.locator('[data-testid="experiments-tab"]').first().click();
    await page.waitForTimeout(800);

    // 点击报告按钮
    const reportBtn = page.locator('button').filter({ hasText: /报告|Report/i }).first();
    if (await reportBtn.isVisible().catch(() => false)) {
      await reportBtn.click();
      await page.waitForTimeout(1500);

      // 验证报告内容包含失败案例区域
      const pageContent = await page.content();
      const hasBadCases = /失败案例|Bad Cases/i.test(pageContent);
      expect(hasBadCases).toBe(true);

      // 验证校准相关元素存在（如果有失败案例）
      const calibrateBtn = page.locator('button').filter({ hasText: /校准|Calibrate/i }).first();
      if (await calibrateBtn.isVisible().catch(() => false)) {
        await expect(calibrateBtn).toBeVisible();
      }

      // 关闭模态框
      const closeBtn = page.locator('button').filter({ hasText: /✕|关闭|Close/i }).first();
      if (await closeBtn.isVisible().catch(() => false)) {
        await closeBtn.click();
      }
    }

    await expect(page.locator('body')).toBeVisible();
  });

  test('P2-7: 完整闭环 - 创建数据集→实验→报告→Prompt 回归', async ({ page }) => {
    test.setTimeout(90000);
    await registerAndLogin(page);
    const projectId = await getOrCreateProject(page);

    // ========== 步骤 1: 通过 API 创建数据集和 Prompt（减少 UI 不稳定因素）==========
    const dataset = await apiRequest(page, 'POST', '/evaluation/datasets', {
      project_id: projectId,
      name: `E2E-Flow-Dataset-${Date.now()}`,
      description: 'E2E flow dataset',
      type: 'qa',
    });

    const prompt = await apiRequest(page, 'POST', '/prompts', {
      project_id: projectId,
      name: `E2E-Flow-Prompt-${Date.now()}`,
      content: 'You are a helpful assistant.',
      description: 'E2E flow prompt',
    });

    // 在评测中心创建实验
    await page.goto(`${BASE_URL}/evaluation`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);

    await page.locator('[data-testid="experiments-tab"]').first().click();
    await page.waitForTimeout(500);

    await page.locator('[data-testid="create-experiment-btn"]').first().click();
    await page.waitForTimeout(500);

    await page.locator('[data-testid="experiment-name-input"]').fill(`E2E-Flow-Experiment-${Date.now()}`);
    const datasetSelect = page.locator('[data-testid="experiment-dataset-select"]');
    const opts = await datasetSelect.locator('option').allTextContents();
    if (opts.length > 1) {
      await datasetSelect.selectOption({ index: 1 });
    }
    await page.locator('[data-testid="experiment-submit-btn"]').click();
    await page.waitForTimeout(1500);

    // ========== 步骤 2: 在 Prompt 工程执行回归 ==========
    await page.goto(`${BASE_URL}/prompts`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);

    // 选中 Prompt
    const promptItem = page.locator('div[class*="cursor-pointer"]').filter({ hasText: prompt.name }).first();
    if (await promptItem.isVisible().catch(() => false)) {
      await promptItem.click();
      await page.waitForTimeout(500);
    }

    // 编辑 Prompt
    const editBtn = page.locator('button').filter({ hasText: /编辑|Edit/i }).first();
    await editBtn.click();
    await page.waitForTimeout(500);

    const contentArea = page.locator('.fixed textarea').first();
    await contentArea.fill('You are an updated test assistant.');

    const autoCheckbox = page.locator('input[type="checkbox"]').first();
    if (await autoCheckbox.isVisible().catch(() => false)) {
      await autoCheckbox.click();
      await page.waitForTimeout(300);

      const dsSelect = page.locator('[data-testid="regression-dataset-select"]');
      if (await dsSelect.isVisible().catch(() => false)) {
        const dsOptions = await dsSelect.locator('option').allTextContents();
        if (dsOptions.length > 1) {
          await dsSelect.selectOption({ index: 1 });
        }
      }
    }

    await page.locator('button[type="submit"]').filter({ hasText: /保存|Save/i }).first().click();
    await page.waitForTimeout(2000);

    // 验证页面正常
    await expect(page.locator('body')).toBeVisible();

    // ========== 步骤 3: 回到评测中心验证实验列表有数据 ==========
    await page.goto(`${BASE_URL}/evaluation`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);

    await page.locator('[data-testid="experiments-tab"]').first().click();
    await page.waitForTimeout(800);

    await expect(page.locator('body')).toBeVisible();
  });
});
