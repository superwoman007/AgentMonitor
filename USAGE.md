
# AgentMonitor 使用说明

## 目录

1. [快速开始](#快速开始)
2. [SDK 集成](#sdk-集成)
3. [API 文档](#api-文档)
4. [部署指南](#部署指南)
5. [常见问题](#常见问题)
6. [功能规划](#功能规划)

---

## 快速开始

### 前置条件

- Node.js 18+
- npm / yarn

### 本地运行

```bash
# 1. 克隆项目
git clone https://github.com/your-username/agent-monitor.git
cd agent-monitor

# 2. 安装依赖
cd backend &amp;&amp; npm install
cd ../frontend &amp;&amp; npm install
cd ../sdk &amp;&amp; npm install

# 3. 一键启动
./start-all.sh
```

### 服务说明

启动后会运行 3 个服务：

| 服务 | 端口 | 说明 |
|------|------|------|
| 后端 | 3000 | API + WebSocket |
| 前端 | 5173 | 监控面板 |
| SDK Demo | - | 演示 SDK 使用（可选） |

---

## SDK 集成

### JavaScript SDK 使用

```javascript
// 1. 导入 SDK
import AgentMonitor from './sdk/simple.js';

// 2. 初始化（填后端地址）
const monitor = new AgentMonitor('http://localhost:3000');

// 3. 包裹你的 AI 调用
const result = await monitor.wrap(async () =&gt; {
  // 这里是你原本的代码
  return await openai.chat.completions.create({
    model: 'gpt-4',
    messages: [{ role: 'user', content: 'Hello!' }]
  });
});
```

### 手动上报（不使用 wrap）

```javascript
const monitor = new AgentMonitor('http://localhost:3000');

await monitor.trace({
  model: 'gpt-4',
  success: true,
  latencyMs: 1234,
  request: { messages: [...] },
  response: { choices: [...] },
  error: null // 可选
});
```

---

## API 文档

### GET /health

健康检查

```bash
curl http://localhost:3000/health
```

响应：
```json
{ "status": "ok", "traces": 12345 }
```

### GET /api/v1/traces

获取调用记录列表

```bash
curl http://localhost:3000/api/v1/traces
```

响应：
```json
{
  "traces": [
    {
      "id": "uuid",
      "model": "gpt-4",
      "success": true,
      "latencyMs": 1234,
      "timestamp": "2026-02-27T00:00:00.000Z"
    }
  ]
}
```

### GET /api/v1/stats

获取统计数据

```bash
curl http://localhost:3000/api/v1/stats
```

响应：
```json
{
  "totalRequests": 100,
  "successfulRequests": 95,
  "successRate": 95.0,
  "avgLatency": 1234,
  "totalTokens": 50000
}
```

### POST /api/v1/traces

手动上报调用记录

```bash
curl -X POST http://localhost:3000/api/v1/traces \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4",
    "success": true,
    "latencyMs": 1234,
    "request": {},
    "response": {}
  }'
```

### WebSocket /api/v1/ws

实时推送新调用记录

```javascript
const ws = new WebSocket('ws://localhost:3000/api/v1/ws');

ws.onmessage = (event) =&gt; {
  const data = JSON.parse(event.data);
  if (data.type === 'new_trace') {
    console.log('New trace:', data.data);
  }
};
```

---

## 部署指南

### Docker 部署

```bash
# 构建镜像
docker build -t agent-monitor .

# 运行容器
docker run -p 3000:3000 -p 5173:5173 agent-monitor
```

### 生产环境部署建议

1. 使用 Nginx 做反向代理
2. 配置 HTTPS
3. 使用 PM2 管理 Node 进程
4. 配置日志轮转
5. 配置数据库（当前版本使用内存存储，生产建议用 PostgreSQL）

---

## 常见问题

### Q: 前端访问 404？
A: 检查 `index.html` 中的引用路径是否正确，应该是 `/src/main.jsx`。

### Q: SDK 上报失败？
A: 检查后端地址是否正确，确保后端服务在运行。

### Q: WebSocket 连不上？
A: 检查防火墙设置，确认 3000 端口开放。

---

## 功能规划

### 当前已实现 ✅

- [x] 实时监控面板（5个数据卡片）
- [x] 调用记录列表
- [x] 详情查看
- [x] WebSocket 实时推送
- [x] 中英文切换
- [x] 连接状态指示

### 近期规划 🚧

- [ ] **告警系统** - 失败率、延迟过高自动告警（邮件/钉钉/企业微信）
- [ ] **多项目支持** - 一个面板监控多个 AI 应用
- [ ] **成本分析** - 按模型/时间/用户的成本统计和图表
- [ ] **提示词优化建议** - AI 自动分析调用记录，给出优化建议
- [ ] **导出功能** - 导出调用记录为 CSV/JSON
- [ ] **用户权限** - 多用户登录、RBAC 权限管理
- [ ] **与 PromptHub 集成** - 一键导入提示词测试
- [ ] **持久化存储** - PostgreSQL 替代内存存储

### 长期展望 🔮

- [ ] **A/B 测试** - 提示词 A/B 测试，自动对比效果
- [ ] **智能告警** - 基于异常检测的智能告警
- [ ] **API 网关** - AgentMonitor 作为 AI API 网关
- [ ] **开源插件生态** - 支持第三方插件扩展

---

## 贡献

欢迎 Issue 和 PR！有问题随时提！

---

## 许可证

MIT License
