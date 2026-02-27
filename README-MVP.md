
# AgentMonitor - MVP 快速启动指南

## 🚀 目标：后天拿出可运行的 MVP！

## 快速启动（3 个终端）

### 终端 1 - 启动后端
```bash
cd backend
npm install   # 如果没装过
npm run start:mvp:js
```
后端将运行在：http://localhost:3000

### 终端 2 - 启动前端
```bash
cd frontend
npm install   # 如果没装过
npm run dev
```
前端将运行在：http://localhost:5173

### 终端 3 - 启动 OpenAI Demo（发送测试数据）
```bash
cd sdk
node demo-openai.js
```
（不需要编译，直接用 node 跑纯 JS 版本）

---

## MVP 功能（2 天版本）

✅ **TypeScript SDK** - 1 行代码初始化 + 1 行代码追踪
✅ **后端 API** - 内存存储，接收 traces，WebSocket 实时推送
✅ **前端监控面板** - 实时指标（请求量/成功率/延迟/Token）
✅ **会话列表** - 最近请求列表
✅ **请求详情** - 点开看完整请求/响应/Token 消耗
✅ **OpenAI Demo** - 1 行代码接入示例

---

## 演示目标

创始人打开 http://localhost:5173 能看到：
- 实时监控数据卡片（5个指标）
- 最近请求列表（左侧）
- 点开会话能看到完整的请求/响应内容（右侧）
- 有新请求自动刷新（WebSocket 实时）

---

## 架构（无数据库，内存版本）

```
SDK (demo-openai.ts) 
    ↓ POST /api/v1/traces
后端 (mvp-server.ts) → 内存存储
    ↓ WebSocket
前端 (MvpApp.tsx) → 实时展示
```

---

## 文件说明

- `backend/src/mvp-server.ts` - MVP 后端
- `frontend/src/MvpApp.tsx` - MVP 前端
- `sdk/src/simple.ts` - 最简 SDK
- `sdk/demo-openai.ts` - OpenAI 调用 Demo
