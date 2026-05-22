# AgentMonitor 测试计划 v2.0

> **目标**：建立从单元测试 → 模块测试 → 端到端测试 → 真实 Agent 接入测试的完整质量防线
> **覆盖范围**：后端 API / 前端页面 / SDK / Demo Agent / 核心用户旅程
> **基准日期**：2026-04-29

---

## 一、现有测试资产盘点

### 1.1 后端 API 测试（模块测试层）

| 测试文件 | 行数 | 覆盖模块 | 状态 |
|---------|------|---------|------|
| `auth.test.ts` | 137 | 注册/登录/认证 | ✅ |
| `projects.test.ts` | 138 | 项目 CRUD | ✅ |
| `apikeys.test.ts` | 148 | API Key 管理 | ✅ |
| `breakpoints.test.ts` | 271 | 断点调试 | ✅ |
| `evaluation.test.ts` | 592 | 评测中心核心 | ✅ |
| `evaluation-phase1.test.ts` | 360 | 评测 Phase1 | ✅ |
| `evaluation-phase2.test.ts` | 293 | 评测 Phase2 | ✅ |
| `evaluation-enhanced.test.ts` | 423 | 评测增强 | ✅ |
| `feedback.test.ts` | 146 | Feedback | ✅ |
| `modelConfigs.test.ts` | 152 | 模型配置 | ✅ |
| `observation.test.ts` | 275 | 观测相关 | ✅ |
| `prompts.test.ts` | 469 | Prompt 管理 | ✅ |
| `sessions.test.ts` | 213 | 会话管理 | ✅ |
| `traces.test.ts` | 210 | Trace 追踪 | ✅ |
| `trace-auto-eval.test.ts` | 110 | Trace 自动评测 | ✅ |
| `trace-dataset-reflow.test.ts` | 216 | Trace 数据集回流 | ✅ |
| **合计** | **~4,153** | **16 个模块** | **16/24** |

**❌ 缺失 API 测试**：`stats` · `cost` · `quality` · `alerts` · `decisions` · `toolCalls` · `playground` · `snapshots` · `ws(websocket)`

### 1.2 前端 UI 测试

| 测试文件 | 覆盖页面 | 状态 |
|---------|---------|------|
| `auth.spec.ts` | 登录/注册/登出 | ✅ |
| `settings.spec.ts` | 项目/API Key 管理 | ✅ |
| `evaluation.spec.ts` | 评测中心 | ✅ |
| `dashboard.spec.ts` | 仪表盘 | ✅ |
| `sessions.spec.ts` | 会话列表 | ✅ |
| `traces.spec.ts` | Trace 追踪 | ✅ |
| `prompts.spec.ts` | Prompt 管理 | ✅ |
| `alerts.spec.ts` | 告警管理 | ✅ |
| `playground.spec.ts` | Playground | ✅ |
| `modelConfigs.spec.ts` | 模型配置 | ✅ |
| **合计** | **10 个页面** | **10/17** |

**❌ 缺失 UI 测试**：`SessionDetail` · `Debugging` · `Cost` · `Quality` · `Decisions` · `Feedback`

### 1.3 E2E 场景测试

| 测试文件 | 覆盖场景 | 状态 |
|---------|---------|------|
| `user-journey.spec.ts` | 注册→登录→查看数据 + 断点调试 | ✅ |
| `p1-features.spec.ts` | P1 功能验证 | ✅ |
| `p1-ui-validation.spec.ts` | P1 UI 校验 | ✅ |
| `p2-features.spec.ts` | P2 功能验证 | ✅ |
| `observation-journey.spec.ts` | 观测中心旅程 | ✅ |
| `evaluation-journey.spec.ts` | 评测中心旅程 | ✅ |
| `prompt-journey.spec.ts` | 提示工程旅程 | ✅ |

### 1.4 SDK 测试

| SDK | 测试文件 | 状态 |
|-----|---------|------|
| TypeScript | `index.test.ts` + `auto-instrument.test.ts` | ✅ 基础覆盖 |
| Python | 无自动化测试 | ❌ |
| Go | 无自动化测试 | ❌ |

### 1.5 真实 Agent 接入测试

| 类型 | 状态 |
|-----|------|
| demo-agent 手动运行 | ✅ 有示例代码 |
| demo-agent 自动化回归 | ❌ 缺失 |
| SDK 真实 OpenAI 调用链路 | ❌ 缺失 |
| SDK 真实 LangChain 调用链路 | ❌ 缺失 |

---

