# AgentMonitor SDK 快速接入指南

> 3 行代码接入 AI Agent 监控，支持 TypeScript/JavaScript、Python、Go

## 📦 安装

### TypeScript/JavaScript (Node.js)

```bash
npm install @agentmonitor/sdk
# 或
yarn add @agentmonitor/sdk
```

### Python

```bash
pip install agentmonitor
```

### Go

```bash
go get github.com/superwoman007/AgentMonitor/sdk-go/agentmonitor
```

---

## 🚀 快速开始（3 步接入）

### 1️⃣ 获取 API Key

1. 访问 AgentMonitor 面板：http://localhost:5174
2. 注册账号 → 创建项目
3. 在 Settings 页面生成 API Key

### 2️⃣ 初始化 SDK

<details>
<summary><b>TypeScript/JavaScript</b></summary>

```typescript
import { AgentMonitor } from '@agentmonitor/sdk';

const monitor = AgentMonitor.init({
  apiKey: 'your_project_id_your_api_key',
  baseUrl: 'http://localhost:3000', // 后端地址
});
```

</details>

<details>
<summary><b>Python</b></summary>

```python
from agentmonitor import AgentMonitor, SDKConfig

monitor = AgentMonitor.init(SDKConfig(
    api_key='your_project_id_your_api_key',
    base_url='http://localhost:3000',
))
```

</details>

<details>
<summary><b>Go</b></summary>

```go
import "github.com/superwoman007/AgentMonitor/sdk-go/agentmonitor"

monitor := agentmonitor.Init(&agentmonitor.SDKConfig{
    APIKey:  "your_project_id_your_api_key",
    BaseURL: "http://localhost:3000",
})
defer monitor.Close()
```

</details>

### 3️⃣ 包装你的 Agent 函数

<details>
<summary><b>TypeScript/JavaScript</b></summary>

```typescript
// 方式 1：wrap() 装饰器（推荐）
const monitoredFunction = monitor.wrap(async (query: string) => {
  // 你的 Agent 逻辑
  const response = await callLLM(query);
  return response;
});

// 调用
const result = await monitoredFunction('Hello');
```

</details>

<details>
<summary><b>Python</b></summary>

```python
# 方式 1：装饰器（推荐）
@monitor.wrap
def my_agent(query: str):
    # 你的 Agent 逻辑
    response = call_llm(query)
    return response

# 调用
result = my_agent('Hello')
```

</details>

<details>
<summary><b>Go</b></summary>

```go
// 方式 1：Wrap 包装器（推荐）
result, err := monitor.Wrap(func() (interface{}, error) {
    // 你的 Agent 逻辑
    response, err := callLLM(query)
    return response, err
}, "my_agent", "")
```

</details>

---

## 🎯 完整示例

### TypeScript/JavaScript

```typescript
import { AgentMonitor } from '@agentmonitor/sdk';
import OpenAI from 'openai';

const monitor = AgentMonitor.init({
  apiKey: process.env.AGENTMONITOR_API_KEY!,
  baseUrl: 'http://localhost:3000',
});

const openai = new OpenAI();

// 包装 Agent 函数
const chatAgent = monitor.wrap(async (userMessage: string) => {
  const session = monitor.startSession();
  
  // 追踪用户消息
  monitor.trackMessage({
    sessionId: session.id,
    role: 'user',
    content: userMessage,
  });
  
  // 调用 LLM
  const start = Date.now();
  const response = await openai.chat.completions.create({
    model: 'gpt-4',
    messages: [{ role: 'user', content: userMessage }],
  });
  const latencyMs = Date.now() - start;
  
  // 追踪 LLM 调用
  monitor.traceLLM(
    'gpt-4',
    { messages: [{ role: 'user', content: userMessage }] },
    response,
    latencyMs
  );
  
  const assistantMessage = response.choices[0].message.content;
  
  // 追踪助手回复
  monitor.trackMessage({
    sessionId: session.id,
    role: 'assistant',
    content: assistantMessage,
  });
  
  monitor.endSession(session.id);
  return assistantMessage;
}, { name: 'chat_agent' });

// 使用
const answer = await chatAgent('What is the weather today?');
console.log(answer);

// 关闭（应用退出时）
monitor.close();
```

### Python

```python
from agentmonitor import AgentMonitor, SDKConfig, MessageData
import openai
import time
import os

monitor = AgentMonitor.init(SDKConfig(
    api_key=os.getenv('AGENTMONITOR_API_KEY'),
    base_url='http://localhost:3000',
))

@monitor.wrap
def chat_agent(user_message: str):
    session = monitor.start_session()
    
    # 追踪用户消息
    monitor.track_message(MessageData(
        session_id=session.id,
        role='user',
        content=user_message,
    ))
    
    # 调用 LLM
    start = time.time()
    response = openai.ChatCompletion.create(
        model='gpt-4',
        messages=[{'role': 'user', 'content': user_message}],
    )
    latency_ms = (time.time() - start) * 1000
    
    # 追踪 LLM 调用
    monitor.trace_llm(
        'gpt-4',
        {'messages': [{'role': 'user', 'content': user_message}]},
        response,
        latency_ms,
    )
    
    assistant_message = response.choices[0].message.content
    
    # 追踪助手回复
    monitor.track_message(MessageData(
        session_id=session.id,
        role='assistant',
        content=assistant_message,
    ))
    
    monitor.end_session(session.id)
    return assistant_message

# 使用
answer = chat_agent('What is the weather today?')
print(answer)

# 关闭
monitor.close()
```

