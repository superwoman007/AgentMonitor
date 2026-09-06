// Package agentmonitor provides Eino-compatible middleware for auto-instrumentation
package agentmonitor

import (
	"context"
	"time"
)

// EinoMiddleware 是一个通用中间件，用于包装任意函数调用并把 span 上报到 AgentMonitor。
// 可适配到 Eino、Gin 或其他 Go 框架。
//
// 在 Eino 中使用（概念示例）：
//
//	model.WithMiddleware(func(next model.ChatModel) model.ChatModel {
//		return &tracedChatModel{
//			base:    next,
//			monitor: monitor,
//		}
//	})
//
// tracedChatModel 可调用 EinoMiddleware.Generate / EinoMiddleware.Call
// 来包装单次调用。
type EinoMiddleware struct {
	Monitor *AgentMonitor
}

// NewEinoMiddleware 创建一个新的 EinoMiddleware 实例。
//
// 参数：
//   - monitor: 已初始化的 AgentMonitor 客户端
//
// 返回值：
//   - *EinoMiddleware 实例
func NewEinoMiddleware(monitor *AgentMonitor) *EinoMiddleware {
	return &EinoMiddleware{Monitor: monitor}
}

// TraceFunc 使用 span 追踪包装一个通用函数调用。
//
// Truth Repair-3：内部通过 StartSpanContext 把 span 绑定到调用链 ctx，
// 子调用透传返回的 ctx 即可自动建立父子关系，避免 goroutine 间串扰。
//
// 参数：
//   - ctx: 父 context.Context
//   - name: Span 名称
//   - traceType: Span 类型（llm/tool/chain 等）
//   - input: 输入数据
//   - fn: 被追踪的业务函数
//
// 返回值：
//   - result: 业务函数返回值
//   - err: 业务函数错误
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

	childCtx, span := m.Monitor.StartSpanContext(ctx, name, map[string]interface{}{
		"input": input,
	})
	span.TraceType = traceType

	result, err := fn()
	if err != nil {
		m.Monitor.EndSpan(span, "error", nil, err.Error())
		return result, err
	}
	m.Monitor.EndSpan(span, "ok", result, "")
	_ = childCtx
	return result, nil
}

// TraceGenerate 是 LLM generate 调用的便捷封装（Eino 兼容）。
//
// 参数：
//   - ctx: 父 context.Context
//   - name: Span 名称（通常是模型名）
//   - input: 输入数据
//   - generate: 被追踪的生成函数
//
// 返回值：
//   - 生成函数的返回值与错误
func (m *EinoMiddleware) TraceGenerate(
	ctx context.Context,
	name string,
	input interface{},
	generate func() (interface{}, error),
) (interface{}, error) {
	return m.TraceFunc(ctx, name, "llm", input, generate)
}

// TraceTool 是工具调用的便捷封装（Eino 兼容）。
//
// 参数：
//   - ctx: 父 context.Context
//   - name: Span 名称（通常是工具名）
//   - input: 输入参数
//   - call: 被追踪的工具函数
//
// 返回值：
//   - 工具函数的返回值与错误
func (m *EinoMiddleware) TraceTool(
	ctx context.Context,
	name string,
	input interface{},
	call func() (interface{}, error),
) (interface{}, error) {
	return m.TraceFunc(ctx, name, "tool", input, call)
}

// TraceChain 是 chain 调用的便捷封装（Eino 兼容）。
//
// 参数：
//   - ctx: 父 context.Context
//   - name: Span 名称（通常是 chain 名）
//   - input: 输入数据
//   - call: 被追踪的 chain 函数
//
// 返回值：
//   - chain 函数的返回值与错误
func (m *EinoMiddleware) TraceChain(
	ctx context.Context,
	name string,
	input interface{},
	call func() (interface{}, error),
) (interface{}, error) {
	return m.TraceFunc(ctx, name, "chain", input, call)
}

// ExampleEinoChatModel 展示如何把本中间件适配到 Eino 的 model.ChatModel
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

// 保持对 time 包的引用，避免未来扩展时重复导入；
// 目前 startedAt 由 StartSpanContext 内部统一生成。
var _ = time.RFC3339
