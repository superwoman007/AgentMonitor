# AgentMonitor Go SDK

AI Agent 质量监控与调试 Go SDK

## 安装

```bash
go get github.com/superwoman007/AgentMonitor/sdk-go/agentmonitor
```

## 快速开始

```go
package main

import (
	"fmt"
	"time"
	
	"github.com/superwoman007/AgentMonitor/sdk-go/agentmonitor"
)

func main() {
	// 初始化
	monitor := agentmonitor.Init(&agentmonitor.SDKConfig{
		APIKey:  "your_project_id_your_api_key",
		BaseURL: "http://localhost:3000",
	})
	defer monitor.Close()

	// 方式 1：包装函数
	result, err := monitor.Wrap(func() (interface{}, error) {
		// 你的 Agent 逻辑
		return "result", nil
	}, "my_function", "")

	// 方式 2：手动追踪
	monitor.Trace(agentmonitor.TraceData{
		TraceType:  "llm",
		Name:       "gpt-4",
		Input:      map[string]string{"prompt": "Hello"},
		Output:     map[string]string{"response": "Hi there!"},
		LatencyMs:  250,
		Status:     "success",
	})

	// 方式 3：Session 管理
	session := monitor.StartSession("", map[string]interface{}{
		"user_id": "123",
	})

	monitor.TrackMessage(agentmonitor.MessageData{
		SessionID: session.ID,
		Role:      "user",
		Content:   "What's the weather?",
	})

	monitor.EndSession(session.ID)
}
```

## 功能特性

### 1. 函数包装

```go
// 包装函数自动追踪
result, err := monitor.Wrap(func() (interface{}, error) {
	// 你的逻辑
	return processData()
}, "process_data", "session-123")
```

### 2. LLM 调用追踪

```go
start := time.Now()
response, err := callOpenAI(request)
latencyMs := float64(time.Since(start).Milliseconds())

monitor.TraceLLM(
	"gpt-4",
	request,
	response,
	latencyMs,
	err == nil,
	errToString(err),
)
```

### 3. 断点调试

```go
// 设置断点暂停处理器
monitor.SetPauseHandler(func(
	breakpoint agentmonitor.Breakpoint,
	context agentmonitor.BreakpointCheckContext,
	state agentmonitor.SnapshotState,
) bool {
	fmt.Printf("断点触发: %s\n", breakpoint.Name)
	fmt.Printf("当前状态: %+v\n", state)
	// 返回 true 继续执行，false 暂停
	return true
})

// 追踪消息时自动检查断点
monitor.TrackMessage(agentmonitor.MessageData{
	SessionID: "sess-1",
	Role:      "assistant",
	Content:   "发生了 ERROR", // 如果有关键词断点会触发
})
```

### 4. 采样机制

```go
// 采样 10%，但错误和断点总是上报
monitor := agentmonitor.Init(&agentmonitor.SDKConfig{
	APIKey:        "...",
	SampleRate:    0.1, // 10% 采样率
	AlwaysCapture: []string{"error", "breakpoint"}, // 强制上报
})
```

### 5. 变量管理

```go
// 设置变量（用于断点调试时查看状态）
monitor.SetVariable("user_id", "123")
monitor.SetVariable("context", map[string]interface{}{
	"key": "value",
})

// 获取变量
userID := monitor.GetVariable("user_id")
allVars := monitor.GetVariables()
```

### 6. Goroutine 安全

```go
// SDK 是 goroutine 安全的，可以并发调用
var wg sync.WaitGroup
for i := 0; i < 10; i++ {
	wg.Add(1)
	go func(id int) {
		defer wg.Done()
		monitor.Trace(agentmonitor.TraceData{
			TraceType: "task",
			Name:      fmt.Sprintf("task-%d", id),
			Status:    "success",
		})
	}(i)
}
wg.Wait()
```

## 配置选项

```go
&agentmonitor.SDKConfig{
	APIKey:            "required",              // 必填：API Key
	BaseURL:           "http://localhost:3000", // 后端地址
	Disabled:          false,                   // 是否禁用
	BufferSize:        100,                     // 缓冲区大小
	FlushInterval:     5 * time.Second,         // 刷新间隔
	EnableBreakpoints: true,                    // 是否启用断点
	SampleRate:        1.0,                     // 采样率 0-1
	AlwaysCapture:     []string{"error", "breakpoint"}, // 强制上报类型
}
```

## 最佳实践

### 生产环境配置

```go
import "os"

monitor := agentmonitor.Init(&agentmonitor.SDKConfig{
	APIKey:            os.Getenv("AGENTMONITOR_API_KEY"),
	BaseURL:           getEnvOrDefault("AGENTMONITOR_URL", "https://api.agentmonitor.dev"),
	EnableBreakpoints: false, // 生产环境关闭断点
	SampleRate:        0.1,   // 采样 10% 减少开销
})
```

### 错误处理

```go
result, err := myAgentFunction()
if err != nil {
	monitor.Trace(agentmonitor.TraceData{
		TraceType: "error",
		Name:      "agent_error",
		Error:     err.Error(),
		Status:    "error",
	})
	return err
}
```

### 上下文传递

```go
import "context"

type monitorKey struct{}

func WithMonitor(ctx context.Context, monitor *agentmonitor.AgentMonitor) context.Context {
	return context.WithValue(ctx, monitorKey{}, monitor)
}

func GetMonitor(ctx context.Context) *agentmonitor.AgentMonitor {
	if monitor, ok := ctx.Value(monitorKey{}).(*agentmonitor.AgentMonitor); ok {
		return monitor
	}
	return nil
}

// 使用
ctx := WithMonitor(context.Background(), monitor)
processWithContext(ctx)
```

### 优雅关闭

```go
import (
	"os"
	"os/signal"
	"syscall"
)

func main() {
	monitor := agentmonitor.Init(&agentmonitor.SDKConfig{
		APIKey: "...",
	})

	// 捕获退出信号
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		<-sigChan
		fmt.Println("Shutting down...")
		monitor.Close() // 刷新缓冲区
		os.Exit(0)
	}()

	// 你的应用逻辑
	runApp(monitor)
}
```

## 示例

完整示例请参考 [examples/](./examples/) 目录。

## 许可证

MIT License
