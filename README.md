# AgentMonitor 🚀

**AI Agent 可观测、可评测、可调试的一体化平台。**

AgentMonitor 为 AI Agent 与 LLM 应用提供实时监控、链路追踪、断点调试、质量评测、成本分析与告警能力，让 Agent 的每一次调用都清晰可见、问题可定位、效果可衡量。

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-green)](./backend/package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6)](./backend/tsconfig.json)

---

## 🌐 在线体验

无需安装，立即体验完整功能：

> 🔗 **体验地址**：**[https://14.103.80.198](https://14.103.80.198)**
>
> 🔑 **演示账号**：`demo@agentmonitor.dev` ／ 密码：`Demo@View#2026`
>
> 演示账号内已预置真实的 Agent 调用、会话、工具调用与决策数据，可直接浏览仪表盘、追踪、评测等全部页面。
>
> ⚠️ 体验环境使用自签名证书，浏览器如提示"不安全/您的连接不是私密连接"，点击"高级 → 继续访问"即可；也可选择 [一键本地启动](#-快速开始)。

---

## 📸 产品截图

### 实时监控仪表盘

总请求数、成功率、平均延迟、Token 消耗一览无余，WebSocket 实时推送，内置 SDK 接入健康诊断。

![实时监控仪表盘](./screenshots/dashboard.png)

### 调用链路追踪

自动采集 Agent / LLM / Tool 全链路调用，支持类型筛选、状态过滤、耗时区间与关键字检索，点击即可查看完整输入输出。

![调用链路追踪](./screenshots/traces.png)

### 会话回放

按会话维度还原 Agent 与用户的完整交互过程，支持 Timeline / Chat / Unified 多种视图。

![会话回放](./screenshots/sessions.png)

### 评测中心

数据集、评估器、实验、报告一站式管理，支持规则评分与 LLM Judge，一键回归、横向对比。

![评测中心](./screenshots/evaluation.png)

### 提示工程

Prompt 版本管理、diff 对比、回滚，Playground 多模型并行对比调试。

![提示工程](./screenshots/prompts.png)

### 断点调试 ⭐

在 Agent 执行链路任意节点设置断点，命中即暂停，支持单步执行、上下文变量检查与状态快照回放。

![断点调试](./screenshots/debugging.png)

### 决策监控

追踪 Agent 的关键决策过程，记录决策类型、结论、置信度与规则依据，让"黑盒"决策可解释。

![决策监控](./screenshots/decisions.png)

### 质量 · 成本 · 告警

| 质量分析 | 成本分析 |
|:---:|:---:|
| ![质量分析](./screenshots/quality.png) | ![成本分析](./screenshots/cost.png) |

![告警中心](./screenshots/alerts.png)

---

## ✨ 核心特性

- **📊 实时监控面板** —— 请求数、成功率、延迟、Token 实时统计，趋势图表 + WebSocket 推送。
- **🔍 全链路追踪（Span/Trace）** —— 类 OpenTelemetry 模型，支持嵌套、并行、父子关联的调用树。
- **🐛 断点调试（特色）** —— 断点设置、执行暂停、单步执行、变量检查、快照回放。
- **🧪 评测中心** —— 数据集版本管理、5 种评估器、LLM Judge、实验报告与 Bad Case 回流。
- **📝 提示工程** —— Prompt 版本/diff/回滚、Playground 多模型对比、改动自动回归。
- **🧠 决策监控** —— 决策类型、置信度、规则依据的可解释追踪。
- **💰 成本分析** —— 成本总览/趋势、按模型分布、最贵调用 TOP 榜与优化建议。
- **🚨 智能告警** —— 延迟、错误率、成本阈值告警，支持自定义条件。
- **🌍 多语言 SDK** —— TypeScript / Python / Go，3 行代码接入，框架无关、模型无关。
- **🗄️ 轻量部署** —— SQLite 开箱即用，生产可切换 PostgreSQL，支持 Docker / Nginx。

---

## 🚀 快速开始

### 方式一：Docker 一键启动（推荐）

```bash
# 克隆项目
git clone https://github.com/superwoman007/AgentMonitor.git
cd AgentMonitor

# 启动所有服务
docker-compose up -d

# 访问
# 前端：http://localhost:5173
# 后端：http://localhost:3000
```

### 方式二：本地开发（SQLite 模式，无需数据库）

```bash
# 安装依赖
cd backend && npm install
cd ../frontend && npm install

# 启动后端（终端 1）
cd backend && npm run dev

# 启动前端（终端 2）
cd frontend && npm run dev
```

启动后访问前端 `http://localhost:5173`，注册账号即可使用；在「设置 → API Keys」中创建 Key 供 SDK 上报。

---

## 📦 SDK 接入

AgentMonitor 提供三种语言 SDK，3 行代码即可接入。完整说明见 **[SDK 快速接入指南](./docs/SDK-QUICKSTART.md)**。

### TypeScript / JavaScript

```bash
npm install @agentmonitor/sdk
```

```typescript
import { AgentMonitor } from '@agentmonitor/sdk';

const monitor = AgentMonitor.init({
  apiKey: 'your_api_key',
  baseUrl: 'http://localhost:3000',
});

// 包裹任意 Agent / LLM 调用即可自动上报
const monitoredFn = monitor.wrap(async (query) => {
  return await callLLM(query);
});
```

### Python

```bash
pip install agentmonitor
```

```python
from agentmonitor import AgentMonitor, SDKConfig

monitor = AgentMonitor.init(SDKConfig(
    api_key='your_api_key',
    base_url='http://localhost:3000',
))

@monitor.wrap
def my_agent(query):
    return call_llm(query)
```

### Go

```bash
go get github.com/superwoman007/AgentMonitor/sdk-go/agentmonitor
```

```go
import "github.com/superwoman007/AgentMonitor/sdk-go/agentmonitor"

monitor := agentmonitor.Init(&agentmonitor.SDKConfig{
    APIKey:  "your_api_key",
    BaseURL: "http://localhost:3000",
})
defer monitor.Close()
```

---

## 🛠️ 技术栈

| 层级 | 选型 |
|------|------|
| **前端** | React 19 + TypeScript + Vite + TailwindCSS + Zustand + Recharts |
| **后端** | Node.js + Fastify + WebSocket |
| **数据库** | SQLite（开发开箱即用）／ PostgreSQL（生产推荐） |
| **部署** | Docker + Docker Compose + Nginx |
| **SDK** | TypeScript / Python / Go，框架无关、模型无关 |

---

## 📚 文档

- **[SDK 快速接入指南](./docs/SDK-QUICKSTART.md)** —— 三语言 SDK 接入与自动埋点
- **[部署指南](./docs/DEPLOYMENT.md)** —— 本地开发、Docker、生产环境部署
- **[生产部署指南](./docs/生产部署指南.md)** —— 服务器、Nginx、HTTPS 完整流程
- **[用户指南](./docs/USER-GUIDE.md)** —— 各功能模块使用说明
- **[产品设计文档](./docs/PRODUCT-DESIGN.md)** —— 产品定位与功能设计

### 环境变量

后端通过 `.env` 配置（参见 `.env.example`），关键项：

```env
# 服务
PORT=3000
NODE_ENV=development

# 数据库：sqlite（默认）或 postgres
DB_TYPE=sqlite
SQLITE_PATH=./data/agentmonitor.db
# DB_TYPE=postgres
# DATABASE_URL=postgresql://user:pass@localhost:5432/agentmonitor

# 认证
JWT_SECRET=your-secret-key-change-in-production
JWT_EXPIRES_IN=7d
```

---

## 🤝 参与贡献

欢迎提交 Issue 与 Pull Request，一起把 Agent 可观测性做得更好！

## 📄 许可证

[MIT License](./LICENSE)

---

**如果 AgentMonitor 帮到了你，欢迎点个 ⭐ Star，这是对我们最大的支持！**