## 二、四层测试体系设计

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 4: 真实 Agent 接入测试 (Real Agent Integration)       │
│  ├── demo-agent 自动化验证                                   │
│  ├── SDK + OpenAI 真实链路                                   │
│  └── SDK + LangChain 真实链路                                │
├─────────────────────────────────────────────────────────────┤
│  Layer 3: 端到端测试 (E2E) — Playwright                      │
│  ├── 核心用户旅程 (注册→评测→观测→调试)                       │
│  ├── 各模块专项 E2E (Dashboard/Sessions/Traces/...)         │
│  └── 跨模块数据流验证 (Session→Trace→Debug)                  │
├─────────────────────────────────────────────────────────────┤
│  Layer 2: 模块/集成测试 (API) — Vitest + Supertest           │
│  ├── 已有 16 个模块需补全至 24 个                            │
│  └── 新增边界/异常/并发场景                                  │
├─────────────────────────────────────────────────────────────┤
│  Layer 1: 单元测试 (Unit) — Vitest                           │
│  ├── 后端: services 纯函数 / utils / db 操作                 │
│  ├── 前端: hooks / stores / 工具函数 / 组件快照              │
│  └── SDK: 各语言独立单元测试                                 │
└─────────────────────────────────────────────────────────────┘
```

---

## 三、各模块测试矩阵

### 3.1 后端服务模块

| 模块 | 单元测试(service) | API 测试(route) | E2E 场景 | 真实 Agent |
|-----|------------------|----------------|---------|-----------|
| Auth | ⏳ 待建 | ✅ 已有 | ✅ 已有 | - |
| Projects | ⏳ 待建 | ✅ 已有 | ✅ 已有 | - |
| API Keys | ⏳ 待建 | ✅ 已有 | ✅ 已有 | - |
| Traces | ⏳ 待建 | ✅ 已有 | ⏳ 待建 | ✅ 已有(demo) |
| Sessions | ⏳ 待建 | ✅ 已有 | ⏳ 待建 | ✅ 已有(demo) |
| Stats | ⏳ 待建 | ❌ 缺失 | ⏳ 待建 | - |
| Cost | ⏳ 待建 | ❌ 缺失 | ⏳ 待建 | - |
| Quality | ⏳ 待建 | ❌ 缺失 | ⏳ 待建 | - |
| Alerts | ⏳ 待建 | ❌ 缺失 | ⏳ 待建 | - |
| Breakpoints | ⏳ 待建 | ✅ 已有 | ✅ 已有 | ⏳ 待建 |
| Snapshots | ⏳ 待建 | ❌ 缺失 | ⏳ 待建 | - |
| Decisions | ⏳ 待建 | ❌ 缺失 | ⏳ 待建 | - |
| Evaluation | ⏳ 待建 | ✅ 已有 | ✅ 已有 | - |
| Prompts | ⏳ 待建 | ✅ 已有 | ⏳ 待建 | - |
| Playground | ⏳ 待建 | ❌ 缺失 | ⏳ 待建 | - |
| ModelConfigs | ⏳ 待建 | ✅ 已有 | ⏳ 待建 | - |
| ToolCalls | ⏳ 待建 | ❌ 缺失 | ⏳ 待建 | - |
| Feedback | ⏳ 待建 | ✅ 已有 | ⏳ 待建 | - |
| WS/WebSocket | ⏳ 待建 | ❌ 缺失 | ⏳ 待建 | - |

### 3.2 前端页面模块

| 页面 | 组件单元测试 | UI 自动化 | E2E 场景 |
|-----|------------|----------|---------|
| Login/Register | ⏳ 待建 | ✅ 已有 | ✅ 已有 |
| Dashboard | ⏳ 待建 | ✅ 已有 | ✅ 已有 |
| Sessions | ⏳ 待建 | ✅ 已有 | ✅ 已有 |
| SessionDetail | ⏳ 待建 | ❌ 缺失 | ✅ 已有 |
| Traces | ⏳ 待建 | ✅ 已有 | ✅ 已有 |
| Evaluation | ⏳ 待建 | ✅ 已有 | ✅ 已有 |
| Prompts | ⏳ 待建 | ✅ 已有 | ✅ 已有 |
| Playground | ⏳ 待建 | ✅ 已有 | ✅ 已有 |
| ModelConfigs | ⏳ 待建 | ✅ 已有 | ⏳ 待建 |
| Debugging | ⏳ 待建 | ❌ 缺失 | ✅ 已有 |
| Alerts | ⏳ 待建 | ✅ 已有 | ⏳ 待建 |
| Settings | ⏳ 待建 | ✅ 已有 | ⏳ 待建 |
| Cost | ⏳ 待建 | ❌ 缺失 | ⏳ 待建 |
| Quality | ⏳ 待建 | ❌ 缺失 | ⏳ 待建 |
| Decisions | ⏳ 待建 | ❌ 缺失 | ⏳ 待建 |

### 3.3 SDK 模块

| SDK | 单元测试 | 集成测试 | 真实 Agent 测试 |
|-----|---------|---------|---------------|
| TypeScript | ⏳ 增强 | ✅ 基础 | ⏳ 待建 |
| Python | ❌ 缺失 | ❌ 缺失 | ⏳ 待建 |
| Go | ❌ 缺失 | ❌ 缺失 | ⏳ 待建 |

---

## 四、测试实施路线图

### Phase 1：补全模块测试（2 周）

**目标**：所有后端路由都有 API 测试覆盖，达到 80%+ 覆盖率。

| 优先级 | 任务 | 负责人 | 验收标准 |
|-------|------|--------|---------|
| P0 | 补全 `stats` · `cost` · `quality` API 测试 | - | 3 个文件，覆盖 CRUD 和统计计算 |
| P0 | 补全 `alerts` · `decisions` API 测试 | - | 2 个文件，覆盖告警规则和决策记录 |
| P0 | 补全 `playground` · `toolCalls` API 测试 | - | 2 个文件，覆盖 playground 执行和工具调用 |
| P0 | 补全 `snapshots` · `ws` API 测试 | - | 2 个文件，覆盖快照管理和 WebSocket 连接 |

### Phase 2：建立单元测试层（2 周）

**目标**：核心业务逻辑脱离 HTTP 层可独立测试。

| 优先级 | 任务 | 说明 |
|-------|------|------|
| P0 | 后端 Service 单元测试 | `backend/tests/unit/` 下对 `evaluation.ts` · `prompts.ts` · `trace.ts` 等复杂 service 的纯函数进行单元测试 |
| P0 | 后端 Utils 单元测试 | 校验、格式化、计算工具函数 |
| P1 | 前端 Hooks 单元测试 | `frontend/tests/unit/hooks/` 测试数据获取、状态转换逻辑 |
| P1 | 前端 Stores 单元测试 | ✅ `frontend/tests/unit/stores/` 5 个 store 共 54 个测试全部通过 |

### Phase 3：补齐前端 UI & E2E（2 周）

**目标**：核心页面 100% 有 UI 自动化，关键用户旅程 100% 有 E2E 覆盖。

| 优先级 | 任务 | 说明 |
|-------|------|------|
| P0 | Dashboard UI 测试 | 指标卡片、图表渲染、时间筛选 |
| P0 | Sessions UI 测试 | 列表加载、三视图切换、筛选搜索 |
| P0 | Traces UI 测试 | Trace 列表、详情面板、子调用树 |
| P0 | Prompts UI 测试 | CRUD、版本历史、diff 对比、回滚 |
| P1 | Playground UI 测试 | 变量注入、模型选择、运行结果 |
| P1 | ModelConfigs UI 测试 | 参数配置、保存、切换 |
| P1 | Alerts UI 测试 | 告警规则配置、状态展示 |
| P1 | E2E：观测中心旅程 | Dashboard → Traces → SessionDetail 数据流验证 |
| P1 | E2E：评测中心旅程 | Dataset → Evaluator → Experiment → Report 完整闭环 |
| P1 | E2E：提示工程旅程 | Prompt 创建 → Playground 验证 → 版本对比 |

### Phase 4：真实 Agent 接入测试（1-2 周）

**目标**：验证 SDK 在真实 LLM 调用场景下的行为正确性。

| 优先级 | 任务 | 说明 |
|-------|------|------|
| P0 | `tests/agent/` 目录建立 | 独立测试空间，不污染现有测试 |
| P0 | TypeScript SDK + OpenAI 真实链路 | 调用真实/模拟 OpenAI API，验证 Trace 采集完整性 |
| P0 | TypeScript SDK Auto-instrument 验证 | 验证自动埋点是否正确拦截 LLM 调用 |
| P1 | Python SDK 单元 + 集成测试 | 建立 `sdk-python/tests/`，覆盖基础上报和 Auto-instrument |
| P1 | Go SDK 单元 + 集成测试 | 建立 `sdk-go/tests/`，覆盖基础上报 |
| P1 | Demo Agent 自动化回归 | 将 `demo-agent/src/` 包装为可断言的测试用例 |
| P2 | 多框架兼容性矩阵 | LangChain · LlamaIndex · 原生 OpenAI · Anthropic SDK |
| P0 | Agent → Trace → 自动评测触发 | 验证真实 Agent 产生的 Trace 能正确触发 auto-eval 流程 |
| P0 | Agent 输出 → Dataset 回流 | 验证 trace-dataset-reflow 在真实 Agent 链路下的数据完整性 |
| P1 | Agent 会话 → 评测实验运行 | 用真实 Agent 输出创建 Dataset，运行 Evaluator，验证评分结果正确 |
| P1 | 多版本 Agent 对比评测 | 不同 model/prompt 版本的 Agent 输出做 A/B 评测，验证评测对比功能 |
| P1 | 评测结果 → 告警联动 | 评测分数低于阈值时触发告警，验证评测-告警跨模块集成 |

---

## 五、目录结构与命名规范

```
AgentMonitor/
├── backend/
│   ├── tests/
│   │   ├── setup.ts              # 全局测试配置
│   │   ├── unit/                 # ⭐ 新增：单元测试
│   │   │   ├── services/
│   │   │   │   ├── evaluation.unit.test.ts
│   │   │   │   ├── prompts.unit.test.ts
│   │   │   │   └── trace.unit.test.ts
│   │   │   └── utils/
│   │   │       └── validators.unit.test.ts
│   │   ├── api/                  # 现有 API 测试迁移至此（可选）
│   │   │   ├── auth.test.ts
│   │   │   ├── stats.test.ts      # ⭐ 新增
│   │   │   ├── cost.test.ts       # ⭐ 新增
│   │   │   ├── quality.test.ts    # ⭐ 新增
│   │   │   ├── alerts.test.ts     # ⭐ 新增
│   │   │   ├── decisions.test.ts  # ⭐ 新增
│   │   │   ├── snapshots.test.ts  # ⭐ 新增
│   │   │   ├── playground.test.ts # ⭐ 新增
│   │   │   ├── toolCalls.test.ts  # ⭐ 新增
│   │   │   └── ws.test.ts         # ⭐ 新增
│   │   └── integration/          # ⭐ 新增：跨模块集成
│   │       └── session-to-trace.integration.test.ts
│   └── package.json              # 脚本: test:unit / test:api / test:integration
│
├── frontend/
│   ├── tests/
│   │   ├── ui/                   # 现有 UI 测试
│   │   │   ├── auth.spec.ts
│   │   │   ├── dashboard.spec.ts   # ⭐ 新增
│   │   │   ├── sessions.spec.ts    # ⭐ 新增
│   │   │   ├── traces.spec.ts      # ⭐ 新增
│   │   │   ├── prompts.spec.ts     # ⭐ 新增
│   │   │   ├── playground.spec.ts  # ⭐ 新增
│   │   │   ├── modelConfigs.spec.ts# ⭐ 新增
│   │   │   └── alerts.spec.ts      # ⭐ 新增
│   │   └── unit/                 # ⭐ 新增：前端单元测试
│   │       ├── hooks/
│   │       ├── stores/
│   │       └── components/
│   └── package.json              # 新增 vitest / @testing-library/react
│
├── e2e/                          # 现有 E2E 测试
│   ├── user-journey.spec.ts
│   ├── evaluation-journey.spec.ts  # ⭐ 新增
│   ├── observation-journey.spec.ts # ⭐ 新增
│   └── prompt-journey.spec.ts      # ⭐ 新增
│
├── sdk/
│   ├── src/
│   └── tests/
│       ├── unit/                 # ⭐ 新增：SDK 单元测试
│       └── integration/          # ⭐ 新增：SDK 集成测试
│
├── sdk-python/
│   └── tests/                    # ⭐ 新增
│       ├── test_client.py
│       └── test_auto_instrument.py
│
├── sdk-go/
│   └── tests/                    # ⭐ 新增
│       ├── client_test.go
│       └── auto_instrument_test.go
│
└── tests/                        # ⭐ 新增：真实 Agent 接入测试
    ├── agent/
    │   ├── ts-openai-agent.test.ts
    │   ├── ts-langchain-agent.test.ts
    │   ├── python-openai-agent.test.py
    │   └── go-openai-agent.test.go
    └── docker-compose.agent-test.yml
