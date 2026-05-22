# AgentMonitor 用户使用手册

> **版本**：v2.0  
> **适用对象**：Agent 开发者、Prompt 工程师、QA 测试人员、运维人员  
> **阅读时间**：约 20 分钟

---

## 目录

- [1. 产品概述](#1-产品概述)
- [2. 部署与启动](#2-部署与启动)
- [3. 系统初始化](#3-系统初始化)
- [4. 接入 Agent（SDK）](#4-接入-agentsdk)
- [5. 观测中心](#5-观测中心)
- [6. 评测中心](#6-评测中心)
- [7. 提示工程](#7-提示工程)
- [8. 系统设置](#8-系统设置)
- [9. 典型工作流](#9-典型工作流)
- [10. 常见问题](#10-常见问题)

---

## 1. 产品概述

### 1.1 AgentMonitor 是什么

AgentMonitor 是一款面向 AI Agent 开发者的**全生命周期质量监控与评测平台**。它帮助开发者：

- **实时监控** Agent 的运行状态（调用次数、成功率、延迟、Token 消耗）
- **追踪调试** 每次调用的完整链路（用户消息 → LLM 调用 → 工具调用 → 最终输出）
- **批量评测** Agent 的输出质量，用数据驱动迭代优化
- **管理 Prompt** 版本、在沙盒中快速对比不同 Prompt 的效果
- **回流数据** 把线上真实用户对话自动变成评测数据集，形成优化闭环

### 1.2 核心模块

| 模块 | 功能 | 适用场景 |
|------|------|----------|
| **观测中心** | Dashboard 看板、Trace 追踪、Session 会话回放、告警 | 线上监控、问题排查 |
| **评测中心** | 数据集管理、评估器配置、评测实验、实验报告与对比 | 上线前质量验证、版本对比 |
| **提示工程** | Prompt 版本管理、Playground 沙盒、多模型对比 | Prompt 迭代优化 |
| **系统设置** | 项目管理、API Key、团队成员 | 权限与配置管理 |

### 1.3 界面布局

登录后，左侧边栏分为 5 个功能组：

```
📊 观测中心
   ├── Dashboard（实时监控看板）
   ├── Traces（调用链路追踪）
   ├── Sessions（会话列表与回放）
   └── Alerts（告警中心）

🧪 评测优化
   ├── Datasets（数据集）
   ├── Evaluators（评估器）
   └── Experiments（评测实验）

📝 提示工程
   ├── Prompts（Prompt 管理）
   ├── Playground（沙盒调试）
   └── Model Configs（模型配置）

🔧 开发调试
   ├── Debugging（断点调试）
   ├── Snapshots（快照回放）
   └── Quality（质量分析）

⚙️ 系统
   ├── Projects（项目管理）
   ├── Settings（系统设置）
   └── API Keys（密钥管理）
```

---

## 2. 部署与启动

### 2.1 前置要求

- **操作系统**：Linux / macOS / Windows（WSL2）
- **Node.js**：>= 18
- **包管理器**：npm 或 pnpm
- **数据库**：SQLite（内置，无需安装）或 PostgreSQL（可选）

### 2.2 一键启动（推荐）

```bash
git clone https://github.com/superwoman007/AgentMonitor.git
cd AgentMonitor
./start-all.sh
```

启动后访问：
- **前端面板**：http://localhost:5174
- **后端 API**：http://localhost:3000
- **健康检查**：http://localhost:3000/health

### 2.3 Docker 部署

```bash
docker-compose up -d
```

Docker 部署后访问：
- **前端面板**：http://localhost:5173
- **后端 API**：http://localhost:3000

### 2.4 停止服务

```bash
# 脚本启动的，按 Ctrl+C 两次
# Docker 部署的
docker-compose down
```

---

## 3. 系统初始化

首次使用需要完成以下 4 步初始化。

### 3.1 注册账号

1. 打开 http://localhost:5174
2. 点击「注册」按钮
3. 填写邮箱、密码、用户名
4. 点击「注册」完成

> 注册成功后自动登录，并创建一个默认项目。

### 3.2 创建/切换项目

AgentMonitor 以「项目」为单位隔离数据。每个项目对应一个独立的 Agent 应用。

**创建项目**：
1. 左侧边栏 → ⚙️ 系统 → Projects
2. 点击「创建项目」按钮
3. 填写项目名称和描述
4. 点击「保存」

**切换项目**：
- 点击页面顶部项目下拉框，选择要切换的项目
- 切换后，所有数据（Traces、Sessions、Datasets 等）都会切换到对应项目

### 3.3 生成 API Key

Agent 接入 SDK 需要使用 API Key 进行身份认证。

1. 左侧边栏 → ⚙️ 系统 → API Keys
2. 点击「生成 API Key」按钮
3. 输入 Key 名称（如 `production-agent`）
4. 点击「生成」
5. **立即复制 Key 值**（只显示一次）

> API Key 格式：`project_id_random_key`，例如 `proj_abc123_xyz789`

### 3.4 界面语言切换

点击页面右上角语言按钮，支持 **中文 / English** 切换。

---

## 4. 接入 Agent（SDK）

AgentMonitor 提供 TypeScript/JavaScript、Python、Go 三种 SDK。以下以 TypeScript 为例说明接入步骤。

### 4.1 安装 SDK

```bash
npm install /path/to/AgentMonitor/sdk
```

### 4.2 初始化 SDK

```typescript
import AgentMonitor from 'agentmonitor-sdk';

const monitor = new AgentMonitor({
  apiKey: 'your_project_id_your_api_key',
  baseUrl: 'http://localhost:3000',
});
```

### 4.3 追踪会话与消息

```typescript
// 开启一次用户会话
const session = monitor.startSession();
const sessionId = session.id;

// 记录用户发送的消息
await monitor.trackMessage({
  sessionId,
  role: 'user',
  content: '你好，我想查一下我的订单',
});

// 记录助手的回复
await monitor.trackMessage({
  sessionId,
  role: 'assistant',
  content: '好的，请提供您的订单号',
});
```

### 4.4 追踪 LLM 调用

```typescript
const start = Date.now();
const response = await openai.chat.completions.create({
  model: 'gpt-4',
  messages: [{ role: 'user', content: '你好' }],
});
const latencyMs = Date.now() - start;

// 上报 LLM 调用详情（含 Token 用量）
await monitor.traceLLM(
  'gpt-4',                              // 模型名称
  { model: 'gpt-4', prompt: '你好' },    // 请求参数
  response,                             // 响应结果
  latencyMs,                            // 延迟（毫秒）
  true                                  // 是否成功
);
```

### 4.5 追踪工具调用

```typescript
await monitor.trackToolCall({
  sessionId,
  toolName: 'checkWeather',
  inputParams: { city: '北京' },
  output: { temperature: 25, condition: '晴' },
  latencyMs: 320,
});
```

### 4.6 自动包装函数（wrap）

用 `wrap()` 自动追踪任意函数的输入、输出、延迟和异常：

```typescript
const checkWeather = monitor.wrap(async (city: string) => {
  const result = await weatherAPI(city);
  return result;
}, { name: 'checkWeather', sessionId });

const weather = await checkWeather('北京');
// 自动上报：input="北京", output=结果, latency=耗时, status=success/error
```

### 4.7 结束会话

```typescript
await monitor.endSession(sessionId);
monitor.close();
```

### 4.8 接入后验证

SDK 接入并运行 Agent 后：
1. 打开 Dashboard（http://localhost:5174/dashboard）
2. 应该能看到实时数据变化（请求数、成功率、延迟等）
3. 打开 Sessions 页面，应该能看到刚才的会话记录
4. 打开 Traces 页面，应该能看到 LLM 调用和工具调用的链路

> 如果看不到数据，检查：后端是否运行、`baseUrl` 是否正确、API Key 是否有效。

---

## 5. 观测中心

观测中心用于实时监控 Agent 的运行状态，排查线上问题。

### 5.1 Dashboard（实时监控看板）

Dashboard 是系统的首页，展示 Agent 的核心运行指标。

**顶部指标卡**：
- **总请求数**：累计接收的 Trace 数量
- **成功数 / 失败数**：按状态统计
- **成功率**：成功数 / 总请求数
- **平均延迟**：所有调用的平均响应时间
- **总 Token 数**：累计消耗的 Token 数量

**图表区域**：
- **请求趋势**：按时间维度的请求量折线图
- **延迟分布**：延迟的柱状图分布
- **状态分布**：成功/失败/异常的饼图

**连接状态指示器**（右上角）：
- 🟢 **已连接**：5 分钟内有数据上报
- 🟡 **等待 SDK 接入**：后端正常，但近期无数据
- 🔴 **已断开**：后端不可达

### 5.2 Traces（调用链路追踪）

Trace 是 Agent 一次完整调用的记录，可包含多个子调用（LLM、工具、函数等）。

**Trace 列表**：
- 展示所有 Trace 的概览（类型、名称、状态、延迟、时间）
- 支持按 **类型**（llm / message / tool_call / function / decision）筛选
- 支持按 **状态**（success / error）筛选

**Trace 详情**：
- 点击某条 Trace 打开详情面板
- **输入（Input）**：调用的输入参数
- **输出（Output）**：调用的返回结果
- **错误（Error）**：如果失败，展示错误信息
- **元数据（Metadata）**：Token 用量、模型名称等
- **子调用（Children）**：展示该 Trace 下的所有子 Trace 树形结构
- **子调用数量（childCount）**：显示该 Trace 包含多少个子调用

### 5.3 Sessions（会话列表与回放）

Session 是用户与 Agent 的一次完整交互，可包含多轮对话。

**会话列表**：
- 展示所有会话的概览（ID、消息数、状态、时间）
- 支持搜索和分页

**会话详情**：
- 点击会话进入详情页
- 支持 3 种视图模式：
  - **Timeline（时间线）**：按时间顺序展示所有事件（消息、Trace、工具调用）
  - **Chat（对话）**：只展示用户和助手的消息对话
  - **Unified（统一视图）**：把时间线事件按类型染色展示（消息=蓝色、Trace=绿色、工具调用=橙色）

> **Unified 视图** 是排查复杂 Agent 问题的利器，可以一眼看出在一次用户提问后，Agent 先后调用了哪些工具、哪些 LLM。

### 5.4 Alerts（告警中心）

告警中心展示系统触发的所有告警事件。

**告警类型**：
- **延迟告警**：响应时间超过阈值
- **错误率告警**：失败率超过阈值
- **成本告警**：Token 消耗或调用成本超过预算

**告警列表**：
- 展示告警的级别、类型、触发时间、当前状态
- 支持标记为已处理

---

## 6. 评测中心

评测中心是 AgentMonitor 的核心能力之一，帮助开发者系统性地评估 Agent 输出质量，用数据驱动优化。

### 6.1 核心概念

| 概念 | 说明 | 类比 |
|------|------|------|
| **数据集（Dataset）** | 评测用例的集合，每个用例包含 input 和 expected_output | 测试用例集 |
| **评估器（Evaluator）** | 评判标准，定义如何比较 Agent 输出与预期输出 | 判卷标准 |
| **实验（Experiment）** | 一次完整的评测执行，绑定一个数据集和一组模型配置 | 一次考试 |
| **结果（Result）** | 单个用例的评测结果，含输出、得分、是否通过 | 一道题的得分 |
| **回流（Reflow）** | 把观测中心的线上数据自动导入数据集 | 从实战中提取考题 |

### 6.2 数据集（Datasets）

#### 6.2.1 创建数据集

1. 左侧边栏 → 🧪 评测优化 → Datasets
2. 点击「创建数据集」按钮
3. 填写：
   - **名称**：数据集名称（如「客服对话评测集 v1」）
   - **描述**：数据集的用途说明
   - **类型**：custom（通用）/ qa（问答）/ chat（对话）
4. 点击「保存」

#### 6.2.2 添加评测用例

创建数据集后，进入数据集详情页，点击「添加用例」：

- **Input**：用户的输入（必填）
- **Expected Output**：预期的正确输出（选填，用于自动评估）
- **Fields**：扩展字段（如场景标签、难度等级等，JSON 格式）
- **Metadata**：元数据（如数据来源、创建人等）

**批量添加**：
- 点击「批量导入」，上传 JSON 格式的用例列表
- 格式：`[{ "input": "...", "expected_output": "...", "fields": {...} }]`

#### 6.2.3 动态列扩展

数据集支持自定义字段（Fields），用于存储业务相关的扩展信息：

- 在创建数据集时，可以指定 `column_schema`（列定义）
- 每个用例可以填写自定义字段值
- 典型用途：场景分类（售前/售后/投诉）、用户等级（普通/VIP）、预期情绪标签等

#### 6.2.4 数据集版本管理

数据集支持版本管理，方便追溯和回滚。

**提交版本**：
1. 进入数据集详情页
2. 点击「提交版本」按钮
3. 填写版本描述（如「增加 50 条售后场景用例」）
4. 点击「确认」

系统会自动：
- 保存当前所有用例的快照
- 生成版本号（v1, v2, v3...）
- 记录版本描述和提交人

**查看版本历史**：
- 点击「版本历史」按钮
- 列表展示所有版本（版本号、描述、用例数、提交时间）

**回滚版本**：
- 在版本历史中选择某个版本
- 点击「回滚到此版本」
- 确认后，数据集的用例会恢复到该版本的状态

> 回滚操作会生成新版本（不会覆盖历史），保证操作可追溯。

#### 6.2.5 数据回流（Reflow）

数据回流是 AgentMonitor 的特色功能——把观测中心的真实线上数据自动导入数据集，形成「监控 → 评测 → 优化 → 再监控」的闭环。

**回流方式一：从 Session 回流**

把一次真实用户会话中的对话消息对抽取为评测用例：

1. 进入数据集详情页
2. 点击「数据回流」按钮
3. 选择回流源：「从 Session 回流」
4. 输入或选择 Session ID
5. 配置字段映射（Input 取自 user 消息，Expected Output 取自 assistant 消息）
6. 点击「开始回流」

系统会自动：
- 提取该 Session 中所有 user/assistant 消息对
- 每对消息生成一个数据集用例
- 返回成功导入的用例数量

**回流方式二：从 Traces 回流**

把某个 Session 下的所有 Trace 调用记录抽取为评测用例：

1. 进入数据集详情页
2. 点击「数据回流」按钮
3. 选择回流源：「从 Traces 回流」
4. 输入 Session ID
5. 可选：筛选 Trace 类型（如只回流 `llm` 类型的 Trace）
6. 点击「开始回流」

系统会自动：
- 提取该 Session 下符合条件的 Trace
- 把 Trace 的 input 作为 dataset input
- 把 Trace 的 output 作为 expected_output
- 返回成功导入的用例数量

**最佳实践**：
- 每天把前一天的优质会话回流到数据集，持续扩充评测覆盖
- 遇到用户投诉或异常时，把相关 Session 回流，作为回归测试用例
- 新功能上线前，把相关场景的线上对话回流，构建专项评测集

### 6.3 评估器（Evaluators）

评估器定义了「如何评判 Agent 输出是否正确」的标准。

#### 6.3.1 创建评估器

1. 左侧边栏 → 🧪 评测优化 → Evaluators
2. 点击「创建评估器」按钮
3. 填写：
   - **名称**：如「精确匹配评估器」
   - **类型**：选择评估算法（见下表）
   - **配置**：根据类型填写参数
4. 点击「保存」

#### 6.3.2 支持的评估器类型

| 类型 | 说明 | 适用场景 | 配置参数 |
|------|------|----------|----------|
| **exact_match** | 输出与预期完全一致才算通过 | 结构化输出、枚举值、代码 | `case_sensitive`: 是否区分大小写 |
| **contains** | 输出包含预期关键词即可 | 开放性问题、长文本回答 | 无 |
| **similarity** | 计算语义相似度，超过阈值通过 | 语义等价但表述不同的回答 | `threshold`: 相似度阈值（0-1） |
| **llm_judge** | 用另一个 LLM 对输出质量打分 | 复杂主观问题、创意生成 | `model`: 评判模型, `criteria`: 评判维度 |
| **regex** | 输出匹配正则表达式 | 格式校验、提取特定内容 | `pattern`: 正则表达式 |

#### 6.3.3 评估器版本管理

与数据集类似，评估器也支持版本管理：

- **自动版本**：每次修改评估器配置后，系统会自动保存一个版本
- **查看版本**：进入评估器详情页 →「版本历史」
- **回滚版本**：选择历史版本 →「回滚到此版本」，恢复该版本的配置

> 评估器版本管理保证评测标准的一致性——即使标准被误改，也能快速恢复到之前的评测配置。

### 6.4 实验（Experiments）

实验是一次完整的评测执行过程。一个实验 = 一个数据集 + 一组模型配置 + N 个评估结果。

#### 6.4.1 创建实验

1. 左侧边栏 → 🧪 评测优化 → Experiments
2. 点击「创建实验」按钮
3. 填写：
   - **名称**：如「v1.2 模型效果评测」
   - **描述**：实验目的和背景
   - **数据集**：选择要使用的数据集
   - **模型配置**：JSON 格式的模型参数（如 `{ "model": "gpt-4", "temperature": 0.7 }`）
4. 点击「保存」

#### 6.4.2 运行实验

实验创建后，需要手动执行评测流程：

1. 点击实验的「开始实验」按钮，状态变为 **running**
2. 用你的 Agent 批量执行数据集中每个用例的 input，收集 output
3. 用评估器对每个 output 进行打分，判断是否通过
4. 把结果上报到系统（output、score、passed、latency_ms 等）
5. 所有用例执行完毕后，点击「完成实验」，状态变为 **completed**

#### 6.4.3 查看实验报告

实验完成后，可以查看详细的评测报告：

**统计概览**：
- **总用例数**：数据集中的用例总数
- **通过数 / 失败数**：按评估结果统计
- **通过率**：通过数 / 总用例数（百分比）
- **平均分**：所有用例得分的平均值
- **平均延迟**：所有用例执行延迟的平均值

**分数分布**：
- 各分数段的用例数量分布（柱状图）
- 帮助发现「大部分用例得分集中在什么区间」

**延迟分布**：
- 按延迟区间统计（0-500ms / 500-1000ms / 1000-2000ms / 2000ms+）
- 帮助发现性能瓶颈

**失败案例（Bad Cases）**：
- 列出所有未通过的用例
- 展示 input、expected_output、actual_output、得分、失败原因
- 点击单个案例可查看详情

> Bad Cases 是优化的核心依据——它们直接告诉你 Agent 在哪些场景下表现不好。

#### 6.4.4 多实验横向对比

当你做了多个版本的实验后，可以横向对比它们的效果：

1. 在 Experiments 列表页，勾选要对比的实验（至少 2 个）
2. 点击「对比实验」按钮
3. 系统生成对比表格：
   - 实验名称、状态
   - 总用例数、通过数、失败数
   - 通过率、平均分、平均延迟
4. 一眼看出哪个版本效果更好

**典型对比场景**：
- Prompt v1 vs Prompt v2：对比两个 Prompt 版本的评测效果
- GPT-4 vs Claude-3：对比不同模型在同一个数据集上的表现
- Temperature 0.3 vs 0.7：对比同一个模型在不同参数下的稳定性

---

## 7. 提示工程

提示工程模块帮助开发者管理 Prompt 的版本、在沙盒中快速调试、对比不同 Prompt 的效果。

### 7.1 Prompts（Prompt 管理）

#### 7.1.1 创建 Prompt

1. 左侧边栏 → 📝 提示工程 → Prompts
2. 点击「创建 Prompt」按钮
3. 填写：
   - **名称**：如「客服系统提示词」
   - **内容**：Prompt 文本内容
   - **变量**：Prompt 中使用的变量占位符（如 `{{user_name}}`）
4. 点击「保存」

#### 7.1.2 版本管理

每次修改 Prompt 内容并保存后，系统会自动创建一个新版本：

- **版本历史**：展示所有版本的变更记录
- **版本对比**：选择两个版本，查看 diff（增删改内容高亮）
- **版本回滚**：恢复到任意历史版本
- **设为当前版本**：指定某个版本为线上使用的版本

> Prompt 版本管理与 Git 类似，但专为 Prompt 优化设计，可以直接关联线上效果数据。

### 7.2 Playground（沙盒调试）

Playground 是一个交互式的 Prompt 调试环境，无需修改代码即可测试 Prompt 效果。

**使用步骤**：
1. 左侧边栏 → 📝 提示工程 → Playground
2. 选择要测试的 Prompt（或直接在编辑器中输入）
3. 填写变量值（如 `user_name = "张三"`）
4. 选择模型配置（模型、temperature、max_tokens 等）
5. 点击「运行」按钮
6. 查看模型输出结果

**变量注入**：
- 在 Prompt 中使用 `{{variable_name}}` 占位
- Playground 会自动识别所有变量并生成输入框
- 填写变量值后，系统会自动替换占位符并发送给模型

**迭代流程**：
1. 在 Playground 中修改 Prompt
2. 运行并观察输出
3. 不满意则继续修改，满意后点击「保存为新版本」
4. 新版本的 Prompt 可以直接用于评测实验

### 7.3 多模型对比

在 Playground 中，可以同时向多个模型发送相同的 Prompt，对比它们的输出差异：

1. 在 Playground 中输入 Prompt 和变量
2. 勾选要对比的模型（如 GPT-4、Claude-3、GPT-3.5）
3. 点击「对比运行」
4. 系统并行调用多个模型，并排展示输出结果

> 多模型对比是选择最优模型的利器——同样的输入，哪个模型输出更准确、更简洁、更符合预期，一目了然。

### 7.4 模型配置（Model Configs）

模型配置用于管理不同 LLM 的调用参数，可以在 Playground 和实验中复用。

**支持的参数**：
- **模型名称**：gpt-4、claude-3-opus、gpt-3.5-turbo 等
- **Temperature**：控制输出的随机性（0=确定性高，1=创造性高）
- **Max Tokens**：最大输出长度
- **Top P**：核采样参数
- **其他参数**：如 presence_penalty、frequency_penalty 等

**创建配置**：
1. 左侧边栏 → 📝 提示工程 → Model Configs
2. 点击「创建配置」
3. 填写参数，保存
4. 在 Playground 和实验中直接选择该配置

---

## 8. 系统设置

### 8.1 项目管理

项目是所有数据的隔离单元。

**创建项目**：
- 名称、描述、环境标签（dev / staging / prod）

**切换项目**：
- 顶部导航栏下拉切换
- 切换后所有页面数据自动刷新

**删除项目**：
- 删除项目会清空该项目下的所有数据（Traces、Sessions、Datasets 等）
- 操作不可逆，请谨慎

### 8.2 API Key 管理

API Key 用于 SDK 接入时的身份认证。

**生成 Key**：
1. 左侧边栏 → ⚙️ 系统 → API Keys
2. 点击「生成 API Key」
3. 输入名称，点击生成
4. **立即复制**（Key 值只显示一次）

**撤销 Key**：
- 如果 Key 泄露或不再使用，点击「撤销」按钮
- 撤销后的 Key 立即失效，已接入的 Agent 会停止上报数据

**Key 格式说明**：
- 格式：`project_id_random_key`
- 示例：`proj_abc123_xyz789`
- 系统会从 Key 中提取 project_id，用于数据归属

### 8.3 用户管理

- **修改密码**：在 Settings 页面修改登录密码
- **个人信息**：修改用户名、邮箱等

---

## 9. 典型工作流

### 工作流一：新 Agent 上线前的质量验证

```
Step 1: 准备评测数据
  ├── 创建数据集「客服场景评测集」
  ├── 手动添加核心场景的测试用例（20-50条）
  └── 用数据回流功能，把线上历史会话导入扩充

Step 2: 配置评估标准
  ├── 创建「精确匹配评估器」（用于结构化输出）
  ├── 创建「语义相似度评估器」（用于开放性问题）
  └── 创建「LLM Judge评估器」（用于主观质量评判）

Step 3: 执行评测实验
  ├── 创建实验「v1.0 上线前评测」
  ├── 绑定数据集和模型配置
  ├── 批量执行数据集用例，收集 Agent 输出
  └── 上报结果，完成实验

Step 4: 分析报告
  ├── 查看通过率（目标 > 90%）
  ├── 查看 Bad Cases（定位失败场景）
  └── 如果未达标，修复 Agent → 重新评测

Step 5: 上线
  ├── 实验通过后，Agent 正式上线
  └── 线上数据自动回流，持续补充评测集
```

### 工作流二：Prompt 迭代优化

```
Step 1: 发现问题
  ├── 查看实验报告，发现某类问题 Bad Cases 集中
  └── 或者在 Playground 中发现 Prompt 输出不符合预期

Step 2: 在 Playground 调试
  ├── 修改 Prompt 内容
  ├── 调整变量注入方式
  ├── 对比多个模型的输出
  └── 找到效果最好的 Prompt 版本

Step 3: 保存新版本
  ├── 保存为 Prompt v2
  ├── 对比 v1 和 v2 的内容差异

Step 4: 评测验证
  ├── 创建新实验「Prompt v2 效果评测」
  ├── 使用同样的数据集和评估器
  └── 与 v1 的实验做横向对比

Step 5: 决策
  ├── 如果 v2 效果更好 → 设为当前版本，更新线上 Agent
  └── 如果 v2 效果更差 → 回滚到 v1，继续在 Playground 调试
```

### 工作流三：线上问题排查

```
Step 1: 发现异常
  ├── Dashboard 发现成功率下降 / 延迟飙升
  └── 或者 Alerts 收到告警通知

Step 2: 定位问题 Trace
  ├── 打开 Traces 页面
  ├── 筛选状态为 error 的 Trace
  └── 找到异常时间段的失败调用

Step 3: 分析链路
  ├── 打开 Trace 详情，查看错误信息
  ├── 展开子调用树，定位失败发生在哪个环节
  └── 如果是 LLM 调用失败 → 查看输入参数和模型响应

Step 4: 查看会话上下文
  ├── 打开 Sessions 页面
  ├── 找到对应 Session
  └── 用 Unified 视图查看完整交互过程

Step 5: 修复 & 验证
  ├── 根据问题根因修复 Agent 代码或 Prompt
  ├── 在 Playground 中验证修复效果
  └── 重新运行评测实验，确认问题已解决
```

---

## 10. 常见问题

### Q1: 部署后访问前端显示空白？

**可能原因**：
- 后端没有启动：检查 `http://localhost:3000/health` 是否返回 `{"status":"ok"}`
- 前端构建失败：重新执行 `cd frontend && npm install && npm run build`

### Q2: SDK 接入后 Dashboard 没有数据？

**排查步骤**：
1. 检查后端是否运行：`curl http://localhost:3000/health`
2. 检查 API Key 是否正确（格式必须是 `project_id_key`）
3. 检查 SDK 的 `baseUrl` 是否正确
4. 检查浏览器 Network 面板，看请求是否成功
5. 检查后端日志，看是否有错误信息

### Q3: 数据回流后数据集里为什么没有内容？

**排查步骤**：
1. 确认 Session ID 是否正确
2. 确认该 Session 下是否有消息（Session 回流）或 Trace（Trace 回流）
3. 如果是 Trace 回流，确认是否设置了过滤条件导致没有匹配的 Trace

### Q4: 实验报告中的通过率为 0？

**可能原因**：
- 评估器配置不匹配：比如用 exact_match 评估开放性问题，会导致全部失败
- 没有上报结果：实验完成了但没有上传 Result 数据
- 评估阈值过高：比如 similarity 的 threshold 设为 0.95，实际达不到

**解决方法**：
- 检查评估器类型是否适合当前任务
- 确认是否已上传 Result（调用 `POST /evaluation/results`）
- 调整评估器参数（如降低 similarity threshold）

### Q5: 如何导出实验报告？

目前系统暂不支持直接导出 PDF/Excel 报告。 workaround：
- 实验报告和 Bad Cases 都可以通过 API 获取（`GET /evaluation/experiments/{id}/report`）
- 可以自行编写脚本调用 API 导出为所需格式

### Q6: 多团队协作时如何隔离数据？

**方案**：使用不同的项目隔离。
- 每个团队一个项目
- 每个项目有独立的 API Key
- 数据（Traces、Datasets、Experiments）完全隔离

### Q7: 生产环境推荐配置？

**数据库**：使用 PostgreSQL 替代 SQLite
**采样率**：SDK 配置 `sampleRate: 0.1`（只上报 10% 的 Trace）
**断点**：生产环境关闭断点调试 `enableBreakpoints: false`
**告警**：配置延迟、错误率、成本的告警阈值

---

## 附录

### A. 术语对照表

| 中文 | 英文 | 说明 |
|------|------|------|
| 追踪 | Trace | 一次完整的调用链路记录 |
| 会话 | Session | 用户与 Agent 的一次完整交互 |
| 数据集 | Dataset | 评测用例的集合 |
| 评估器 | Evaluator | 评判 Agent 输出质量的标准 |
| 实验 | Experiment | 一次完整的评测执行 |
| 回流 | Reflow | 把观测数据导入数据集的过程 |
| 坏案例 | Bad Case | 评测未通过的用例 |

### B. 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl/Cmd + K` | 全局搜索 |
| `Ctrl/Cmd + Shift + L` | 切换语言（中/英） |

### C. 支持的浏览器

- Chrome >= 90
- Firefox >= 88
- Safari >= 14
- Edge >= 90

---

> **反馈与帮助**
> 
> 遇到问题？
> - GitHub Issues: https://github.com/superwoman007/AgentMonitor/issues
> - 文档更新: 欢迎提交 PR 完善本文档
