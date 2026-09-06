// Package agentmonitor provides AI Agent quality monitoring and debugging SDK for Go
package agentmonitor

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math/rand"
	"net/http"
	"strings"
	"sync"
	"time"
)

// AgentMonitor is the main SDK client
type AgentMonitor struct {
	config                  *SDKConfig
	buffer                  []BufferedEvent
	offlineBuffer           []TraceData
	isOnline                bool
	retryDelayMs            int
	retryTimer              *time.Timer
	currentSessionID        string
	messageHistory          []Message
	variables               map[string]interface{}
	pauseHandler            BreakpointPauseHandler
	isPaused                bool
	resumeChan              chan struct{}
	breakpointRules         []Breakpoint
	breakpointCacheExpiry   int64
	sessionSampleDecisions  map[string]bool
	mu                      sync.Mutex
	flushTicker             *time.Ticker
	stopChan                chan struct{}
	// P0-01: Span 级追踪
	// activeSpans 仅作为活跃 span 的注册表（spanID -> SpanContext），
	// 用于内存上限保护与 Close() 兜底关闭。真正的父子关系由
	// context.Context 透传维护，不再依赖进程级共享栈，避免 goroutine 串扰。
	activeSpans      map[string]SpanContext
	maxSpanStackSize int

	// PR-12: Prompt Runtime 客户端（懒加载）
	promptRuntime     *PromptRuntimeClient
	promptRuntimeOnce sync.Once
}

const breakpointCacheTTL = 30000 // 30 seconds in milliseconds

// Init initializes a new AgentMonitor instance
func Init(config *SDKConfig) *AgentMonitor {
	if config.BaseURL == "" {
		config.BaseURL = "http://localhost:3000"
	}
	if config.BufferSize == 0 {
		config.BufferSize = 100
	}
	if config.FlushInterval == 0 {
		config.FlushInterval = 5 * time.Second
	}
	// SampleRate 为 nil 表示未设置，默认全量上报 1.0；显式设置时保留原值（含 0 = 全丢弃）
	if config.SampleRate == nil {
		defaultRate := 1.0
		config.SampleRate = &defaultRate
	} else if *config.SampleRate < 0 {
		// 负值容错：重置为 0（全丢弃）
		zeroRate := 0.0
		config.SampleRate = &zeroRate
	} else if *config.SampleRate > 1.0 {
		// 超过 1 容错：重置为 1.0（全量）
		fullRate := 1.0
		config.SampleRate = &fullRate
	}
	if config.AlwaysCapture == nil {
		config.AlwaysCapture = []string{"error", "breakpoint"}
	}
	// EnableSpanWrite 默认为 true（Go 的 bool 零值为 false，需要显式设置）
	// 注意：通过零值判断无法区分"未设置"和"显式设置为 false"，因此默认启用
	// 如果需要禁用，用户需要显式设置 config.EnableSpanWrite = false

	monitor := &AgentMonitor{
		config:                 config,
		buffer:                 make([]BufferedEvent, 0),
		offlineBuffer:          make([]TraceData, 0),
		isOnline:               true,
		retryDelayMs:           5000,
		messageHistory:         make([]Message, 0),
		variables:              make(map[string]interface{}),
		resumeChan:             make(chan struct{}),
		breakpointRules:        make([]Breakpoint, 0),
		sessionSampleDecisions: make(map[string]bool),
		stopChan:               make(chan struct{}),
		// P0-01: Span 级追踪初始化
		activeSpans:      make(map[string]SpanContext),
		maxSpanStackSize: 1000,
	}

	if !config.Disabled {
		monitor.startFlushTimer()
		if config.EnableBreakpoints {
			monitor.refreshBreakpointRules()
		}
	}

	return monitor
}

// Wrap wraps a function to automatically trace its execution
func (m *AgentMonitor) Wrap(fn func() (interface{}, error), name string, sessionID string) (interface{}, error) {
	startTime := time.Now()

	result, err := fn()
	latencyMs := float64(time.Since(startTime).Milliseconds())

	trace := TraceData{
		SessionID:  sessionID,
		TraceType:  "function",
		Name:       name,
		Input:      nil,
		Output:     result,
		LatencyMs:  latencyMs,
		StartedAt:  startTime.Format(time.RFC3339),
		Status:     "success",
	}

	if err != nil {
		trace.Status = "error"
		trace.Error = err.Error()
	}

	m.Trace(trace)
	return result, err
}

