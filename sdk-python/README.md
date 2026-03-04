# AgentMonitor Python SDK

AI Agent 质量监控与调试 Python SDK

## 安装

```bash
pip install agentmonitor
```

## 快速开始

```python
from agentmonitor import AgentMonitor, SDKConfig

# 初始化
monitor = AgentMonitor.init(SDKConfig(
    api_key="your_project_id_your_api_key",
    base_url="http://localhost:3000",
))

# 方式 1：装饰器（推荐）
@monitor.wrap
def my_agent_function(query: str):
    # 你的 Agent 逻辑
    return f"Response to: {query}"

# 方式 2：手动追踪
from agentmonitor import TraceData

monitor.trace(TraceData(
    trace_type="llm",
    name="gpt-4",
    input={"prompt": "Hello"},
    output={"response": "Hi there!"},
    latency_ms=250,
    status="success",
))

# 方式 3：Session 管理
session = monitor.start_session(metadata={"user_id": "123"})

monitor.track_message(MessageData(
    session_id=session.id,
    role="user",
    content="What's the weather?",
))

monitor.end_session(session.id)

# 关闭
monitor.close()
```

## 功能特性

### 1. 函数包装

```python
# 同步函数
@monitor.wrap
def sync_function():
    return "result"

# 异步函数
@monitor.wrap
async def async_function():
    return "result"

# 自定义名称和 session
@monitor.wrap(name="custom_name", session_id="sess-123")
def my_function():
    pass
```

### 2. LLM 调用追踪

```python
import time

start = time.time()
response = openai.ChatCompletion.create(
    model="gpt-4",
    messages=[{"role": "user", "content": "Hello"}],
)
latency_ms = (time.time() - start) * 1000

monitor.trace_llm(
    model="gpt-4",
    request={"messages": [...]},
    response=response,
    latency_ms=latency_ms,
)
```

### 3. 断点调试

```python
from agentmonitor import BreakpointCheckContext, SnapshotState

# 设置断点暂停处理器
async def pause_handler(breakpoint, context, state):
    print(f"断点触发: {breakpoint.name}")
    print(f"当前状态: {state}")
    # 返回 True 继续执行，False 暂停
    return True

monitor.set_pause_handler(pause_handler)

# 追踪消息时自动检查断点
monitor.track_message(MessageData(
    session_id="sess-1",
    role="assistant",
    content="发生了 ERROR",  # 如果有关键词断点会触发
))
```

### 4. 采样机制

```python
# 采样 10%，但错误和断点总是上报
monitor = AgentMonitor.init(SDKConfig(
    api_key="...",
    sample_rate=0.1,  # 10% 采样率
    always_capture=["error", "breakpoint"],  # 强制上报
))
```

### 5. 变量管理

```python
# 设置变量（用于断点调试时查看状态）
monitor.set_variable("user_id", "123")
monitor.set_variable("context", {"key": "value"})

# 获取变量
user_id = monitor.get_variable("user_id")
all_vars = monitor.get_variables()
```

## 配置选项

```python
SDKConfig(
    api_key="required",              # 必填：API Key
    base_url="http://localhost:3000", # 后端地址
    disabled=False,                   # 是否禁用
    buffer_size=100,                  # 缓冲区大小
    flush_interval=5.0,               # 刷新间隔（秒）
    enable_breakpoints=True,          # 是否启用断点
    sample_rate=1.0,                  # 采样率 0-1
    always_capture=["error", "breakpoint"],  # 强制上报类型
)
```

## 最佳实践

### 生产环境配置

```python
import os

monitor = AgentMonitor.init(SDKConfig(
    api_key=os.getenv("AGENTMONITOR_API_KEY"),
    base_url=os.getenv("AGENTMONITOR_URL", "https://api.agentmonitor.dev"),
    enable_breakpoints=False,  # 生产环境关闭断点
    sample_rate=0.1,           # 采样 10% 减少开销
))
```

### 错误处理

```python
try:
    result = my_agent_function()
except Exception as e:
    monitor.trace(TraceData(
        trace_type="error",
        name="agent_error",
        error=str(e),
        status="error",
    ))
    raise
```

### 上下文管理器

```python
class MonitoredSession:
    def __init__(self, monitor, metadata=None):
        self.monitor = monitor
        self.metadata = metadata
        self.session = None

    def __enter__(self):
        self.session = self.monitor.start_session(metadata=self.metadata)
        return self.session

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.monitor.end_session(self.session.id)

# 使用
with MonitoredSession(monitor, {"user": "alice"}) as session:
    # 你的 Agent 逻辑
    pass
```

## 许可证

MIT License
