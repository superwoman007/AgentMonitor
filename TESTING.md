# AgentMonitor 自动化测试文档

## 测试架构

AgentMonitor 采用三层自动化测试体系：

```
┌─────────────────────────────────────────┐
│         E2E 场景测试 (Playwright)        │
│   完整用户旅程 + 断点调试 + 告警流程      │
└────────────────────────��────────────────┘
                    ↓
┌─────────────────────────────────────────┐
│         UI 自动化测试 (Playwright)       │
│   登录/注册 + Dashboard + Settings       │
└─────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────┐
│         API 自动化测试 (Vitest)          │
│   用户/项目/API Key/会话/断点/告警       │
└─────────────────────────────────────────┘
```

## 测试覆盖范围

### 1. API 测试（后端）

**位置**: `backend/tests/`

| 测试文件 | 覆盖功能 | 测试用例数 |
|---------|---------|-----------|
| `auth.test.ts` | 用户注册/登录/认证 | 9 |
| `projects.test.ts` | 项目 CRUD | 8 |
| `apikeys.test.ts` | API Key 管理 | 9 |
| `sessions.test.ts` | 会话采集和查询 | 8 |

**运行命令**:
```bash
cd backend
npm run test:api
```

### 2. UI 测试（前端）

**位置**: `frontend/tests/ui/`

| 测试文件 | 覆盖功能 | 测试用例数 |
|---------|---------|-----------|
| `auth.spec.ts` | 登录/注册/登出 | 4 |
| `settings.spec.ts` | 项目/API Key 管理 | 8 |

**运行命令**:
```bash
cd frontend
npx playwright test
```

### 3. E2E 场景测试

**位置**: `e2e/`

| 测试文件 | 覆盖场景 | 测试用例数 |
|---------|---------|-----------|
| `user-journey.spec.ts` | 完整用户旅程 + 断点调试 + 告警 | 3 |

**运行命令**:
```bash
npx playwright test --config=playwright.config.e2e.ts
```

## 快速开始

### 安装依赖

```bash
# 后端测试依赖
cd backend
npm install --save-dev vitest @vitest/coverage-v8 supertest @types/supertest

# 前端测试依赖
cd ../frontend
npm install --save-dev @playwright/test

# 安装 Playwright 浏览器
npx playwright install
```

### 运行所有测试

```bash
# 在项目根目录
./test-all.sh
```

### 单独运行测试

```bash
# API 测试
cd backend && npm run test:api

# UI 测试
cd frontend && npx playwright test

# E2E 测试
npx playwright test --config=playwright.config.e2e.ts

# 带覆盖率的 API 测试
cd backend && npm run test:coverage
```

## 测试报告

### API 测试报告

- **位置**: `backend/coverage/`
- **格式**: HTML + JSON
- **查看**: 打开 `backend/coverage/index.html`

### UI 测试报告

- **位置**: `frontend/playwright-report/`
- **格式**: HTML
- **查看**: `npx playwright show-report`

### E2E 测试报告

- **位置**: `e2e-report/`
- **格式**: HTML + 视频 + 截图
- **查看**: `npx playwright show-report e2e-report`

## CI/CD 集成

### GitHub Actions 示例

```yaml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_PASSWORD: test
          POSTGRES_DB: agentmonitor_test
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '20'
      
      - name: Install dependencies
        run: |
          cd backend && npm ci
          cd ../frontend && npm ci
          npx playwright install --with-deps
      
      - name: Run API tests
        run: cd backend && npm run test:api
        env:
          DATABASE_URL: postgresql://postgres:test@localhost:5432/agentmonitor_test
      
      - name: Run UI tests
        run: cd frontend && npx playwright test
      
      - name: Run E2E tests
        run: npx playwright test --config=playwright.config.e2e.ts
      
      - name: Upload test reports
        if: always()
        uses: actions/upload-artifact@v3
        with:
          name: test-reports
          path: |
            backend/coverage/
            frontend/playwright-report/
            e2e-report/
```

## 测试数据管理

### 测试数据库

- **开发环境**: SQLite (`agentmonitor.db`)
- **测试环境**: PostgreSQL (`agentmonitor_test`)

测试会自动创建独立的测试用户和项目，测试结束后清理。

### 测试用户命名规范

```typescript
const testEmail = `test-${功能名}-${Date.now()}@example.com`;
```

例如：
- `test-auth-1234567890@example.com`
- `test-projects-1234567890@example.com`

## 调试测试

### Playwright UI 模式

```bash
# 交互式调试 UI 测试
cd frontend
npx playwright test --ui

# 交互式调试 E2E 测试
npx playwright test --config=playwright.config.e2e.ts --ui
```

### Playwright Debug 模式

```bash
# 逐步执行测试
npx playwright test --debug
```

### 查看测试视频

失败的测试会自动录制视频，保存在：
- UI 测试: `frontend/test-results/`
- E2E 测试: `test-results/`

## 测试最佳实践

1. **数据隔离**: 每个测试用独立的用户/项目
2. **清理资源**: 使用 `afterAll` 清理测试数据
3. **等待策略**: 使用 Playwright 的自动等待，避免 `sleep`
4. **断言明确**: 使用具体的断言，避免模糊匹配
5. **测试独立**: 测试之间不应有依赖关系

## 常见问题

### Q: 测试失败：数据库连接错误

**A**: 确保 PostgreSQL 运行中，或使用 SQLite：
```bash
export DATABASE_URL=sqlite:./test.db
```

### Q: Playwright 浏览器未安装

**A**: 运行安装命令：
```bash
npx playwright install
```

### Q: 端口被占用

**A**: 修改测试配置中的端口，或停止占用端口的服务：
```bash
lsof -ti:5173 | xargs kill -9
lsof -ti:3000 | xargs kill -9
```

## 测试覆盖率目标

- **API 测试**: >80%
- **UI 测试**: >70%
- **E2E 测试**: 核心用户旅程 100%

## 贡献指南

添加新功能时，请同时添加对应的测试：

1. **后端 API**: 在 `backend/tests/` 添加测试文件
2. **前端组件**: 在 `frontend/tests/ui/` 添加测试
3. **新场景**: 在 `e2e/` 添加端到端测试

测试文件命名规范：
- API 测试: `功能名.test.ts`
- UI 测试: `页面名.spec.ts`
- E2E 测试: `场景名.spec.ts`