// Trace records a trace event
//
// V2 协议：SDK 生成统一的 TraceID/SpanID 并随 /traces 请求发送，
// 后端 createTrace 是根 Span 的唯一写入点；SDK 不再向 buffer 双写 span，
// 避免产生重复根节点与 ID 不一致的孤儿数据。
func (m *AgentMonitor) Trace(data TraceData) {
	if m.config.Disabled {
		return
	}

	// P1: Sampling check
	if !m.shouldSample(data) {
		return
	}

	// 仅在调用方未显式传入时生成 ID，保证一次 trace 全链路使用同一组 ID
	if data.TraceID == "" {
		data.TraceID = generateUUID()
	}
	if data.SpanID == "" {
		data.SpanID = generateUUID()
	}
	// trace 作为根 Span，ParentSpanID 保持空字符串

	if data.StartedAt == "" {
		data.StartedAt = time.Now().UTC().Format(time.RFC3339)
	}
	if data.EndedAt == "" && data.LatencyMs > 0 {
		data.EndedAt = time.Now().UTC().Format(time.RFC3339)
	}

	m.mu.Lock()
	m.buffer = append(m.buffer, BufferedEvent{
		Type: "trace",
		Data: data,
	})
	m.mu.Unlock()

	m.maybeFlush()
}

// TraceLLM traces an LLM call.
//
// PR-12：如果 request 是 *LLMRequest 且 PromptRef 非空，会自动把 prompt 元数据
// 写入 Trace.metadata，便于后端按 Prompt 版本聚合。
func (m *AgentMonitor) TraceLLM(model string, request, response interface{}, latencyMs float64, success bool, errorMsg string) {
	status := "success"
	if !success {
		status = "error"
	}

	metadata := map[string]interface{}{"model": model}
	if req, ok := request.(*LLMRequest); ok && req.PromptRef != nil {
		metadata["prompt"] = map[string]interface{}{
			"id":             req.PromptRef.ID,
			"version_id":     req.PromptRef.VersionID,
			"name":           req.PromptRef.Name,
			"version_number": req.PromptRef.VersionNumber,
			"environment":    req.PromptRef.Environment,
		}
	}

	m.Trace(TraceData{
		TraceType: "llm",
		Name:      model,
		Input:     request,
		Output:    response,
		Metadata:  metadata,
		LatencyMs: latencyMs,
		Status:    status,
		Error:     errorMsg,
	})
}

// GetPrompt 从 Runtime 解析已发布的 Prompt（PR-12）。
//
// 首次调用时按 config.ProjectID（或从 APIKey 解析的项目）懒加载 PromptRuntimeClient，
// 后续调用复用同一实例并共享 ETag/TTL 缓存。
func (m *AgentMonitor) GetPrompt(ctx context.Context, promptName string, opts *GetPromptOptions) (*ResolvedPrompt, error) {
	m.promptRuntimeOnce.Do(func() {
		projectID := m.config.ProjectID
		if projectID == "" {
			projectID = m.getProjectID()
		}
		if projectID == "" {
			return
		}
		m.promptRuntime = NewPromptRuntimeClient(
			m.config.BaseURL,
			m.config.APIKey,
			projectID,
			m.config.PromptCacheTTL,
			nil,
		)
	})
	if m.promptRuntime == nil {
		return nil, errors.New("agentmonitor: ProjectID is required for prompt runtime; set SDKConfig.ProjectID or use an apiKey formatted as `<projectId>_<secret>`")
	}
	return m.promptRuntime.Get(ctx, promptName, opts)
}

// ClearPromptCache 清空 Prompt Runtime 缓存。
func (m *AgentMonitor) ClearPromptCache() {
	if m.promptRuntime != nil {
		m.promptRuntime.ClearCache()
	}
}

// StartSpan 开始一个新的 Span（向后兼容入口）。
//
// 新代码请使用 StartSpanContext，以便在 goroutine 间通过 context.Context
// 正确传播父子关系。本方法内部等价于 StartSpanContext(context.Background(), ...)。
//
// 参数：
//   - name: Span 名称
//   - opts: 可选参数（string 视为 traceID；map[string]interface{} 视为 input/attributes/sessionId）
//
// 返回值：
//   - 新建的 SpanContext
func (m *AgentMonitor) StartSpan(name string, opts ...interface{}) SpanContext {
	ctx, span := m.StartSpanContext(context.Background(), name, opts...)
	_ = ctx
	return span
}

