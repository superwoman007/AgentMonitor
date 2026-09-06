# AgentMonitor v2.0 任务拆分与 TDD 计划

> 目标：补齐核心能力，完善 P0 功能闭环
> 方法论：TDD（Test-Driven Development）—— 先写测试，再写实现

---

## Sprint 1：Prompt 工程强化

### Task PM-02: Playground 多模型对比调试
**现状**：前端有 compare UI，但后端返回模拟数据  
**目标**：实现 `POST /api/playground/compare`，真实并行调用多模型

| 步骤 | 动作 | 文件 |
|------|------|------|
| TDD-1 | 写测试：验证 compare API 行为 | `backend/tests/playground.test.ts` |
| TDD-2 | 实现服务层：`compareModels()` | `backend/src/services/playground.ts` (新增) |
| TDD-3 | 实现路由：`POST /playground/compare` | `backend/src/routes/playground.ts` |
| TDD-4 | 跑测试通过 | `npm test -- playground.test.ts` |
| TDD-5 | 前端接入真实 API | `frontend/src/api.ts` + `PromptsPage.tsx` |

**验收标准**：
- [ ] 可选择 2+ 模型配置并行对比
- [ ] 返回各模型输出、延迟、token 消耗
- [ ] 测试覆盖率 > 80%

---

### Task PM-03: Prompt ↔ Trace 联动
**目标**：在 Trace 详情页展示使用的 Prompt 版本

| 步骤 | 动作 | 文件 |
|------|------|------|
| TDD-1 | 写测试：trace 关联 prompt_version_id | `backend/tests/traces.test.ts` |
| TDD-2 | 数据库：traces 表添加 prompt_version_id 字段 | `backend/src/db/sqlite.ts` |
| TDD-3 | 服务层：创建 trace 时关联 prompt | `backend/src/services/trace.ts` |
| TDD-4 | 前端：Trace 详情展示 Prompt 卡片 | `frontend/src/pages/TraceDetailPage.tsx` |

---

## Sprint 2：观测中心完善

### Task OB-01: Trace/Span 前端可视化闭环验收
**现状**：组件已存在，需确保体验闭环  
**目标**：Gantt 图、Span 树、详情面板完美联动

| 步骤 | 动作 | 文件 |
|------|------|------|
| TDD-1 | 写 E2E 测试：点击 Span 同步高亮 | `e2e/trace-detail.spec.ts` |
| TDD-2 | 修复 Gantt 图 hover/click 交互 | `frontend/src/components/trace/GanttChart.tsx` |
| TDD-3 | 优化 Span 树展开/折叠动画 | `frontend/src/components/trace/SpanTreeList.tsx` |
| TDD-4 | 丰富 Span 详情面板信息展示 | `frontend/src/components/trace/SpanDetailPanel.tsx` |

---

### Task OB-02: Dashboard 看板
**目标**：项目级观测数据概览

| 步骤 | 动作 | 文件 |
|------|------|------|
| TDD-1 | 写测试：`GET /stats/dashboard` API | `backend/tests/stats.test.ts` |
| TDD-2 | 实现后端 Dashboard 聚合查询 | `backend/src/services/stats.ts` |
| TDD-3 | 前端 Dashboard 页面 | `frontend/src/pages/DashboardPage.tsx` |

---

## Sprint 3：评测引擎完善

### Task EV-01: 评测执行引擎端到端
**现状**：实验可创建，但执行流程待完善  
**目标**：一键启动实验，自动跑完数据集并生成结果

| 步骤 | 动作 | 文件 |
|------|------|------|
| TDD-1 | 写测试：experiment start → results | `backend/tests/evaluation.test.ts` |
| TDD-2 | 实现执行引擎：顺序/批量执行 dataset items | `backend/src/services/evaluation-runner.ts` |
| TDD-3 | 集成 LLM Judge 调用 | `backend/src/services/llm-judge.ts` |
| TDD-4 | 前端实时进度展示优化 | `frontend/src/pages/EvaluationPage.tsx` |

---

## Sprint 4：产品体验升级

### Task UX-01: 国际化完全覆盖
**现状**：i18n 框架有，部分页面未覆盖  
**目标**：所有用户可见字符串纳入国际化

| 步骤 | 动作 | 文件 |
|------|------|------|
| TDD-1 | 写测试：检查硬编码中文/英文 | `frontend/tests/i18n-coverage.test.ts` |
| TDD-2 | 补充所有页面的 i18n key | `frontend/src/i18n/` |
| TDD-3 | 统一语言切换组件 | `frontend/src/components/LanguageToggle.tsx` |

---

### Task UX-02: 统一设计系统
**目标**：深色科技风、高信息密度、企业级 B 端质感

| 步骤 | 动作 | 文件 |
|------|------|------|
| TDD-1 | 定义 Design Token（颜色、间距、字体） | `frontend/src/styles/design-tokens.ts` |
| TDD-2 | 重构核心页面样式 | `frontend/src/pages/*` |
| TDD-3 | 统一组件库风格 | `frontend/src/components/*` |

---

## 当前 Sprint：PM-02（进行中）

正在使用 TDD 模式实现 Playground 多模型对比 API。
