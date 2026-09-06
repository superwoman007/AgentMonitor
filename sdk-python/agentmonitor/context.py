"""AgentMonitor Python SDK 异步上下文传播模块。

使用标准库 contextvars.ContextVar 保存当前活跃的 Span 栈，
天然支持 asyncio 并发任务间的隔离，也能在同一线程的嵌套 with 语句中
正确维护父子关系。替换原先进程级共享 span_stack 的实现，
避免不同请求/任务之间的 trace 串扰。
"""

from contextvars import ContextVar
from typing import List, Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from .types import SpanContext


# 当前异步上下文中活跃的 traceId；未进入任何 span 时为 None
_active_trace_id: ContextVar[Optional[str]] = ContextVar(
    "agentmonitor_active_trace_id", default=None
)

# 当前异步上下文中活跃的 span 栈（按嵌套顺序，栈顶为最近 start_span 的 span）
_active_spans: ContextVar[Optional[List["SpanContext"]]] = ContextVar(
    "agentmonitor_active_spans", default=None
)


def get_active_trace_id() -> Optional[str]:
    """获取当前异步上下文中的 traceId。

    Returns:
        若存在活跃链路则返回 traceId 字符串，否则返回 None
    """
    return _active_trace_id.get()


def get_active_span_id() -> Optional[str]:
    """获取当前异步上下文中栈顶 span 的 spanId（即下一个新 span 的 parentSpanId）。

    Returns:
        若存在活跃 span 栈则返回栈顶 spanId，否则返回 None
    """
    stack = _active_spans.get()
    if stack:
        return stack[-1].span_id
    return None


def push_active_span(span: "SpanContext") -> "object":
    """将一个 span 压入当前上下文栈。

    会在当前上下文的副本中写入 traceId 与 span 列表，
    保证 ContextVar 的不可变语义：同一异步任务内可见，并发任务互不影响。

    Args:
        span: 已创建好的 SpanContext 实例
    Returns:
        一个 token 可用于 reset（当前实现内部使用，外部无需关心）
    """
    trace_id = span.trace_id
    _active_trace_id.set(trace_id)
    current = _active_spans.get()
    new_stack: List["SpanContext"] = list(current) if current else []
    new_stack.append(span)
    _active_spans.set(new_stack)
    return span


def pop_active_span(span: "SpanContext") -> None:
    """将指定 span 从当前上下文栈中移除。

    若栈顶不是该 span（例如用户手动 end_span 的顺序与 start 不一致），
    会在列表中查找并删除，避免污染后续嵌套判断；栈清空后重置 traceId。

    Args:
        span: 需要移除的 SpanContext 实例
    """
    current = _active_spans.get()
    if not current:
        return

    if current and current[-1].span_id == span.span_id:
        new_stack = current[:-1]
    else:
        new_stack = [s for s in current if s.span_id != span.span_id]

    if new_stack:
        _active_spans.set(new_stack)
        _active_trace_id.set(new_stack[-1].trace_id)
    else:
        _active_spans.set(None)
        _active_trace_id.set(None)


def set_span_attribute(key: str, value: object) -> bool:
    """在当前活跃 span 上设置单个属性。

    Args:
        key: 属性键名
        value: 属性值
    Returns:
        True 表示存在活跃 span 并已写入；False 表示当前不在 span 上下文中
    """
    stack = _active_spans.get()
    if not stack:
        return False
    current = stack[-1]
    if current.attributes is None:
        current.attributes = {}
    current.attributes[key] = value
    return True


def set_span_attributes(attrs: dict) -> bool:
    """在当前活跃 span 上批量合并属性。

    Args:
        attrs: 需要合并写入的属性字典
    Returns:
        True 表示存在活跃 span 并已写入；False 表示当前不在 span 上下文中
    """
    stack = _active_spans.get()
    if not stack:
        return False
    current = stack[-1]
    if current.attributes is None:
        current.attributes = {}
    current.attributes.update(attrs)
    return True


def reset_active_context() -> None:
    """重置当前异步上下文中的所有活跃 span 状态。

    主要供测试或极端异常恢复使用；正常生命周期请使用 push/pop。
    """
    _active_trace_id.set(None)
    _active_spans.set(None)