// StartSpanContext 基于调用链 context.Context 开始一个新的 Span。
//
// Truth Repair-3：traceID/parentSpanID 从 ctx 中读取，不再依赖进程级共享栈，
// 避免 goroutine 并发时 trace 串扰。返回的派生 ctx 必须继续透传给下游。
//
// 参数：
//   - parent: 父 context.Context，使用 context.Background() 可启动新链路根
//   - name: Span 名称
//   - opts: 可选参数，同 StartSpan
//
// 返回值：
//   - context.Context: 挂载了新 span 的派生 ctx，继续透传给下游
//   - SpanContext: 新建的 Span 上下文，后续用于 EndSpan
func (m *AgentMonitor) StartSpanContext(parent context.Context, name string, opts ...interface{}) (context.Context, SpanContext) {
	var traceID string
	var inputData interface{}
	var attributes map[string]interface{}
	var sessionID string

	// 简单的可选参数解析
	for _, opt := range opts {
		switch v := opt.(type) {
		case string:
			traceID = v
		case map[string]interface{}:
			if _, ok := v["input"]; ok {
				inputData = v["input"]
			}
			if _, ok := v["attributes"]; ok {
				attributes, _ = v["attributes"].(map[string]interface{})
			}
			if _, ok := v["sessionId"]; ok {
				sessionID, _ = v["sessionId"].(string)
			}
		}
	}

	// 从调用链 ctx 读取 traceId；无则使用显式传入或新生成一个作为新链路根
	if traceID == "" {
		traceID = activeTraceIDFromCtx(parent)
	}
	if traceID == "" {
		traceID = generateUUID()
	}
	if sessionID == "" {
		sessionID = m.currentSessionID
	}

	spanID := generateUUID()
	// 从调用链 ctx 读取栈顶 spanId 作为父级
	parentSpanID := activeSpanIDFromCtx(parent)

	ctx := SpanContext{
		SpanID:       spanID,
		TraceID:      traceID,
		ParentSpanID: parentSpanID,
		Name:         name,
		TraceType:    "span",
		StartedAt:    time.Now().UTC().Format(time.RFC3339),
		Input:        inputData,
		Attributes:   attributes,
		SessionID:    sessionID,
	}

	// 注册到实例级活跃表，用于内存保护与 Close() 兜底
	m.mu.Lock()
	m.activeSpans[spanID] = ctx
	m.mu.Unlock()
	m.maybeCleanupActiveSpans()
	m.bufferSpan(ctx)

	// 派生新 ctx 供下游透传
	child := withActiveSpan(parent, ctx)
	return child, ctx
}

// EndSpan 结束一个 Span
//
// 参数：
//   - ctx: StartSpan 返回的 SpanContext
//   - status: 终态（"ok"/"error"/"cancelled"/"timeout"，传 "success" 会被归一化为 "ok"）
//   - output: 输出数据（可为 nil）
//   - errStr: 错误信息（无错误传空串）
func (m *AgentMonitor) EndSpan(ctx SpanContext, status string, output interface{}, errStr string) {
	endedAt := time.Now().UTC().Format(time.RFC3339)
	var latencyMs float64
	if started, parseErr := time.Parse(time.RFC3339, ctx.StartedAt); parseErr == nil {
		latencyMs = float64(time.Since(started).Milliseconds())
	}

	ctx.EndedAt = endedAt
	ctx.LatencyMs = latencyMs
	// V2 协议：成功终态统一为 "ok"，兼容旧调用方传 "success"
	rawStatus := status
	if rawStatus == "" {
		if errStr != "" {
			rawStatus = "error"
		} else {
			rawStatus = "ok"
		}
	}
	if rawStatus == "success" {
		rawStatus = "ok"
	}
	ctx.Status = rawStatus
	ctx.Output = output
	ctx.Error = errStr

	// 从实例级活跃表移除
	m.mu.Lock()
	delete(m.activeSpans, ctx.SpanID)
	m.mu.Unlock()

	m.bufferSpan(ctx)
}

