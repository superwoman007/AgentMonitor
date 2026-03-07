# Demo Agent - 智能客服 AI

演示 AgentMonitor 监控功能的智能客服 Agent。

## 功能演示

- 多轮对话
- 工具调用（查询天气、订单状态）
- 故意触发错误（展示断点调试）
- 高延迟调用（展示延迟断点）
- 完整接入 AgentMonitor SDK

## 快速开始

### 1. 启动后端与前端

```bash
./start-all.sh
```

### 2. 构建本地 SDK

demo-agent 依赖本地 SDK 的 `dist` 目录：

```bash
cd sdk
npm install
npm run build
```

### 3. 安装依赖

```bash
cd demo-agent
npm install
```

### 4. 配置环境变量

创建 `.env` 文件：

```env
# AgentMonitor API 配置
MONITOR_API_KEY=your-api-key-here
MONITOR_API_URL=http://localhost:3000
```

### 5. 运行 Demo

```bash
npm run dev
```

### 6. 查看效果

- Dashboard: http://localhost:5174/dashboard
- Sessions: http://localhost:5174/sessions
- Debugging: http://localhost:5174/debugging

## Demo 场景

1. **普通对话** - 展示基本监控
2. **查询天气** - 展示工具调用监控
3. **触发错误** - 展示断点调试（错误断点）
4. **高延迟调用** - 展示延迟断点

## 断点配置建议

在 AgentMonitor 中设置以下断点：

### 错误断点
- 类型: `error`
- 条件: `.*`

### 延迟断点
- 类型: `latency`
- 条件: `> 3000`

### 关键词断点
- 类型: `keyword`
- 条件: `订单,天气`

## 代码结构

```
demo-agent/
├── src/
│   ├── index.ts    - 主入口
│   ├── agent.ts    - Agent 核心逻辑
│   └── tools.ts    - 工具函数
├── package.json
├── tsconfig.json
└── README.md
```

## 常见问题

### 运行后看不到数据？

1. 检查后端健康：`http://localhost:3000/health`
2. 确认 API Key 正确（Settings 页面重新生成）
3. 确认 SDK 已构建：`cd sdk && npm run build`
4. 确认 `.env` 变量名与路径正确
