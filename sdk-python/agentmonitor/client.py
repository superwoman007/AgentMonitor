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
    SpanContext,
)
from . import context as span_context
from .prompt_runtime import PromptRuntimeClient, ResolvedPrompt, PromptEnvironment


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

        # P0-01: Span 级追踪
        # active_spans 仅作为活跃 span 的注册表（span_id -> SpanContext），
        # 用于内存上限保护与 close() 时兜底关闭。真正的父子关系与并发隔离
        # 由 contextvars 维护（见 context.py），不再依赖进程级共享栈。
        self.active_spans: Dict[str, SpanContext] = {}
        self.MAX_SPAN_STACK_SIZE = 1000

        # PR-12: Prompt Runtime 客户端（懒加载）
        self._prompt_runtime: Optional[PromptRuntimeClient] = None

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
        """记录追踪数据。

        V2 协议：SDK 生成统一的 traceId/spanId 并随 /traces 请求发送，
        后端 createTrace 是根 Span 的唯一写入点；SDK 不再向 buffer 双写 span，
        避免产生重复根节点与 traceId/spanId 不一致的孤儿数据。
        """
        if self.config.disabled:
            return

        # P1: 采样检查
        if not self._should_sample(data):
            return

        import uuid
        # 仅在调用方未显式传入时生成 ID，保证一次 trace 全链路使用同一组 ID
        if not data.trace_id:
            data.trace_id = str(uuid.uuid4())
        if not data.span_id:
            data.span_id = str(uuid.uuid4())
        # trace 作为根 Span，没有 parentSpanId（保持 None）

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
        """追踪 LLM 调用。

        PR-12：若 request 中携带 ``prompt_ref``（通过 Runtime 解析的 Prompt 引用），
        自动把 ``prompt.id / prompt.version_id`` 等写入 metadata，便于按版本聚合 Trace。
        """
        metadata: Dict[str, Any] = {"model": model}
        if response and isinstance(response, dict) and "usage" in response:
            metadata["usage"] = response["usage"]
        prompt_ref = request.get("prompt_ref") if isinstance(request, dict) else None
        if isinstance(prompt_ref, dict):
            metadata["prompt"] = {
                "id": prompt_ref.get("id"),
                "version_id": prompt_ref.get("version_id"),
                "name": prompt_ref.get("name"),
                "version_number": prompt_ref.get("version_number"),
                "environment": prompt_ref.get("environment"),
            }
        self.trace(TraceData(
            trace_type="llm",
            name=model,
            input=request,
            output=response,
            metadata=metadata,
            latency_ms=latency_ms,
            status="success" if success else "error",
            error=error,
        ))

    # ─────────────────────────────────────────────
    # PR-12: Prompt Runtime
    # ─────────────────────────────────────────────

    def _get_prompt_runtime(self) -> PromptRuntimeClient:
        """懒加载 Prompt Runtime 客户端。"""
        if self._prompt_runtime is not None:
            return self._prompt_runtime
        project_id = self.config.project_id or self._get_project_id()
        if not project_id:
            raise RuntimeError(
                "[AgentMonitor] project_id is required for prompt runtime. "
                "Set `project_id` in SDKConfig or use an api_key formatted as `<projectId>_<secret>`."
            )
        self._prompt_runtime = PromptRuntimeClient(
            base_url=self.config.base_url,
            api_key=self.config.api_key,
            project_id=project_id,
            default_max_age_sec=self.config.prompt_cache_ttl_sec,
        )
        return self._prompt_runtime

    def get_prompt(
        self,
        prompt_name: str,
        environment: PromptEnvironment = "production",
        max_age_sec: Optional[float] = None,
        force_refresh: bool = False,
        timeout: float = 10.0,
    ) -> ResolvedPrompt:
        """从 Runtime 解析已发布的 Prompt。"""
        return self._get_prompt_runtime().get(
            prompt_name,
            environment=environment,
            max_age_sec=max_age_sec,
            force_refresh=force_refresh,
            timeout=timeout,
        )

    def clear_prompt_cache(self) -> None:
        """清空 Prompt Runtime 缓存。"""
        if self._prompt_runtime is not None:
            self._prompt_runtime.clear_cache()


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

    # ─────────────────────────────────────────────
    # P0-01: Span API
    # ─────────────────────────────────────────────

    def start_span(self, name: str, trace_id: Optional[str] = None,
                   input_data: Any = None, attributes: Optional[Dict[str, Any]] = None,
                   session_id: Optional[str] = None) -> SpanContext:
        """开始一个新的 Span。

        Truth Repair-3：trace_id/parent_span_id 从当前 contextvars 异步上下文读取，
        不再依赖进程级共享栈，避免 asyncio 并发任务间的 trace 串扰。

        Args:
            name: Span 名称（如函数名或操作名）
            trace_id: 显式指定所属 traceId；缺省时从当前异步上下文读取或新生成一个
            input_data: 输入数据（可选）
            attributes: 附加属性字典（可选）
            session_id: 会话 ID，缺省时使用当前会话 ID（可选）
        Returns:
            创建好的 SpanContext 实例
        """
        import uuid
        # 从当前异步链读取 traceId；无则生成一个作为新链路根
        tid = trace_id or span_context.get_active_trace_id() or str(uuid.uuid4())
        span_id = str(uuid.uuid4())
        # 从当前异步链读取栈顶 spanId 作为父级
        parent_span_id = span_context.get_active_span_id()

        ctx = SpanContext(
            span_id=span_id,
            trace_id=tid,
            name=name,
            trace_type="span",
            started_at=datetime.utcnow().isoformat() + "Z",
            parent_span_id=parent_span_id,
            input=input_data,
            attributes=attributes,
            session_id=session_id or self.current_session_id,
        )

        # 压入当前异步上下文栈，维护父子关系
        span_context.push_active_span(ctx)
        # 同时注册到实例级活跃表，用于内存保护与 close() 兜底
        with self._lock:
            self.active_spans[span_id] = ctx
        self._maybe_cleanup_active_spans()
        self._buffer_span(ctx)
        return ctx

    def end_span(self, ctx: SpanContext, status: Optional[str] = None,
                 output: Any = None, error: Optional[str] = None,
                 attributes: Optional[Dict[str, Any]] = None):
        """结束一个 Span。

        Args:
            ctx: 由 start_span 返回的 SpanContext
            status: 状态字符串；未提供时根据 error 自动推导 ok/error
            output: 输出数据（可选）
            error: 错误信息（可选）
            attributes: 需要合并写入的附加属性（可选）
        Returns:
            None
        """
        ended_at = datetime.utcnow().isoformat() + "Z"
        latency_ms = 0
        try:
            start = datetime.fromisoformat(ctx.started_at.replace("Z", "+00:00"))
            from datetime import timezone
            latency_ms = (datetime.now(timezone.utc) - start).total_seconds() * 1000
        except Exception:
            pass

        # V2 协议：成功终态统一为 'ok'，兼容旧调用方传 'success'
        raw_status = status or ("error" if error else "ok")
        normalized_status = "ok" if raw_status == "success" else raw_status

        ctx.ended_at = ended_at
        ctx.latency_ms = latency_ms
        ctx.status = normalized_status
        ctx.output = output
        ctx.error = error
        if attributes:
            if ctx.attributes:
                ctx.attributes.update(attributes)
            else:
                ctx.attributes = attributes

        # 从当前异步上下文栈弹出
        span_context.pop_active_span(ctx)
        # 从实例级活跃表移除
        with self._lock:
            self.active_spans.pop(ctx.span_id, None)

        self._buffer_span(ctx)

    def with_span(self, name: str, trace_id: Optional[str] = None,
                  input_data: Any = None, attributes: Optional[Dict[str, Any]] = None):
        """上下文管理器：自动管理 Span 生命周期。

        Args:
            name: Span 名称（如函数名或操作名）
            trace_id: 所属 traceId（可选）
            input_data: 输入数据（可选）
            attributes: 附加属性字典（可选）
        Returns:
            _SpanContextManager 实例，支持 with 语句
        """
        return _SpanContextManager(self, name, trace_id, input_data, attributes)

    def set_span_attribute(self, key: str, value: Any) -> bool:
        """在当前异步上下文活跃的 Span 上设置单个属性。

        Args:
            key: 属性键名
            value: 属性值
        Returns:
            True 表示存在活跃 span 并已写入；False 表示当前不在 span 上下文中
        """
        return span_context.set_span_attribute(key, value)

    def set_span_attributes(self, attrs: Dict[str, Any]) -> bool:
        """在当前异步上下文活跃的 Span 上批量合并属性。

        Args:
            attrs: 需要合并写入的属性字典
        Returns:
            True 表示存在活跃 span 并已写入；False 表示当前不在 span 上下文中
        """
        return span_context.set_span_attributes(attrs)

    def _buffer_span(self, span: SpanContext):
        """将 span 数据推入 buffer。

        Args:
            span: 需要写入缓冲的 SpanContext 实例
        Returns:
            None
        """
        if not self.config.enable_span_write:
            return
        with self._lock:
            self.buffer.append({"type": "span", "data": asdict(span)})
            self._maybe_flush()

    def _maybe_cleanup_active_spans(self):
        """内存保护：活跃 span 总数超过阈值时强制关闭最早注册的 span。

        Args:
            无
        Returns:
            None
        """
        with self._lock:
            if len(self.active_spans) > self.MAX_SPAN_STACK_SIZE:
                # dict 在 Python 3.7+ 保持插入顺序，next(iter(...)) 取最早 key
                first_key = next(iter(self.active_spans), None)
                if first_key:
                    stale = self.active_spans.pop(first_key)
                    stale.status = "error"
                    stale.error = "auto-closed: active span overflow"
                    self._buffer_span(stale)

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
                elif event["type"] == "span":
                    self._send_span(event["data"])

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

    def _send_span(self, span_data: Dict[str, Any]):
        """发送 span 数据到 POST /api/v1/spans。

        Args:
            span_data: 以字典形式序列化的 span 数据
        Returns:
            None
        """
        try:
            response = requests.post(
                f"{self.config.base_url}/api/v1/spans",
                json=span_data,
                headers={
                    "Content-Type": "application/json",
                    "X-API-Key": self.config.api_key,
                },
                timeout=5,
            )
            if not response.ok:
                print(f"[AgentMonitor] Failed to send span: HTTP {response.status_code}")
        except Exception as e:
            print(f"[AgentMonitor] Failed to send span: {e}")

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
        """关闭 SDK，自动结束所有未关闭的 span 后刷新缓冲区"""
        if self._flush_timer:
            self._flush_timer.cancel()
        if self.retry_timer:
            self.retry_timer.cancel()

        # 自动结束所有未关闭的 span（active_spans 注册表兜底，与异步上下文解耦）
        with self._lock:
            spans_to_close = list(self.active_spans.values())
            self.active_spans.clear()
        for span in spans_to_close:
            span.status = "error"
            span.error = "auto-closed: monitor closed"
            self._buffer_span(span)

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


