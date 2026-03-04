// Package agentmonitor provides AI Agent quality monitoring and debugging SDK for Go
package agentmonitor

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math/rand"
	"net/http"
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
	if config.SampleRate == 0 {
		config.SampleRate = 1.0
	}
	if config.AlwaysCapture == nil {
		config.AlwaysCapture = []string{"error", "breakpoint"}
	}

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
func (m *AgentMonitor) Trace(data TraceData) {
	if m.config.Disabled {
		return
	}

	// P1: Sampling check
	if !m.shouldSample(data) {
		return
	}

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

// TraceLLM traces an LLM call
func (m *AgentMonitor) TraceLLM(model string, request, response interface{}, latencyMs float64, success bool, errorMsg string) {
	status := "success"
	if !success {
		status = "error"
	}

	m.Trace(TraceData{
		TraceType:  "llm",
		Name:       model,
		Input:      request,
		Output:     response,
		LatencyMs:  latencyMs,
		Status:     status,
		Error:      errorMsg,
	})
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

// Close closes the monitor and flushes remaining events
func (m *AgentMonitor) Close() {
	close(m.stopChan)
	if m.flushTicker != nil {
		m.flushTicker.Stop()
	}
	if m.retryTimer != nil {
		m.retryTimer.Stop()
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
		if event.Type == "trace" {
			if err := m.sendTrace(event.Data); err != nil {
				m.mu.Lock()
				m.buffer = append(events, m.buffer...)
				m.mu.Unlock()
				return
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
			if context.Content != "" && contains(context.Content, bp.Condition) {
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
	if trace.SessionID != "" {
		m.mu.Lock()
		defer m.mu.Unlock()
		if _, exists := m.sessionSampleDecisions[trace.SessionID]; !exists {
			m.sessionSampleDecisions[trace.SessionID] = rand.Float64() < m.config.SampleRate
		}
		return m.sessionSampleDecisions[trace.SessionID]
	}

	// 3. Independent random for non-session traces
	return rand.Float64() < m.config.SampleRate
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

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