### Go

```go
package main

import (
    "context"
    "fmt"
    "os"
    "time"
    
    "github.com/sashabaranov/go-openai"
    "github.com/superwoman007/AgentMonitor/sdk-go/agentmonitor"
)

func main() {
    monitor := agentmonitor.Init(&agentmonitor.SDKConfig{
        APIKey:  os.Getenv("AGENTMONITOR_API_KEY"),
        BaseURL: "http://localhost:3000",
    })
    defer monitor.Close()
    
    client := openai.NewClient(os.Getenv("OPENAI_API_KEY"))
    
    // 包装 Agent 函数
    result, err := monitor.Wrap(func() (interface{}, error) {
        session := monitor.StartSession("", map[string]interface{}{
            "user": "alice",
        })
        
        userMessage := "What is the weather today?"
        
        // 追踪用户消息
        monitor.TrackMessage(agentmonitor.MessageData{
            SessionID: session.ID,
            Role:      "user",
            Content:   userMessage,
        })
        
        // 调用 LLM
        start := time.Now()
        resp, err := client.CreateChatCompletion(
            context.Background(),
            openai.ChatCompletionRequest{
                Model: openai.GPT4,
                Messages: []openai.ChatCompletionMessage{
                    {Role: openai.ChatMessageRoleUser, Content: userMessage},
                },
            },
        )
        if err != nil {
            return nil, err
        }
        latencyMs := float64(time.Since(start).Milliseconds())
        
        // 追踪 LLM 调用
        monitor.TraceLLM(
            "gpt-4",
            map[string]interface{}{"messages": []interface{}{
                map[string]string{"role": "user", "content": userMessage},
            }},
            resp,
            latencyMs,
            true,
            "",
        )
        
        assistantMessage := resp.Choices[0].Message.Content
        
        // 追踪助手回复
        monitor.TrackMessage(agentmonitor.MessageData{
            SessionID: session.ID,
            Role:      "assistant",
            Content:   assistantMessage,
        })
        
        monitor.EndSession(session.ID)
        return assistantMessage, nil
    }, "chat_agent", "")
    
    if err != nil {
        panic(err)
    }
    
    fmt.Println(result)
}
```

---

## ⚙️ 配置选项

### 基础配置

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `apiKey` | string | **必填** | 项目 API Key |
| `baseUrl` | string | `http://localhost:3000` | 后端地址 |
| `disabled` | boolean | `false` | 是否禁用 SDK |

### 性能优化配置

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `bufferSize` | number | `100` | 缓冲区大小 |
| `flushInterval` | number | `5000` (ms) | 刷新间隔 |
| `sampleRate` | number | `1.0` | 采样率 (0-1) |
| `alwaysCapture` | string[] | `['error', 'breakpoint']` | 强制上报类型 |

### 调试配置

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `enableBreakpoints` | boolean | `true` | 是否启用断点调试 |

### 生产环境推荐配置

```typescript
// TypeScript/JavaScript
const monitor = AgentMonitor.init({
  apiKey: process.env.AGENTMONITOR_API_KEY!,
  baseUrl: process.env.AGENTMONITOR_URL || 'https://api.agentmonitor.dev',
  enableBreakpoints: false,  // 生产环境关闭断点
  sampleRate: 0.1,           // 采样 10% 减少开销
});
```

```python
# Python
monitor = AgentMonitor.init(SDKConfig(
    api_key=os.getenv('AGENTMONITOR_API_KEY'),
    base_url=os.getenv('AGENTMONITOR_URL', 'https://api.agentmonitor.dev'),
    enable_breakpoints=False,  # 生产环境关闭断点
    sample_rate=0.1,           # 采样 10% 减少开销
))
```

```go
// Go
monitor := agentmonitor.Init(&agentmonitor.SDKConfig{
    APIKey:            os.Getenv("AGENTMONITOR_API_KEY"),
    BaseURL:           getEnv("AGENTMONITOR_URL", "https://api.agentmonitor.dev"),
    EnableBreakpoints: false, // 生产环境关闭断点
    SampleRate:        0.1,   // 采样 10% 减少开销
})
```

---

## 🔧 高级功能

### 1. 断点调试

在开发环境设置断点，Agent 执行到关键词/错误/延迟阈值时自动暂停：

```typescript
// 在面板中设置断点：
// - 类型：关键词
// - 条件：ERROR
// - 启用：是

// SDK 会自动检查断点并暂停
monitor.trackMessage({
  sessionId: 'sess-1',
  role: 'assistant',
  content: '发生了 ERROR',  // 触发断点
});
```

