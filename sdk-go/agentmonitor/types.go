package agentmonitor

import "time"

// SDKConfig is the configuration for the SDK
type SDKConfig struct {
	APIKey            string
	BaseURL           string
	// PR-12：项目 ID。Prompt Runtime 等 V2 接口需要显式 projectId。
	// 若为空，SDK 会按 `<projectId>_<rest>` 约定从 APIKey 解析。
	ProjectID         string
	Disabled          bool
	BufferSize        int
	FlushInterval     time.Duration
	EnableBreakpoints bool
	EnableSpanWrite   bool
	// SampleRate 采样率指针，取值 [0,1]：
	//   0    = 全丢弃（除 alwaysCapture 强制上报的事件外）
	//   1.0  = 全量上报
	// 为区分 Go 零值"未设置"与"显式设为 0"，未设置时传 nil，Init 会将其重置为 1.0
	// 示例：rate := 0.0; config.SampleRate = &rate
	SampleRate *float64
	AlwaysCapture []string
	// PR-12：Prompt Runtime 缓存 TTL，默认 60 秒
	PromptCacheTTL time.Duration
}

// SessionData represents a session
type SessionData struct {
	ID        string                 `json:"id"`
	StartedAt string                 `json:"startedAt"`
	EndedAt   string                 `json:"endedAt,omitempty"`
	ProjectID string                 `json:"projectId,omitempty"`
	Metadata  map[string]interface{} `json:"metadata,omitempty"`
}

// TraceData represents a trace event
type TraceData struct {
	SessionID string                 `json:"sessionId,omitempty"`
	AgentID   string                 `json:"agentId,omitempty"`
	TraceType string                 `json:"traceType"`
	Name      string                 `json:"name"`
	Input     interface{}            `json:"input,omitempty"`
	Output    interface{}            `json:"output,omitempty"`
	Metadata  map[string]interface{} `json:"metadata,omitempty"`
	StartedAt string                 `json:"startedAt,omitempty"`
	EndedAt   string                 `json:"endedAt,omitempty"`
	LatencyMs float64                `json:"latencyMs,omitempty"`
	Status    string                 `json:"status,omitempty"`
	Error     string                 `json:"error,omitempty"`
	// V2 协议：显式的 traceId/spanId/parentSpanId，SDK 生成后透传给后端，
	// 后端 createTrace 据此唯一落库根 Span，避免 SDK/后端双写导致的孤儿根节点。
	TraceID      string `json:"traceId,omitempty"`
	SpanID       string `json:"spanId,omitempty"`
	ParentSpanID string `json:"parentSpanId,omitempty"`
}

// MessageData represents a message
type MessageData struct {
	SessionID string                 `json:"sessionId"`
	Role      string                 `json:"role"`
	Content   string                 `json:"content"`
	Timestamp string                 `json:"timestamp,omitempty"`
	Metadata  map[string]interface{} `json:"metadata,omitempty"`
}

// PromptRef 指向一个已通过 Runtime 解析的 Prompt 版本，
// 可传入 TraceLLM 的 LLMRequest.PromptRef，在 LLM Span metadata 中
// 自动写入 prompt.id / prompt.version_id 等字段。
type PromptRef struct {
	ID            string `json:"id"`
	VersionID     string `json:"versionId"`
	Name          string `json:"name,omitempty"`
	VersionNumber int    `json:"versionNumber,omitempty"`
	Environment   string `json:"environment,omitempty"`
}

// LLMRequest 是 TraceLLM 的推荐入参类型（仍兼容直接传 map/任意结构）。
type LLMRequest struct {
	Model     string        `json:"model"`
	Messages  []interface{} `json:"messages,omitempty"`
	Prompt    string        `json:"prompt,omitempty"`
	PromptRef *PromptRef    `json:"promptRef,omitempty"`
}

// ToolCallData represents a tool call
type ToolCallData struct {
	ID          string                 `json:"id"`
	SessionID   string                 `json:"sessionId"`
	MessageID   string                 `json:"messageId,omitempty"`
	ToolName    string                 `json:"toolName"`
	InputParams map[string]interface{} `json:"inputParams"`
	Output      map[string]interface{} `json:"output,omitempty"`
	Error       string                 `json:"error,omitempty"`
	LatencyMs   float64                `json:"latencyMs,omitempty"`
	StartedAt   string                 `json:"startedAt,omitempty"`
	EndedAt     string                 `json:"endedAt,omitempty"`
}

// Breakpoint represents a breakpoint
type Breakpoint struct {
	ID        string `json:"id"`
	ProjectID string `json:"project_id"`
	Name      string `json:"name"`
	Type      string `json:"type"`
	Condition string `json:"condition"`
	Enabled   bool   `json:"enabled"`
}

// BreakpointCheckContext is the context for breakpoint checking
type BreakpointCheckContext struct {
	Content   string                 `json:"content,omitempty"`
	Error     string                 `json:"error,omitempty"`
	LatencyMs float64                `json:"latencyMs,omitempty"`
	ToolName  string                 `json:"toolName,omitempty"`
	Metadata  map[string]interface{} `json:"metadata,omitempty"`
}

// SnapshotState represents the state at a breakpoint
type SnapshotState struct {
	Messages   []Message              `json:"messages,omitempty"`
	Variables  map[string]interface{} `json:"variables,omitempty"`
	ToolCalls  []interface{}          `json:"toolCalls,omitempty"`
	Metadata   map[string]interface{} `json:"metadata,omitempty"`
	StackTrace []string               `json:"stackTrace,omitempty"`
	Error      map[string]string      `json:"error,omitempty"`
}

// Message represents a message in history
type Message struct {
	Role      string `json:"role"`
	Content   string `json:"content"`
	Timestamp string `json:"timestamp"`
}

// BufferedEvent is an event in the buffer
type BufferedEvent struct {
	Type string      `json:"type"`
	Data interface{} `json:"data"`
}

// BreakpointPauseHandler is a function that handles breakpoint pauses
type BreakpointPauseHandler func(breakpoint Breakpoint, context BreakpointCheckContext, state SnapshotState) bool

// SpanContext 表示一个 Span 的完整上下文信息
type SpanContext struct {
	SpanID       string                 `json:"spanId"`
	TraceID      string                 `json:"traceId"`
	ParentSpanID string                 `json:"parentSpanId,omitempty"`
	Name         string                 `json:"name"`
	TraceType    string                 `json:"traceType"`
	StartedAt    string                 `json:"startedAt"`
	EndedAt      string                 `json:"endedAt,omitempty"`
	LatencyMs    float64                `json:"latencyMs,omitempty"`
	Input        interface{}            `json:"input,omitempty"`
	Output       interface{}            `json:"output,omitempty"`
	Attributes   map[string]interface{} `json:"attributes,omitempty"`
	Status       string                 `json:"status,omitempty"`
	Error        string                 `json:"error,omitempty"`
	SessionID    string                 `json:"sessionId,omitempty"`
}
