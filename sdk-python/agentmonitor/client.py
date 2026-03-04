"""AgentMonitor Python SDK Client"""

import asyncio
import time
import random
import json
import threading
from typing import Dict, List, Optional, Any, Callable
from datetime import datetime
from functools import wraps
from dataclasses import asdict

try:
    import requests
except ImportError:
    raise ImportError("请安装 requests: pip install requests")

from .types import (
    SDKConfig,
    SessionData,
    TraceData,
    MessageData,
    ToolCallData,
    Breakpoint,
    BreakpointCheckContext,
    SnapshotState,
    BreakpointPauseHandler,
)


class AgentMonitor:
    """AgentMonitor Python SDK 客户端"""

    def __init__(self, config: SDKConfig):
        self.config = config
        self.buffer: List[Dict[str, Any]] = []
        self.offline_buffer: List[TraceData] = []
        self.is_online = True
        self.retry_delay_ms = 5000
        self.retry_timer: Optional[threading.Timer] = None

        self.current_session_id: Optional[str] = None
        self.message_history: List[Dict[str, Any]] = []
        self.variables: Dict[str, Any] = {}
        self.pause_handler: Optional[BreakpointPauseHandler] = None
        self.is_paused = False
        self.resume_event = threading.Event()

        # P0-1: 本地断点规则缓存
        self.breakpoint_rules: List[Breakpoint] = []
        self.breakpoint_cache_expiry = 0
        self.BREAKPOINT_CACHE_TTL = 30_000  # 30秒

        # P1: 采样机制
        self.session_sample_decisions: Dict[str, bool] = {}

        self._lock = threading.Lock()
        self._flush_timer: Optional[threading.Timer] = None

        if not self.config.disabled:
            self._start_flush_timer()
            if self.config.enable_breakpoints:
                self._refresh_breakpoint_rules()

    @classmethod
    def init(cls, config: SDKConfig) -> "AgentMonitor":
        """初始化 SDK"""
        return cls(config)

    def wrap(self, func: Callable, name: Optional[str] = None, session_id: Optional[str] = None):
        """装饰器：包装函数，自动追踪"""
        trace_name = name or func.__name__

        if asyncio.iscoroutinefunction(func):
            @wraps(func)
            async def async_wrapper(*args, **kwargs):
                start_time = time.time()
                try:
                    result = await func(*args, **kwargs)
                    latency_ms = (time.time() - start_time) * 1000
                    self.trace(TraceData(
                        session_id=session_id,
                        trace_type="function",
                        name=trace_name,
                        input={"args": args, "kwargs": kwargs},
                        output=result,
                        latency_ms=latency_ms,
                        status="success",
                    ))
                    return result
                except Exception as e:
                    latency_ms = (time.time() - start_time) * 1000
                    self.trace(TraceData(
                        session_id=session_id,
                        trace_type="function",
                        name=trace_name,
                        input={"args": args, "kwargs": kwargs},
                        error=str(e),
                        latency_ms=latency_ms,
                        status="error",
                    ))
                    raise
            return async_wrapper
        else:
            @wraps(func)
            def sync_wrapper(*args, **kwargs):
                start_time = time.time()
                try:
                    result = func(*args, **kwargs)
                    latency_ms = (time.time() - start_time) * 1000
                    self.trace(TraceData(
                        session_id=session_id,
                        trace_type="function",
                        name=trace_name,
                        input={"args": args, "kwargs": kwargs},
                        output=result,
                        latency_ms=latency_ms,
                        status="success",
                    ))
                    return result
                except Exception as e:
                    latency_ms = (time.time() - start_time) * 1000
                    self.trace(TraceData(
                        session_id=session_id,
                        trace_type="function",
                        name=trace_name,
                        input={"args": args, "kwargs": kwargs},
                        error=str(e),
                        latency_ms=latency_ms,
                        status="error",
                    ))
                    raise
            return sync_wrapper

    def trace(self, data: TraceData):
        """记录追踪数据"""
        if self.config.disabled:
            return

        # P1: 采样检查
        if not self._should_sample(data):
            return

        enriched_data = data
        if not enriched_data.started_at:
            enriched_data.started_at = datetime.utcnow().isoformat() + "Z"
        if not enriched_data.ended_at and enriched_data.latency_ms:
            enriched_data.ended_at = datetime.utcnow().isoformat() + "Z"

        with self._lock:
            self.buffer.append({"type": "trace", "data": asdict(enriched_data)})
            self._maybe_flush()

    def trace_llm(
        self,
        model: str,
        request: Dict[str, Any],
        response: Optional[Dict[str, Any]],
        latency_ms: float,
        success: bool = True,
        error: Optional[str] = None,
    ):
        """追踪 LLM 调用"""
        self.trace(TraceData(
            trace_type="llm",
            name=model,
            input=request,
            output=response,
            latency_ms=latency_ms,
            status="success" if success else "error",
            error=error,
        ))

    def start_session(self, session_id: Optional[str] = None, metadata: Optional[Dict[str, Any]] = None) -> SessionData:
        """开始会话"""
        sid = session_id or f"session_{int(time.time() * 1000)}_{random.randint(1000, 9999)}"
        session = SessionData(
            id=sid,
            started_at=datetime.utcnow().isoformat() + "Z",
            metadata=metadata,
        )

        self.current_session_id = sid
        self.message_history = []
        self.variables = {}

        return session

    def end_session(self, session_id: Optional[str] = None):
        """结束会话"""
        sid = session_id or self.current_session_id
        if not sid:
            return

        self.trace(TraceData(
            session_id=sid,
            trace_type="session",
            name="session_end",
            ended_at=datetime.utcnow().isoformat() + "Z",
            status="success",
        ))

        if sid == self.current_session_id:
            self.current_session_id = None
            self.message_history = []
            self.variables = {}

    def track_message(self, event: MessageData):
        """追踪消息"""
        timestamp = event.timestamp or datetime.utcnow().isoformat() + "Z"

        self.message_history.append({
            "role": event.role,
            "content": event.content,
            "timestamp": timestamp,
        })

        self.trace(TraceData(
            session_id=event.session_id,
            trace_type="message",
            name=f"message_{event.role}",
            input={"role": event.role},
            output={"content": event.content},
            metadata=event.metadata,
            started_at=timestamp,
            status="success",
        ))

        if self.config.enable_breakpoints:
            self._check_and_handle_breakpoint(BreakpointCheckContext(
                content=event.content,
                metadata=event.metadata,
            ))

    def track_tool_call(self, event: ToolCallData):
        """追踪工具调用"""
        started_at = event.started_at or datetime.utcnow().isoformat() + "Z"

        self.trace(TraceData(
            session_id=event.session_id,
            trace_type="tool_call",
            name=event.tool_name,
            input=event.input_params,
            output=event.output,
            error=event.error,
            latency_ms=event.latency_ms,
            started_at=started_at,
            ended_at=event.ended_at,
            status="error" if event.error else "success",
        ))

        if self.config.enable_breakpoints:
            self._check_and_handle_breakpoint(BreakpointCheckContext(
                content=json.dumps(event.output) if event.output and not event.error else None,
                error=event.error,
                latency_ms=event.latency_ms,
                tool_name=event.tool_name,
            ))

    def set_variable(self, key: str, value: Any):
        """设置变量"""
        self.variables[key] = value

    def get_variable(self, key: str) -> Any:
        """获取变量"""
        return self.variables.get(key)

    def get_variables(self) -> Dict[str, Any]:
        """获取所有变量"""
        return self.variables.copy()

    def set_pause_handler(self, handler: BreakpointPauseHandler):
        """设置断点暂停处理器"""
        self.pause_handler = handler

    def is_paused_state(self) -> bool:
        """是否处于暂停状态"""
        return self.is_paused

    def resume(self):
        """恢复执行"""
        if self.is_paused:
            self.is_paused = False
            self.resume_event.set()

    # ─────────────────────────────────────────────
    # P0-1: 本地断点规则缓存 + 本地匹配
    # ─────────────────────────────────────────────

    def _refresh_breakpoint_rules(self):
        """刷新断点规则"""
        try:
            project_id = self._get_project_id()
            if not project_id:
                return

            response = requests.get(
                f"{self.config.base_url}/api/v1/breakpoints",
                params={"projectId": project_id},
                headers={"Authorization": f"Bearer {self.config.api_key}"},
                timeout=5,
            )

            if response.ok:
                data = response.json()
                self.breakpoint_rules = [
                    Breakpoint(**bp) for bp in data.get("breakpoints", [])
                ]
                self.breakpoint_cache_expiry = int(time.time() * 1000) + self.BREAKPOINT_CACHE_TTL
        except Exception:
            pass  # 静默失败

    def _match_breakpoints_locally(self, context: BreakpointCheckContext) -> List[Breakpoint]:
        """本地匹配断点"""
        triggered = []
        for bp in self.breakpoint_rules:
            if not bp.enabled:
                continue
            if bp.type == "keyword" and context.content and bp.condition in context.content:
                triggered.append(bp)
            elif bp.type == "error" and context.error:
                triggered.append(bp)
            elif bp.type == "latency" and context.latency_ms and context.latency_ms > float(bp.condition):
                triggered.append(bp)
        return triggered

    def _check_and_handle_breakpoint(self, context: BreakpointCheckContext):
        """检查并处理断点"""
        # 缓存过期则刷新
        if int(time.time() * 1000) > self.breakpoint_cache_expiry:
            self._refresh_breakpoint_rules()

        # 本地匹配
        triggered = self._match_breakpoints_locally(context)
        if not triggered:
            return

        # 命中了才发网络请求：创建快照
        try:
            state = SnapshotState(
                messages=self.message_history.copy(),
                variables=self.variables.copy(),
                metadata={
                    "session_id": self.current_session_id,
                    "timestamp": datetime.utcnow().isoformat() + "Z",
                },
            )

            if context.error:
                state.error = {"message": context.error}

            for breakpoint in triggered:
                requests.post(
                    f"{self.config.base_url}/api/v1/snapshots",
                    json={
                        "sessionId": self.current_session_id,
                        "breakpointId": breakpoint.id,
                        "triggerReason": f'Breakpoint "{breakpoint.name}" triggered',
                        "state": asdict(state),
                    },
                    headers={
                        "Content-Type": "application/json",
                        "Authorization": f"Bearer {self.config.api_key}",
                    },
                    timeout=5,
                )

            if self.pause_handler:
                self.is_paused = True
                self.resume_event.clear()

                # 调用暂停处理器
                for breakpoint in triggered:
                    # 注意：这里简化处理，实际可能需要 asyncio
                    should_resume = True  # 简化：默认继续
                    if not should_resume:
                        break

                if not should_resume:
                    self.resume_event.wait()  # 等待恢复

                self.is_paused = False
        except Exception as e:
            print(f"[AgentMonitor] Failed to handle breakpoint: {e}")

    def _get_project_id(self) -> str:
        """从 API Key 提取项目 ID"""
        parts = self.config.api_key.split("_")
        return parts[0] if len(parts) > 1 else ""

    # ─────────────────────────────────────────────
    # P1: 采样机制
    # ─────────────────────────────────────────────

    def _should_sample(self, trace: TraceData) -> bool:
        """判断是否应该采样"""
        # 1. 强制上报
        if trace.status == "error" and "error" in self.config.always_capture:
            return True
        if trace.trace_type == "breakpoint" and "breakpoint" in self.config.always_capture:
            return True
        if trace.trace_type == "session" and "session" in self.config.always_capture:
            return True

        # 2. Session 级采样
        if trace.session_id:
            if trace.session_id not in self.session_sample_decisions:
                self.session_sample_decisions[trace.session_id] = random.random() < self.config.sample_rate
            return self.session_sample_decisions[trace.session_id]

        # 3. 无 session：独立随机
        return random.random() < self.config.sample_rate

    # ─────────────────────────────────────────────
    # Flush & 上报
    # ─────────────────────────────────────────────

    def flush(self):
        """刷新缓冲区"""
        with self._lock:
            if not self.buffer or self.config.disabled:
                return

            events = self.buffer.copy()
            self.buffer = []

        try:
            for event in events:
                if event["type"] == "trace":
                    self._send_trace(event["data"])

            # 补发离线缓存
            if self.offline_buffer and self.is_online:
                offline_traces = self.offline_buffer.copy()
                self.offline_buffer = []
                for trace in offline_traces:
                    self._send_trace(asdict(trace))
        except Exception as e:
            with self._lock:
                self.buffer = events + self.buffer
            print(f"[AgentMonitor] Failed to flush: {e}")

    def _send_trace(self, trace_data: Dict[str, Any]):
        """发送 trace"""
        try:
            response = requests.post(
                f"{self.config.base_url}/api/v1/traces",
                json=trace_data,
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {self.config.api_key}",
                },
                timeout=5,
            )

            if not response.ok:
                raise Exception(f"HTTP {response.status_code}")

            self.is_online = True
            if self.retry_timer:
                self.retry_timer.cancel()
                self.retry_timer = None
        except Exception as e:
            self.is_online = False
            self.offline_buffer.append(TraceData(**trace_data))
            self._schedule_retry()
            raise e

    def _schedule_retry(self):
        """安排重试"""
        if self.retry_timer:
            return

        def retry():
            self.retry_timer = None
            self.retry_delay_ms = min(self.retry_delay_ms * 2, 60_000)
            self.flush()

        self.retry_timer = threading.Timer(self.retry_delay_ms / 1000, retry)
        self.retry_timer.start()

    def close(self):
        """关闭 SDK"""
        if self._flush_timer:
            self._flush_timer.cancel()
        if self.retry_timer:
            self.retry_timer.cancel()
        self.flush()

    def _start_flush_timer(self):
        """启动定时刷新"""
        def flush_task():
            self.flush()
            self._flush_timer = threading.Timer(self.config.flush_interval, flush_task)
            self._flush_timer.start()

        self._flush_timer = threading.Timer(self.config.flush_interval, flush_task)
        self._flush_timer.start()

    def _maybe_flush(self):
        """可能触发刷新"""
        if len(self.buffer) >= self.config.buffer_size:
            self.flush()