```

---

## 六、测试命令规范

```bash
# ========== 后端 ==========
cd backend

# 全部后端测试
npm test

# 仅单元测试（纯函数，无 HTTP）
npm run test:unit

# 仅 API 测试（Supertest + HTTP）
npm run test:api

# 仅集成测试（跨模块）
npm run test:integration

# 覆盖率报告
npm run test:coverage

# ========== 前端 ==========
cd frontend

# 组件/Hook 单元测试
npm run test:unit

# UI 自动化（Playwright）
npx playwright test tests/ui/

# ========== E2E ==========
npx playwright test --config=playwright.config.e2e.ts

# ========== SDK ==========
cd sdk && npm test
cd sdk-python && pytest
cd sdk-go && go test ./...

# ========== 真实 Agent 测试 ==========
cd tests/agent
npm run test:agent        # TypeScript Agent
docker-compose -f docker-compose.agent-test.yml up  # 全量 Agent 矩阵

# ========== 一键全量 ==========
./test-all.sh             # 现有（API + UI + E2E）
./test-full.sh            # ⭐ 新增（API + UI + E2E + SDK + Agent）
```

---

## 七、测试数据与环境策略

| 层级 | 数据库策略 | 外部依赖策略 |
|-----|-----------|------------|
| 单元测试 | 内存 mock / 纯函数，不依赖 DB | 全部 mock |
| API 测试 | SQLite 独立文件（`test.db`），每个文件清理 | mock LLM 调用 |
| 集成测试 | SQLite / PostgreSQL 测试实例 | mock 或本地 stub 服务 |
| UI 测试 | 复用 API 测试的 seeded 数据 | 前端连真实本地后端 |
| E2E 测试 | 通过 UI 操作自然产生数据 | 全真实链路（除 LLM 可 mock） |
| Agent 测试 | 真实后端 + 真实/录制 LLM 响应 | 可选 VCR / nock 录制 |

**Agent 测试外部依赖处理**：
- 使用 `.env.test` 配置 `OPENAI_API_KEY`（可选）
- 无 Key 时，使用 `nock` / `msw` / `vcr.py` 播放录制响应
- CI 中不调用真实 LLM，使用录制模式

---

## 八、质量门禁与 CI/CD

```yaml
# .github/workflows/test.yml 建议补充
jobs:
  unit-test:
    runs-on: ubuntu-latest
    steps:
      - run: cd backend && npm run test:unit
      - run: cd frontend && npm run test:unit
      - run: cd sdk && npm test

  api-test:
    runs-on: ubuntu-latest
    steps:
      - run: cd backend && npm run test:api

  ui-test:
    runs-on: ubuntu-latest
    steps:
      - run: cd frontend && npx playwright test tests/ui/

  e2e-test:
    runs-on: ubuntu-latest
    steps:
      - run: npx playwright test --config=playwright.config.e2e.ts

  agent-test:
    runs-on: ubuntu-latest
    if: contains(github.event.head_commit.message, '[agent-test]')
    steps:
      - run: cd tests/agent && npm run test:agent