// WithSpan 便捷方法：自动管理 Span 生命周期（基于 context.Background()）
func (m *AgentMonitor) WithSpan(name string, fn func(SpanContext) (interface{}, error), opts ...interface{}) (interface{}, error) {
	span := m.StartSpan(name, opts...)
	result, err := fn(span)
	if err != nil {
		m.EndSpan(span, "error", nil, err.Error())
		return nil, err
	}
	m.EndSpan(span, "ok", result, "")
	return result, nil
}

// WithSpanContext 基于 context.Context 自动管理 Span 生命周期。
//
// 参数：
//   - parent: 父 context.Context
//   - name: Span 名称
//   - fn: 业务函数，入参为派生 ctx（已挂载新 span）和 SpanContext
//   - opts: 透传给 StartSpanContext 的可选参数
//
// 返回值：
//   - 业务函数返回值与错误
func (m *AgentMonitor) WithSpanContext(parent context.Context, name string, fn func(context.Context, SpanContext) (interface{}, error), opts ...interface{}) (interface{}, error) {
	child, span := m.StartSpanContext(parent, name, opts...)
	result, err := fn(child, span)
	if err != nil {
		m.EndSpan(span, "error", nil, err.Error())
		return nil, err
	}
	m.EndSpan(span, "ok", result, "")
	return result, nil
}

// StartSession starts a new session
func (m *AgentMonitor) StartSession(sessionID string, metadata map[string]interface{}) SessionData {
	if sessionID == "" {
		sessionID = fmt.Sprintf("session_%d_%d", time.Now().UnixMilli(), rand.Intn(10000))
	}

	session := SessionData{
		ID:        sessionID,
		StartedAt: time.Now().UTC().Format(time.RFC3339),
		Metadata:  metadata,
	}

	m.mu.Lock()
	m.currentSessionID = sessionID
	m.messageHistory = make([]Message, 0)
	m.variables = make(map[string]interface{})
	m.mu.Unlock()

	return session
}

// EndSession ends a session
func (m *AgentMonitor) EndSession(sessionID string) {
	if sessionID == "" {
		sessionID = m.currentSessionID
	}
	if sessionID == "" {
		return
	}

	m.Trace(TraceData{
		SessionID: sessionID,
		TraceType: "session",
		Name:      "session_end",
		EndedAt:   time.Now().UTC().Format(time.RFC3339),
		Status:    "success",
	})

	m.mu.Lock()
	if sessionID == m.currentSessionID {
		m.currentSessionID = ""
		m.messageHistory = make([]Message, 0)
		m.variables = make(map[string]interface{})
	}
	m.mu.Unlock()
}

// TrackMessage tracks a message
func (m *AgentMonitor) TrackMessage(event MessageData) {
	timestamp := event.Timestamp
	if timestamp == "" {
		timestamp = time.Now().UTC().Format(time.RFC3339)
	}

	m.mu.Lock()
	m.messageHistory = append(m.messageHistory, Message{
		Role:      event.Role,
		Content:   event.Content,
		Timestamp: timestamp,
	})
	m.mu.Unlock()

	m.Trace(TraceData{
		SessionID: event.SessionID,
		TraceType: "message",
		Name:      fmt.Sprintf("message_%s", event.Role),
		Input:     map[string]string{"role": event.Role},
		Output:    map[string]string{"content": event.Content},
		Metadata:  event.Metadata,
		StartedAt: timestamp,
		Status:    "success",
	})

	if m.config.EnableBreakpoints {
		m.checkAndHandleBreakpoint(BreakpointCheckContext{
			Content:  event.Content,
			Metadata: event.Metadata,
		})
	}
}

// TrackToolCall tracks a tool call
func (m *AgentMonitor) TrackToolCall(event ToolCallData) {
	startedAt := event.StartedAt
	if startedAt == "" {
		startedAt = time.Now().UTC().Format(time.RFC3339)
	}

	status := "success"
	if event.Error != "" {
		status = "error"
	}

	m.Trace(TraceData{
		SessionID: event.SessionID,
		TraceType: "tool_call",
		Name:      event.ToolName,
		Input:     event.InputParams,
		Output:    event.Output,
		Error:     event.Error,
		LatencyMs: event.LatencyMs,
		StartedAt: startedAt,
		EndedAt:   event.EndedAt,
		Status:    status,
	})

	if m.config.EnableBreakpoints {
		m.checkAndHandleBreakpoint(BreakpointCheckContext{
			Error:     event.Error,
			LatencyMs: event.LatencyMs,
			ToolName:  event.ToolName,
		})
	}
}

