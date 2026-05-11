// Package agentmonitor provides Eino-compatible middleware for auto-instrumentation
package agentmonitor

import (
	"context"
	"encoding/json"
	"fmt"
	"time"
)

// EinoSpanContext holds span info for Eino middleware tracing
type EinoSpanContext struct {
	SpanID       string
	TraceID      string
	ParentSpanID string
	Name         string
	TraceType    string
	StartedAt    string
	EndedAt      string
	LatencyMs    float64
	Input        interface{}
	Output       interface{}
	Error        string
	Status       string
}

// EinoMiddleware is a generic middleware that wraps any function call
// and reports spans to AgentMonitor. It can be adapted to Eino, Gin,
// or any other Go framework.
//
// Usage with Eino (conceptual):
//
//	model.WithMiddleware(func(next model.ChatModel) model.ChatModel {
//		return &tracedChatModel{
//			base:    next,
//			monitor: monitor,
//		}
//	})
//
// The tracedChatModel can use EinoMiddleware.Generate or EinoMiddleware.Call
// to wrap individual invocations.
type EinoMiddleware struct {
	Monitor *AgentMonitor
}

// NewEinoMiddleware creates a new middleware helper
func NewEinoMiddleware(monitor *AgentMonitor) *EinoMiddleware {
	return &EinoMiddleware{Monitor: monitor}
}

// TraceFunc wraps a generic function call with span tracing
func (m *EinoMiddleware) TraceFunc(
	ctx context.Context,
	name string,
	traceType string,
	input interface{},
	fn func() (interface{}, error),
) (interface{}, error) {
	if m.Monitor == nil || m.Monitor.config.Disabled {
		return fn()
	}

	traceID, _ := ctx.Value("agentmonitor_trace_id").(string)
	if traceID == "" {
		traceID = generateUUID()
		ctx = context.WithValue(ctx, "agentmonitor_trace_id", traceID)
	}

	parentSpanID, _ := ctx.Value("agentmonitor_span_id").(string)
	spanID := generateUUID()
	startedAt := time.Now().UTC().Format(time.RFC3339)

	// Buffer start span
	m.Monitor.bufferSpan(EinoSpanContext{
		SpanID:       spanID,
		TraceID:      traceID,
		ParentSpanID: parentSpanID,
		Name:         name,
		TraceType:    traceType,
		StartedAt:    startedAt,
		Input:        input,
		Status:       "unset",
	})

	result, err := fn()

	endedAt := time.Now().UTC().Format(time.RFC3339)
	latencyMs := float64(time.Since(mustParseTime(startedAt)).Milliseconds())
	status := "success"
	errStr := ""
	if err != nil {
		status = "error"
		errStr = err.Error()
	}

	m.Monitor.bufferSpan(EinoSpanContext{
		SpanID:    spanID,
		TraceID:   traceID,
		Name:      name,
		TraceType: traceType,
		StartedAt: startedAt,
		EndedAt:   endedAt,
		LatencyMs: latencyMs,
		Input:     input,
		Output:    result,
		Error:     errStr,
		Status:    status,
	})

	// Propagate current span_id so child spans can set parent
	ctx = context.WithValue(ctx, "agentmonitor_span_id", spanID)

	return result, err
}

// TraceGenerate is a convenience wrapper for LLM generate calls (Eino compatible)
func (m *EinoMiddleware) TraceGenerate(
	ctx context.Context,
	name string,
	input interface{},
	generate func() (interface{}, error),
) (interface{}, error) {
	return m.TraceFunc(ctx, name, "llm", input, generate)
}

// TraceTool is a convenience wrapper for tool calls (Eino compatible)
func (m *EinoMiddleware) TraceTool(
	ctx context.Context,
	name string,
	input interface{},
	call func() (interface{}, error),
) (interface{}, error) {
	return m.TraceFunc(ctx, name, "tool", input, call)
}

// TraceChain is a convenience wrapper for chain calls (Eino compatible)
func (m *EinoMiddleware) TraceChain(
	ctx context.Context,
	name string,
	input interface{},
	call func() (interface{}, error),
) (interface{}, error) {
	return m.TraceFunc(ctx, name, "chain", input, call)
}

// mustParseTime parses RFC3339 time or returns zero time
func mustParseTime(s string) time.Time {
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		return time.Time{}
	}
	return t
}

// ExampleEinoChatModel shows how to adapt this middleware to Eino's model.ChatModel
//
//	type tracedChatModel struct {
//		base    model.ChatModel
//		monitor *agentmonitor.AgentMonitor
//	}
//
//	func (m *tracedChatModel) Generate(ctx context.Context, input *schema.Message, opts ...model.Option) (*schema.Message, error) {
//		mw := agentmonitor.NewEinoMiddleware(m.monitor)
//		result, err := mw.TraceGenerate(ctx, m.base.String(), input, func() (interface{}, error) {
//			return m.base.Generate(ctx, input, opts...)
//		})
//		if err != nil {
//			return nil, err
//		}
//		return result.(*schema.Message), nil
//	}
type ExampleEinoChatModel struct{}

func (m *AgentMonitor) bufferSpan(span EinoSpanContext) {
	if !m.config.EnableSpanWrite {
		return
	}
	m.mu.Lock()
	m.buffer = append(m.buffer, BufferedEvent{
		Type: "span",
		Data: span,
	})
	m.mu.Unlock()
	m.maybeFlush()
}
