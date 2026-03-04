"""Type definitions for AgentMonitor Python SDK"""

from typing import Dict, List, Optional, Any, Literal, Callable, Awaitable
from dataclasses import dataclass, field
from datetime import datetime


@dataclass
class SDKConfig:
    """SDK 配置"""
    api_key: str
    base_url: str = "http://localhost:3000"
    disabled: bool = False
    buffer_size: int = 100
    flush_interval: float = 5.0  # seconds
    enable_breakpoints: bool = True
    sample_rate: float = 1.0  # 0-1, 采样率
    always_capture: List[Literal["error", "breakpoint", "session"]] = field(
        default_factory=lambda: ["error", "breakpoint"]
    )


@dataclass
class SessionData:
    """会话数据"""
    id: str
    started_at: str
    project_id: Optional[str] = None
    ended_at: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None


@dataclass
class TraceData:
    """追踪数据"""
    trace_type: str
    name: str
    session_id: Optional[str] = None
    agent_id: Optional[str] = None
    input: Optional[Any] = None
    output: Optional[Any] = None
    metadata: Optional[Dict[str, Any]] = None
    started_at: Optional[str] = None
    ended_at: Optional[str] = None
    latency_ms: Optional[float] = None
    status: Optional[Literal["success", "error"]] = None
    error: Optional[str] = None


@dataclass
class MessageData:
    """消息数据"""
    session_id: str
    role: Literal["user", "assistant", "system", "tool"]
    content: str
    timestamp: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None


@dataclass
class ToolCallData:
    """工具调用数据"""
    id: str
    session_id: str
    tool_name: str
    input_params: Dict[str, Any]
    message_id: Optional[str] = None
    output: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    latency_ms: Optional[float] = None
    started_at: Optional[str] = None
    ended_at: Optional[str] = None


@dataclass
class Breakpoint:
    """断点"""
    id: str
    project_id: str
    name: str
    type: Literal["keyword", "error", "latency", "custom"]
    condition: str
    enabled: bool


@dataclass
class BreakpointCheckContext:
    """断点检查上下文"""
    content: Optional[str] = None
    error: Optional[str] = None
    latency_ms: Optional[float] = None
    tool_name: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None


@dataclass
class SnapshotState:
    """快照状态"""
    messages: Optional[List[Dict[str, Any]]] = None
    variables: Optional[Dict[str, Any]] = None
    tool_calls: Optional[List[Dict[str, Any]]] = None
    metadata: Optional[Dict[str, Any]] = None
    stack_trace: Optional[List[str]] = None
    error: Optional[Dict[str, str]] = None


# 断点暂停处理器类型
BreakpointPauseHandler = Callable[[Breakpoint, BreakpointCheckContext, SnapshotState], Awaitable[bool]]