```

**覆盖率目标**：

| 层级 | 目标覆盖率 | 当前估算 |
|-----|-----------|---------|
| 后端单元测试 | ≥ 70% | ~5% |
| 后端 API 测试 | ≥ 80% | ~65% |
| 前端单元测试 | ≥ 60% | ~0% |
| 前端 UI 测试 | ≥ 70% 核心页面 | ~20% |
| E2E 核心旅程 | 100% | ~40% |
| SDK 单元测试 | ≥ 70% | ~30% (TS only) |

---

## 九、风险与缓解

| 风险 | 影响 | 缓解措施 |
|-----|------|---------|
| 前端组件测试引入成本高 | 拖慢 Phase 2 | 优先测试 hooks/stores，组件测试用 Playwright 替代 |
| 真实 Agent 测试需要 LLM API Key | CI 不稳定/费用 | 使用录制回放（VCR），CI 走录制，本地可选真实调用 |
| WebSocket 测试不稳定 | E2E  flaky | 增加重试机制，ws 测试独立运行 |
| 测试数据库迁移不同步 | API 测试失败 | 每次测试前自动执行 `migrate`，使用 `setup.ts` 统一管理 |

---

## 十、即时可执行动作（本周启动）

1. **今天**：创建 `backend/tests/api/` 和 `backend/tests/unit/` 目录，将现有测试分类迁移
2. **本周内**：补齐 `stats.test.ts` · `cost.test.ts` · `quality.test.ts` · `alerts.test.ts`（4 个高优先级缺失模块）
3. **本周内**：创建 `tests/agent/` 目录，编写第一个 `ts-openai-agent.test.ts` 真实链路测试
4. **下周**：引入 `frontend` 的 Vitest 配置，编写第一个 hook 单元测试

---

> **文档维护**：每次新增功能时，同步更新本矩阵中的测试状态。
