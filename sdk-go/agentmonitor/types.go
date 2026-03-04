package agentmonitor

import "time"

// SDKConfig is the configuration for the SDK
type SDKConfig struct {
	APIKey            string
	BaseURL           string
	Disabled          bool
	BufferSize        int
	FlushInterval     time.Duration
	EnableBreakpoints bool
	SampleRate        float64
	AlwaysCapture     []string
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
}

// MessageData represents a message
type MessageData struct {
	SessionID string                 `json:"sessionId"`
	Role      string                 `json:"role"`
	Content   string                 `json:"content"`
	Timestamp string                 `json:"timestamp,omitempty"`
	Metadata  map[string]interface{} `json:"metadata,omitempty"`
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
	Type string
	Data TraceData
}

// BreakpointPauseHandler is a function that handles breakpoint pauses
type BreakpointPauseHandler func(breakpoint Breakpoint, context BreakpointCheckContext, state SnapshotState) bool