class _SpanContextManager:
    """Span 上下文管理器，支持 with 语句自动管理 Span 生命周期"""

    def __init__(self, monitor: "AgentMonitor", name: str,
                 trace_id: Optional[str], input_data: Any,
                 attributes: Optional[Dict[str, Any]]):
        """初始化上下文管理器。

        Args:
            monitor: AgentMonitor 客户端实例
            name: Span 名称
            trace_id: 所属 traceId（可选）
            input_data: 输入数据（可选）
            attributes: 附加属性字典（可选）
        """
        self.monitor = monitor
        self.name = name
        self.trace_id = trace_id
        self.input_data = input_data
        self.attributes = attributes
        self.span: Optional[SpanContext] = None

    def __enter__(self) -> SpanContext:
        """进入上下文：创建并启动 Span。

        Args:
            无
        Returns:
            创建好的 SpanContext 实例
        """
        self.span = self.monitor.start_span(
            self.name, self.trace_id, self.input_data, self.attributes
        )
        return self.span

    def __exit__(self, exc_type, exc_val, exc_tb):
        """退出上下文：根据是否有异常自动设置 Span 状态并结束。

        Args:
            exc_type: 异常类型（无异常时为 None）
            exc_val: 异常实例（无异常时为 None）
            exc_tb: 异常 traceback（无异常时为 None）
        Returns:
            False，表示不吞掉异常，继续向外传播
        """
        if self.span:
            if exc_type:
                self.monitor.end_span(self.span, status="error", error=str(exc_val))
            else:
                # V2 协议：成功终态统一为 'ok'
                self.monitor.end_span(self.span, status="ok")
        return False  # 不吞异常