// SetVariable sets a variable
func (m *AgentMonitor) SetVariable(key string, value interface{}) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.variables[key] = value
}

// GetVariable gets a variable
func (m *AgentMonitor) GetVariable(key string) interface{} {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.variables[key]
}

// GetVariables gets all variables
func (m *AgentMonitor) GetVariables() map[string]interface{} {
	m.mu.Lock()
	defer m.mu.Unlock()
	result := make(map[string]interface{})
	for k, v := range m.variables {
		result[k] = v
	}
	return result
}

// SetPauseHandler sets the breakpoint pause handler
func (m *AgentMonitor) SetPauseHandler(handler BreakpointPauseHandler) {
	m.pauseHandler = handler
}

// IsPausedState returns whether the monitor is paused
func (m *AgentMonitor) IsPausedState() bool {
	return m.isPaused
}

// Resume resumes execution after a breakpoint pause
func (m *AgentMonitor) Resume() {
	if m.isPaused {
		m.isPaused = false
		close(m.resumeChan)
		m.resumeChan = make(chan struct{})
	}
}

// Close 关闭监控器并刷新剩余事件
func (m *AgentMonitor) Close() {
	close(m.stopChan)
	if m.flushTicker != nil {
		m.flushTicker.Stop()
	}
	if m.retryTimer != nil {
		m.retryTimer.Stop()
	}

	// 自动结束所有未关闭的 span（activeSpans 注册表兜底，与 context 调用链解耦）
	m.mu.Lock()
	spansToClose := make([]SpanContext, 0, len(m.activeSpans))
	for _, span := range m.activeSpans {
		span.Status = "error"
		span.Error = "auto-closed: monitor closed"
		spansToClose = append(spansToClose, span)
	}
	m.activeSpans = make(map[string]SpanContext)
	m.mu.Unlock()
	for _, span := range spansToClose {
		m.bufferSpan(span)
	}

	m.Flush()
}

// Flush flushes the buffer
func (m *AgentMonitor) Flush() {
	m.mu.Lock()
	if len(m.buffer) == 0 || m.config.Disabled {
		m.mu.Unlock()
		return
	}

	events := make([]BufferedEvent, len(m.buffer))
	copy(events, m.buffer)
	m.buffer = make([]BufferedEvent, 0)
	m.mu.Unlock()

	for _, event := range events {
		switch event.Type {
		case "trace":
			if traceData, ok := event.Data.(TraceData); ok {
				if err := m.sendTrace(traceData); err != nil {
					m.mu.Lock()
					m.buffer = append(events, m.buffer...)
					m.mu.Unlock()
					return
				}
			}
		case "span":
			if spanData, ok := event.Data.(SpanContext); ok {
				m.sendSpan(spanData)
			}
		}
	}

	// Retry offline buffer
	m.mu.Lock()
	if len(m.offlineBuffer) > 0 && m.isOnline {
		offlineTraces := make([]TraceData, len(m.offlineBuffer))
		copy(offlineTraces, m.offlineBuffer)
		m.offlineBuffer = make([]TraceData, 0)
		m.mu.Unlock()

		for _, trace := range offlineTraces {
			m.sendTrace(trace)
		}
	} else {
		m.mu.Unlock()
	}
}

