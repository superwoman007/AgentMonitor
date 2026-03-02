
# AgentMonitor 🚀

**AI Agent 质量监控与调试平台 - 让你的 AI 应用调用一目了然！**

[![GitHub stars](https://img.shields.io/github/stars/your-username/agent-monitor?style=social)](https://github.com/your-username/agent-monitor/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/your-username/agent-monitor?style=social)](https://github.com/your-username/agent-monitor/network/members)
[![GitHub license](https://img.shields.io/github/license/your-username/agent-monitor)](https://github.com/your-username/agent-monitor/blob/main/LICENSE)
[![GitHub issues](https://img.shields.io/github/issues/your-username/agent-monitor)](https://github.com/your-username/agent-monitor/issues)

---

## ✨ 为什么用 AgentMonitor？

你是不是也在开发 AI 应用，但：

- 😫 不知道用户调用了多少次 AI？
- 😰 搞不清每次调用花了多少钱、多少 Token？
- 🤯 出错了找不到原因？
- 😓 想优化提示词但没数据支撑？
- 🐛 想调试 Agent 执行流程但无从下手？

**AgentMonitor 来救你了！** 轻量级、开箱即用的 AI 调用监控面板，5分钟接入，实时监控所有 AI 调用！

---

## 🎯 核心功能

### 📊 实时监控面板
- 总请求数、成功数/失败数、成功率
- 平均延迟、总 Token 消耗
- 实时 WebSocket 推送，无需刷新

### 🐛 断点调试（特色功能）⭐
- **断点设置** - 在任意步骤设置断点
- **执行暂停** - Agent 执行到断点自动暂停
- **状态检查** - 查看当前上下文、变量
- **单步执行** - 一步步调试 Agent 流程
- **继续/终止** - 控制执行流程

### 📈 质量分析
- 质量评分（0-100分）
- 速度评分：延迟 <500ms=100分, <2s=80分, <5s=50分
- 成功评分：成功100/失败0
- 质量趋势图表

### 💰 成本分析
- 成本总览（今日/本周/本月/总计）
- 成本趋势折线图
- 按模型分布饼图
- 最贵调用 TOP 10
- 成本优化建议

### 🚨 告警系统
- 延迟告警 - 响应超时自动告警
- 错误率告警 - 失败率过高告警
- 成本告警 - 每日花费超标告警
- 自定义条件告警

### 📝 其他功能
- 调用记录列表与详情
- 多项目管理
- API Key 管理
- 中英文切换
- 快照功能

---

## 🚀 快速开始

### 方式一：Docker 启动（生产环境推荐）

```bash
# 克隆项目
git clone https://github.com/your-username/agent-monitor.git
cd agent-monitor

# 启动所有服务
docker-compose up -d

# 访问面板
# 前端：http://localhost:5173
# 后端：http://localhost:3000
```

### 方式二：本地开发（SQLite 模式）

默认使用 SQLite，无需安装数据库，开箱即用：

```bash
# 安装依赖
cd backend && npm install
cd ../frontend && npm install

# 启动后端
cd backend && npm run dev

# 启动前端（新终端）
cd frontend && npm run dev

# 访问
# 前端：http://localhost:5173
# 后端：http://localhost:3000
```

### 方式三：Nginx 反向代理部署

```bash
# 1. 构建前端
cd frontend && npm run build

# 2. 启动后端
cd backend && npm start

# 3. 配置 Nginx（示例配置）
# /etc/nginx/conf.d/agentmonitor.conf
```

```nginx
server {
    listen 8080;
    server_name your-server-ip;

    root /path/to/agent-monitor/frontend/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    location /ws {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400;
    }
}
```

---

## 🔧 数据库配置

### SQLite（默认，开发推荐）

无需配置，数据存储在 `backend/data/agentmonitor.db`

### 切换到 PostgreSQL（生产推荐）

1. 安装 PostgreSQL 并创建数据库：
```bash
sudo apt install postgresql postgresql-contrib
sudo -u postgres createdb agentmonitor
```

2. 设置环境变量（二选一）：

方式 A - 环境变量：
```bash
export DB_TYPE=postgres
export DATABASE_URL=postgresql://user:password@localhost:5432/agentmonitor
```

方式 B - `.env` 文件（在 backend 目录）：
```env
DB_TYPE=postgres
DATABASE_URL=postgresql://user:password@localhost:5432/agentmonitor

# 或分开配置
DB_TYPE=postgres
PG_HOST=localhost
PG_PORT=5432
PG_USER=postgres
PG_PASSWORD=your-password
PG_DATABASE=agentmonitor
```

3. 重启后端服务即可自动迁移

### 数据库配置参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `DB_TYPE` | `sqlite` | 数据库类型：`sqlite` 或 `postgres` |
| `SQLITE_PATH` | `./data/agentmonitor.db` | SQLite 文件路径 |
| `DATABASE_URL` | - | PostgreSQL 连接字符串 |
| `PG_HOST` | `localhost` | PostgreSQL 主机 |
| `PG_PORT` | `5432` | PostgreSQL 端口 |
| `PG_USER` | `postgres` | PostgreSQL 用户 |
| `PG_PASSWORD` | `postgres` | PostgreSQL 密码 |
| `PG_DATABASE` | `agentmonitor` | PostgreSQL 数据库名 |

---

## 📦 环境变量

后端 `.env` 完整配置：
```env
# 服务配置
PORT=3000
NODE_ENV=development

# 数据库（二选一）
DB_TYPE=sqlite                    # sqlite 或 postgres
SQLITE_PATH=./data/agentmonitor.db

# PostgreSQL（DB_TYPE=postgres 时使用）
# DATABASE_URL=postgresql://user:pass@localhost:5432/agentmonitor

# JWT 认证
JWT_SECRET=your-secret-key-change-in-production
JWT_EXPIRES_IN=7d
```

---

## 📸 截图

| Dashboard | Sessions |
|----------|----------|
| ![Dashboard](./screenshots/dashboard.png) | ![Sessions](./screenshots/sessions.png) |

| Quality | Cost |
|---------|------|
| ![Quality](./screenshots/quality.png) | ![Cost](./screenshots/cost.png) |

| Alerts | Debugging |
|--------|-----------|
| ![Alerts](./screenshots/alerts.png) | ![Debugging](./screenshots/debugging.png) |

---

## 🛠️ 技术栈

| 层级 | 选型 |
|------|------|
| **前端** | React 19 + TailwindCSS + Vite + Recharts + Zustand |
| **后端** | Node.js + Fastify + PostgreSQL + WebSocket |
| **部署** | Docker + Nginx |
| **SDK** | 原生 JavaScript，零依赖 |

---

## 📁 项目结构

```
agent-monitor/
├── backend/           # 后端服务
│   ├── src/
│   │   ├── routes/    # API 路由
│   │   ├── services/  # 业务逻辑
│   │   ├── db/        # 数据库
│   │   └── middleware/
│   └── Dockerfile
├── frontend/          # 前端应用
│   ├── src/
│   │   ├── pages/     # 页面组件
│   │   ├── components/
│   │   ├── stores/    # Zustand 状态
│   │   └── api/       # API 封装
│   └── Dockerfile
├── demo-agent/        # 演示 Agent
│   └── src/
│       ├── agent.ts   # Agent 实现
│       └── index.ts   # 入口
├── sdk/               # 监控 SDK
│   └── simple.js      # 轻量 SDK
└── docker-compose.yml
```

---

## 📝 API 文档

### 认证
- `POST /api/v1/auth/register` - 注册
- `POST /api/v1/auth/login` - 登录

### 项目
- `GET /api/v1/projects` - 获取项目列表
- `POST /api/v1/projects` - 创建项目

### 调用追踪
- `GET /api/v1/traces` - 获取调用列表
- `POST /api/v1/traces` - 上报调用
- `GET /api/v1/sessions/:id` - 获取会话详情

### 断点调试
- `GET /api/v1/breakpoints` - 获取断点列表
- `POST /api/v1/breakpoints` - 设置断点
- `PUT /api/v1/breakpoints/:id` - 更新断点
- `DELETE /api/v1/breakpoints/:id` - 删除断点

### 质量分析
- `GET /api/v1/quality/score?projectId=xxx` - 获取质量分
- `GET /api/v1/quality/trend?projectId=xxx&days=7` - 获取趋势

### 成本分析
- `GET /api/v1/cost/summary?projectId=xxx` - 成本概览
- `GET /api/v1/cost/by-model?projectId=xxx` - 按模型统计
- `GET /api/v1/cost/top?projectId=xxx` - 最贵调用

### 告警
- `GET /api/v1/alerts?projectId=xxx` - 获取告警
- `POST /api/v1/alerts` - 创建告警
- `PUT /api/v1/alerts/:id` - 更新告警
- `DELETE /api/v1/alerts/:id` - 删除告警

---

## 🤝 贡献

欢迎 Issue 和 PR！有问题随时提！

---

## 📄 许可证

MIT License - 见 [LICENSE](./LICENSE)

---

**如果这个项目帮到你，请给个 ⭐ Star！这是对我最大的支持！**