#### 断点拉取与快照（API Key）

SDK 使用 API Key 拉取断点与创建快照（自托管场景默认启用）：

- `GET /api/v1/breakpoints/public`
- `POST /api/v1/snapshots`

请求头支持：`X-API-Key` 或 `Authorization: Bearer <API_KEY>`。

### 2. 采样机制

高频场景下降低开销：

```typescript
const monitor = AgentMonitor.init({
  apiKey: '...',
  sampleRate: 0.1,  // 只上报 10% 的 trace
  alwaysCapture: ['error', 'breakpoint'],  // 但错误和断点总是上报
});
```

### 3. 变量管理

在断点调试时查看 Agent 状态：

```typescript
monitor.setVariable('user_id', '123');
monitor.setVariable('context', { key: 'value' });

// 断点触发时，面板会显示这些变量
```

### 4. 多轮对话追踪

```typescript
const session = monitor.startSession({ user_id: '123' });

// 第 1 轮
monitor.trackMessage({ sessionId: session.id, role: 'user', content: 'Hello' });
monitor.trackMessage({ sessionId: session.id, role: 'assistant', content: 'Hi!' });

// 第 2 轮
monitor.trackMessage({ sessionId: session.id, role: 'user', content: 'How are you?' });
monitor.trackMessage({ sessionId: session.id, role: 'assistant', content: 'Good!' });

monitor.endSession(session.id);
```

---

## 🧪 Demo Agent 快速体验

如果你想快速看到效果，可以直接运行内置 demo-agent：

1) 启动后端与前端

```bash
./start-all.sh
```

2) 构建本地 SDK（demo-agent 依赖本地 dist）

```bash
cd sdk
npm install
npm run build
```

3) 配置 demo-agent 环境变量（复制 `demo-agent/.env.example`）

```env
MONITOR_API_KEY=your-api-key-here
MONITOR_API_URL=http://localhost:3000

# 兼容写法（可选）
AGENTMONITOR_API_KEY=your-api-key-here
AGENTMONITOR_BASE_URL=http://localhost:3000
```

4) 运行 demo-agent

```bash
cd demo-agent
npm install
npm run dev
```

5) 打开面板查看效果

- Dashboard: http://localhost:5174/dashboard
- Sessions: http://localhost:5174/sessions
- Debugging: http://localhost:5174/debugging

#### 会话/消息自动同步

当上报 trace 时：

- 只要携带 `sessionId`，后端会自动创建会话记录（若不存在）。
- `trackMessage` 产生的 message trace 会同步写入消息列表，Sessions 页面可直接回放。

---

## 🐛 常见问题

### Q: SDK 会影响 Agent 性能吗？

**A:** 影响极小：
- 数据写入内存 buffer，异步批量上报
- 生产环境可设置 `sampleRate=0.1` 采样 10%
- 断点检查是本地匹配，无网络请求（除非命中）

### Q: 如何在生产环境使用？

**A:** 推荐配置：
```typescript
{
  enableBreakpoints: false,  // 关闭断点
  sampleRate: 0.1,           // 采样 10%
  alwaysCapture: ['error'],  // 只强制上报错误
}
```

### Q: 支持哪些 LLM 框架？

**A:** 框架无关，支持所有 LLM：
- OpenAI SDK
- LangChain
- LlamaIndex
- Anthropic Claude
- 自定义 LLM 调用

只需在调用前后用 `traceLLM()` 包装即可。

### Q: 数据会发送到哪里？

**A:** 
- 默认发送到 `http://localhost:3000`（本地部署）
- 可配置 `baseUrl` 指向你的私有部署
- 支持自托管，数据完全在你的控制下

### Q: 如何卸载 SDK？

**A:** 
```typescript
// 1. 设置 disabled: true
const monitor = AgentMonitor.init({ apiKey: '...', disabled: true });

// 2. 或者直接移除 SDK 代码
```

### Q: 运行 demo-agent 后看不到数据？

**A:** 按顺序排查：

1. 后端是否运行：`http://localhost:3000/health`
2. API Key 是否正确（Settings 页面重新生成）
3. 是否先构建 SDK：`cd sdk && npm run build`
4. demo-agent 是否读取到环境变量（确认 `.env` 路径与变量名）

---

## 📚 更多资源

- **完整 API 文档**: [TypeScript](../sdk/README.md) | [Python](../sdk-python/README.md) | [Go](../sdk-go/README.md)
- **示例代码**: [examples/](../examples/)
- **GitHub**: https://github.com/superwoman007/AgentMonitor
- **问题反馈**: https://github.com/superwoman007/AgentMonitor/issues

---

## 🎉 下一步

SDK 接入完成后，访问 AgentMonitor 面板查看：

1. **Dashboard** - 实时监控（请求数、成功率、延迟、Token）
2. **Sessions** - 会话列表和详情回放
3. **Debugging** - 断点调试和快照查看
4. **Quality** - 质量评估和趋势分析
5. **Cost** - 成本分析和优化建议

开始监控你的 AI Agent 吧！🚀