// P0-1: Breakpoint local caching
func (m *AgentMonitor) refreshBreakpointRules() {
	projectID := m.getProjectID()
	if projectID == "" {
		return
	}

	url := fmt.Sprintf("%s/api/v1/breakpoints?projectId=%s", m.config.BaseURL, projectID)
	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("Authorization", "Bearer "+m.config.APIKey)

	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusOK {
		var result struct {
			Breakpoints []Breakpoint `json:"breakpoints"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&result); err == nil {
			m.mu.Lock()
			m.breakpointRules = result.Breakpoints
			m.breakpointCacheExpiry = time.Now().UnixMilli() + breakpointCacheTTL
			m.mu.Unlock()
		}
	}
}

func (m *AgentMonitor) matchBreakpointsLocally(context BreakpointCheckContext) []Breakpoint {
	m.mu.Lock()
	defer m.mu.Unlock()

	triggered := make([]Breakpoint, 0)
	for _, bp := range m.breakpointRules {
		if !bp.Enabled {
			continue
		}
		switch bp.Type {
		case "keyword":
			if context.Content != "" && strings.Contains(context.Content, bp.Condition) {
				triggered = append(triggered, bp)
			}
		case "error":
			if context.Error != "" {
				triggered = append(triggered, bp)
			}
		case "latency":
			if context.LatencyMs > 0 {
				threshold := parseFloat(bp.Condition)
				if context.LatencyMs > threshold {
					triggered = append(triggered, bp)
				}
			}
		}
	}
	return triggered
}

func (m *AgentMonitor) checkAndHandleBreakpoint(context BreakpointCheckContext) {
	// Refresh cache if expired
	if time.Now().UnixMilli() > m.breakpointCacheExpiry {
		go m.refreshBreakpointRules()
	}

	// Local matching
	triggered := m.matchBreakpointsLocally(context)
	if len(triggered) == 0 {
		return
	}

	// Create snapshot
	m.mu.Lock()
	state := SnapshotState{
		Messages:  m.messageHistory,
		Variables: m.variables,
		Metadata: map[string]interface{}{
			"session_id": m.currentSessionID,
			"timestamp":  time.Now().UTC().Format(time.RFC3339),
		},
	}
	if context.Error != "" {
		state.Error = map[string]string{"message": context.Error}
	}
	m.mu.Unlock()

	for _, bp := range triggered {
		payload := map[string]interface{}{
			"sessionId":     m.currentSessionID,
			"breakpointId":  bp.ID,
			"triggerReason": fmt.Sprintf("Breakpoint \"%s\" triggered", bp.Name),
			"state":         state,
		}

		body, _ := json.Marshal(payload)
		url := fmt.Sprintf("%s/api/v1/snapshots", m.config.BaseURL)
		req, _ := http.NewRequest("POST", url, bytes.NewBuffer(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+m.config.APIKey)

		client := &http.Client{Timeout: 5 * time.Second}
		client.Do(req)
	}

	if m.pauseHandler != nil {
		m.isPaused = true
		for _, bp := range triggered {
			shouldResume := m.pauseHandler(bp, context, state)
			if !shouldResume {
				<-m.resumeChan // Wait for resume
				break
			}
		}
		m.isPaused = false
	}
}

func (m *AgentMonitor) getProjectID() string {
	parts := splitString(m.config.APIKey, "_")
	if len(parts) > 1 {
		return parts[0]
	}
	return ""
}

// P1: Sampling mechanism
func (m *AgentMonitor) shouldSample(trace TraceData) bool {
	// 1. Always capture
	if trace.Status == "error" && contains(m.config.AlwaysCapture, "error") {
		return true
	}
	if trace.TraceType == "breakpoint" && contains(m.config.AlwaysCapture, "breakpoint") {
		return true
	}
	if trace.TraceType == "session" && contains(m.config.AlwaysCapture, "session") {
		return true
	}

	// 2. Session-level sampling
	sampleRate := 1.0
	if m.config.SampleRate != nil {
		sampleRate = *m.config.SampleRate
	}
	if trace.SessionID != "" {
		m.mu.Lock()
		defer m.mu.Unlock()
		if _, exists := m.sessionSampleDecisions[trace.SessionID]; !exists {
			m.sessionSampleDecisions[trace.SessionID] = rand.Float64() < sampleRate
		}
		return m.sessionSampleDecisions[trace.SessionID]
	}

	// 3. Independent random for non-session traces
	return rand.Float64() < sampleRate
}

func (m *AgentMonitor) sendTrace(trace TraceData) error {
	body, err := json.Marshal(trace)
	if err != nil {
		return err
	}

	url := fmt.Sprintf("%s/api/v1/traces", m.config.BaseURL)
	req, _ := http.NewRequest("POST", url, bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+m.config.APIKey)

	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		m.isOnline = false
		m.mu.Lock()
		m.offlineBuffer = append(m.offlineBuffer, trace)
		m.mu.Unlock()
		m.scheduleRetry()
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		m.isOnline = false
		m.mu.Lock()
		m.offlineBuffer = append(m.offlineBuffer, trace)
		m.mu.Unlock()
		m.scheduleRetry()
		return fmt.Errorf("HTTP %d", resp.StatusCode)
	}

	m.isOnline = true
	if m.retryTimer != nil {
		m.retryTimer.Stop()
		m.retryTimer = nil
	}
	return nil
}

// sendSpan 发送 span 数据到 POST /api/v1/spans
func (m *AgentMonitor) sendSpan(span SpanContext) {
	body, err := json.Marshal(span)
	if err != nil {
		fmt.Printf("[AgentMonitor] Failed to marshal span: %v\n", err)
		return
	}

	url := fmt.Sprintf("%s/api/v1/spans", m.config.BaseURL)
	req, _ := http.NewRequest("POST", url, bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Key", m.config.APIKey)

	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		fmt.Printf("[AgentMonitor] Failed to send span: %v\n", err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		fmt.Printf("[AgentMonitor] Failed to send span: HTTP %d\n", resp.StatusCode)
	}
}

func (m *AgentMonitor) scheduleRetry() {
	if m.retryTimer != nil {
		return
	}

	m.retryTimer = time.AfterFunc(time.Duration(m.retryDelayMs)*time.Millisecond, func() {
		m.retryTimer = nil
		m.retryDelayMs = min(m.retryDelayMs*2, 60000)
		m.Flush()
	})
}

func (m *AgentMonitor) startFlushTimer() {
	m.flushTicker = time.NewTicker(m.config.FlushInterval)
	go func() {
		for {
			select {
			case <-m.flushTicker.C:
				m.Flush()
			case <-m.stopChan:
				return
			}
		}
	}()
}

func (m *AgentMonitor) maybeFlush() {
	m.mu.Lock()
	shouldFlush := len(m.buffer) >= m.config.BufferSize
	m.mu.Unlock()

	if shouldFlush {
		m.Flush()
	}
}

// bufferSpan 将 span 数据推入 buffer
func (m *AgentMonitor) bufferSpan(span SpanContext) {
	if m.config.EnableSpanWrite {
		m.mu.Lock()
		m.buffer = append(m.buffer, BufferedEvent{
			Type: "span",
			Data: span,
		})
		m.mu.Unlock()
		m.maybeFlush()
	}
}

// maybeCleanupActiveSpans 内存保护：活跃 span 总数超过阈值时强制关闭最早注册的 span。
func (m *AgentMonitor) maybeCleanupActiveSpans() {
	m.mu.Lock()
	if len(m.activeSpans) <= m.maxSpanStackSize {
		m.mu.Unlock()
		return
	}
	// Go map 遍历顺序不确定；为了稳定地淘汰"最早注册"的 span，
	// 这里遍历找出 StartedAt 最早的一个（时间相同则取 spanID 字典序最小）。
	var earliestKey string
	var earliestStarted string
	for k, span := range m.activeSpans {
		if earliestKey == "" || span.StartedAt < earliestStarted ||
			(span.StartedAt == earliestStarted && k < earliestKey) {
			earliestKey = k
			earliestStarted = span.StartedAt
		}
	}
	var stale SpanContext
	var hasStale bool
	if earliestKey != "" {
		stale, hasStale = m.activeSpans[earliestKey]
		delete(m.activeSpans, earliestKey)
	}
	m.mu.Unlock()

	if hasStale {
		stale.Status = "error"
		stale.Error = "auto-closed: active span overflow"
		m.bufferSpan(stale)
	}
}

// Helper functions
func contains(slice []string, item string) bool {
	for _, s := range slice {
		if s == item {
			return true
		}
	}
	return false
}

func splitString(s, sep string) []string {
	result := make([]string, 0)
	current := ""
	for _, char := range s {
		if string(char) == sep {
			if current != "" {
				result = append(result, current)
				current = ""
			}
		} else {
			current += string(char)
		}
	}
	if current != "" {
		result = append(result, current)
	}
	return result
}

func parseFloat(s string) float64 {
	var result float64
	fmt.Sscanf(s, "%f", &result)
	return result
}

// generateUUID 生成一个伪 UUID，基于时间戳和纳秒级精度
func generateUUID() string {
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x",
		time.Now().UnixNano()&0xffffffff,
		time.Now().UnixNano()>>16&0xffff,
		time.Now().UnixNano()>>32&0xffff|0x4000,
		time.Now().UnixNano()>>48&0x3fff|0x8000,
		time.Now().UnixNano()&0xffffffffffff)
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
