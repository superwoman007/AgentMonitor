// Package agentmonitor 提供 AI Agent 质量监控与调试 SDK。
//
// 本文件实现基于标准库 context.Context 的活跃 Span 传播，
// 替换原先进程级共享 spanStack，避免 goroutine 并发时 trace 串扰。
// 调用方在启动链路时把返回的 ctx 透传给下游 goroutine/函数，
// 子 StartSpan 会自动把当前 span 作为 parent。
package agentmonitor

import "context"

// contextKey 是 ctx 中存放活跃 span 状态的私有键类型，避免键冲突。
type contextKey struct{}

// activeSpanState 存放当前调用链路上的 traceId 与 span 栈。
type activeSpanState struct {
	traceID string
	stack   []SpanContext
}

// withActiveSpan 在父 ctx 上挂载一个新的活跃 span，返回派生 ctx。
//
// 参数：
//   - parent: 父 context.Context（可为 context.Background()）
//   - span: 新启动的 SpanContext
//
// 返回值：
//   - 派生后的 context.Context，应继续透传给下游
func withActiveSpan(parent context.Context, span SpanContext) context.Context {
	existing := activeStateFromCtx(parent)
	var stack []SpanContext
	if existing != nil {
		// 复制父栈，追加当前 span，避免修改父 ctx 内部切片
		stack = make([]SpanContext, 0, len(existing.stack)+1)
		stack = append(stack, existing.stack...)
	} else {
		stack = make([]SpanContext, 0, 1)
	}
	stack = append(stack, span)
	return context.WithValue(parent, contextKey{}, &activeSpanState{
		traceID: span.TraceID,
		stack:   stack,
	})
}

// activeTraceIDFromCtx 返回 ctx 中当前活跃的 traceId。
//
// 参数：
//   - ctx: 调用链 context.Context
//
// 返回值：
//   - 存在活跃链路时返回 traceId，否则返回空字符串
func activeTraceIDFromCtx(ctx context.Context) string {
	state := activeStateFromCtx(ctx)
	if state == nil {
		return ""
	}
	return state.traceID
}

// activeSpanIDFromCtx 返回 ctx 中栈顶 span 的 spanId（用作新 span 的 parentSpanId）。
//
// 参数：
//   - ctx: 调用链 context.Context
//
// 返回值：
//   - 存在活跃 span 栈时返回栈顶 spanId，否则返回空字符串
func activeSpanIDFromCtx(ctx context.Context) string {
	state := activeStateFromCtx(ctx)
	if state == nil || len(state.stack) == 0 {
		return ""
	}
	return state.stack[len(state.stack)-1].SpanID
}

// activeStateFromCtx 从 ctx 中安全地取出 *activeSpanState，不存在时返回 nil。
func activeStateFromCtx(ctx context.Context) *activeSpanState {
	if ctx == nil {
		return nil
	}
	v := ctx.Value(contextKey{})
	if v == nil {
		return nil
	}
	state, ok := v.(*activeSpanState)
	if !ok {
		return nil
	}
	return state
}
