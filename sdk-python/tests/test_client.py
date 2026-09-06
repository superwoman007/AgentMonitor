"""Comprehensive test suite for AgentMonitor Python SDK client."""

import random
import time
import asyncio
import uuid
import pytest
from unittest.mock import patch, MagicMock
from dataclasses import asdict

from agentmonitor.client import AgentMonitor
from agentmonitor.types import (
    SDKConfig,
    SessionData,
    TraceData,
    MessageData,
    ToolCallData,
    Breakpoint,
    BreakpointCheckContext,
)


def generate_test_api_key() -> str:
    """Generate a test API key: proj-{random}_test-key."""
    import uuid

    return f"proj-{uuid.uuid4().hex[:8]}_test-key"


@pytest.fixture
def make_client():
    """Factory fixture to create AgentMonitor clients with safe defaults."""
    clients = []

    def _make(**kwargs):
        config = SDKConfig(
            api_key=kwargs.pop("api_key", generate_test_api_key()),
            base_url=kwargs.pop("base_url", "http://localhost:3000"),
            disabled=kwargs.pop("disabled", False),
            buffer_size=kwargs.pop("buffer_size", 1000),
            flush_interval=kwargs.pop("flush_interval", 3600.0),
            enable_breakpoints=kwargs.pop("enable_breakpoints", False),
            sample_rate=kwargs.pop("sample_rate", 1.0),
            always_capture=kwargs.pop("always_capture", ["error", "breakpoint"]),
            **kwargs,
        )
        client = AgentMonitor(config)
        clients.append(client)
        return client

    yield _make

    for client in clients:
        # Prevent unexpected HTTP calls during teardown.
        client.buffer.clear()
        client.offline_buffer.clear()
        client.close()


# ─────────────────────────────────────────────────────────────
# 1. Initialization
# ─────────────────────────────────────────────────────────────


def test_init_basic(make_client):
    """Basic initialization stores config and prepares buffers."""
    client = make_client()
    assert client.config.base_url == "http://localhost:3000"
    assert client.config.disabled is False
    assert client.config.buffer_size == 1000
    assert client.config.flush_interval == 3600.0
    assert client.buffer == []
    assert client.offline_buffer == []


def test_init_disabled(make_client):
    """Disabled SDK does not start background flush timer."""
    client = make_client(disabled=True)
    assert client.config.disabled is True
    assert client._flush_timer is None


def test_agent_monitor_init_classmethod():
    """AgentMonitor.init(config) returns an AgentMonitor instance."""
    config = SDKConfig(api_key=generate_test_api_key())
    client = AgentMonitor.init(config)
    assert isinstance(client, AgentMonitor)
    assert client.config.api_key == config.api_key
    client.buffer.clear()
    client.offline_buffer.clear()
    client.close()


# ─────────────────────────────────────────────────────────────
# 2. Session lifecycle
# ─────────────────────────────────────────────────────────────


def test_start_session(make_client):
    """start_session creates session data and resets state."""
    client = make_client()
    session = client.start_session(
        session_id="test-session-123", metadata={"env": "test"}
    )
    assert isinstance(session, SessionData)
    assert session.id == "test-session-123"
    assert session.metadata == {"env": "test"}
    assert client.current_session_id == "test-session-123"
    assert client.message_history == []
    assert client.variables == {}


def test_start_session_auto_id(make_client):
    """start_session generates an ID when none is provided."""
    client = make_client()
    session = client.start_session()
    assert session.id.startswith("session_")
    assert client.current_session_id == session.id


def test_end_session(make_client):
    """end_session emits a session_end trace and clears state."""
    client = make_client()
    client.start_session(session_id="s1")
    client.end_session()
    assert client.current_session_id is None
    assert len(client.buffer) == 1
    assert client.buffer[0]["type"] == "trace"
    assert client.buffer[0]["data"]["trace_type"] == "session"
    assert client.buffer[0]["data"]["name"] == "session_end"


def test_end_session_specific_id(make_client):
    """end_session can end a specific session id."""
    client = make_client()
    client.start_session(session_id="s1")
    client.end_session(session_id="s1")
    assert client.current_session_id is None


# ─────────────────────────────────────────────────────────────
# 3. Trace recording
# ─────────────────────────────────────────────────────────────


def test_trace_records_to_buffer(make_client):
    """trace() adds enriched TraceData to the buffer."""
    client = make_client()
    trace = TraceData(
        trace_type="custom",
        name="test-trace",
        input={"x": 1},
        output={"y": 2},
        status="success",
    )
    client.trace(trace)
    assert len(client.buffer) == 1
    assert client.buffer[0]["type"] == "trace"
    assert client.buffer[0]["data"]["name"] == "test-trace"
    assert client.buffer[0]["data"]["input"] == {"x": 1}
    assert client.buffer[0]["data"]["status"] == "success"
    # timestamps should be auto-populated
    assert client.buffer[0]["data"]["started_at"] is not None


def test_trace_disabled_drops(make_client):
    """trace() is a no-op when SDK is disabled."""
    client = make_client(disabled=True)
    client.trace(TraceData(trace_type="custom", name="noop", status="success"))
    assert client.buffer == []


def test_trace_llm(make_client):
    """trace_llm() wraps LLM parameters into a TraceData entry."""
    client = make_client()
    client.trace_llm(
        model="gpt-4",
        request={"messages": [{"role": "user", "content": "hi"}]},
        response={"choices": [{"text": "hello"}]},
        latency_ms=150.0,
        success=True,
    )
    assert len(client.buffer) == 1
    data = client.buffer[0]["data"]
    assert data["trace_type"] == "llm"
    assert data["name"] == "gpt-4"
    assert data["status"] == "success"
    assert data["latency_ms"] == 150.0
    assert data["input"] == {"messages": [{"role": "user", "content": "hi"}]}


def test_trace_llm_error(make_client):
    """trace_llm() records error status and error message."""
    client = make_client()
    client.trace_llm(
        model="gpt-4",
        request={"messages": []},
        response=None,
        latency_ms=0.0,
        success=False,
        error="timeout",
    )
    data = client.buffer[0]["data"]
    assert data["status"] == "error"
    assert data["error"] == "timeout"


# ─────────────────────────────────────────────────────────────
# 4. Message & Tool tracking
# ─────────────────────────────────────────────────────────────


def test_track_message(make_client):
    """track_message appends to history and emits a trace."""
    client = make_client()
    msg = MessageData(
        session_id="s1",
        role="user",
        content="hello",
        metadata={"source": "test"},
    )
    client.track_message(msg)
    assert len(client.message_history) == 1
    assert client.message_history[0]["role"] == "user"
    assert client.message_history[0]["content"] == "hello"
    assert len(client.buffer) == 1
    data = client.buffer[0]["data"]
    assert data["trace_type"] == "message"
    assert data["name"] == "message_user"
    assert data["output"]["content"] == "hello"


def test_track_tool_call(make_client):
    """track_tool_call emits a tool_call trace with correct fields."""
    client = make_client()
    tool = ToolCallData(
        id="t1",
        session_id="s1",
        tool_name="search",
        input_params={"query": "pytest"},
        output={"results": [1, 2, 3]},
        latency_ms=45.0,
    )
    client.track_tool_call(tool)
    assert len(client.buffer) == 1
    data = client.buffer[0]["data"]
    assert data["trace_type"] == "tool_call"
    assert data["name"] == "search"
    assert data["input"] == {"query": "pytest"}
    assert data["output"] == {"results": [1, 2, 3]}
    assert data["latency_ms"] == 45.0
    assert data["status"] == "success"


def test_track_tool_call_error(make_client):
    """track_tool_call marks status as error when error is present."""
    client = make_client()
    tool = ToolCallData(
        id="t2",
        session_id="s1",
        tool_name="broken",
        input_params={},
        output=None,
        error="connection refused",
    )
    client.track_tool_call(tool)
    data = client.buffer[0]["data"]
    assert data["status"] == "error"
    assert data["error"] == "connection refused"


# ─────────────────────────────────────────────────────────────
# 5. Wrap decorator
# ─────────────────────────────────────────────────────────────


def test_wrap_sync_success(make_client):
    """Synchronous wrap decorator traces successful execution."""
    client = make_client()

    @client.wrap
    def add(a, b):
        return a + b

    result = add(1, 2)
    assert result == 3
    assert len(client.buffer) == 1
    data = client.buffer[0]["data"]
    assert data["name"] == "add"
    assert data["trace_type"] == "function"
    assert data["status"] == "success"
    assert data["output"] == 3
    assert data["input"] == {"args": (1, 2), "kwargs": {}}
    assert isinstance(data["latency_ms"], float)
    assert data["latency_ms"] >= 0


def test_wrap_sync_error(make_client):
    """Synchronous wrap decorator traces errors and re-raises."""
    client = make_client()

    def fail():
        raise ValueError("oops")

    wrapped = client.wrap(fail, name="fail_op")

    with pytest.raises(ValueError, match="oops"):
        wrapped()

    assert len(client.buffer) == 1
    data = client.buffer[0]["data"]
    assert data["name"] == "fail_op"
    assert data["status"] == "error"
    assert "oops" in data["error"]
    assert isinstance(data["latency_ms"], float)


@pytest.mark.asyncio
async def test_wrap_async_success(make_client):
    """Asynchronous wrap decorator traces successful execution."""
    client = make_client()

    @client.wrap
    async def async_add(a, b):
        await asyncio.sleep(0)
        return a + b

    result = await async_add(1, 2)
    assert result == 3
    assert len(client.buffer) == 1
    data = client.buffer[0]["data"]
    assert data["name"] == "async_add"
    assert data["trace_type"] == "function"
    assert data["status"] == "success"
    assert data["output"] == 3


@pytest.mark.asyncio
async def test_wrap_async_error(make_client):
    """Asynchronous wrap decorator traces errors and re-raises."""
    client = make_client()

    @client.wrap
    async def async_fail():
        await asyncio.sleep(0)
        raise RuntimeError("async oops")

    with pytest.raises(RuntimeError, match="async oops"):
        await async_fail()

    assert len(client.buffer) == 1
    data = client.buffer[0]["data"]
    assert data["name"] == "async_fail"
    assert data["status"] == "error"
    assert "async oops" in data["error"]


@pytest.mark.asyncio
async def test_contextvar_isolates_100_concurrent_async_tasks(make_client):
    """100 个 asyncio Task 并发嵌套 Span 时，traceId 与 parentSpanId 不应串扰。"""
    client = make_client(enable_span_write=True, flush_interval=3600.0)
    concurrency = 100

    async def run_one(index: int):
        root = client.start_span(f"root-{index}", trace_id=str(uuid.uuid4()))
        await asyncio.sleep(0)
        child = client.start_span(f"child-{index}")
        await asyncio.sleep(0)
        client.end_span(child, status="ok", output={"index": index})
        client.end_span(root, status="ok", output={"index": index})
        return {
            "root_trace_id": root.trace_id,
            "root_span_id": root.span_id,
            "child_trace_id": child.trace_id,
            "child_span_id": child.span_id,
            "child_parent_span_id": child.parent_span_id,
        }

    results = await asyncio.gather(*(run_one(i) for i in range(concurrency)))

    trace_ids = {item["root_trace_id"] for item in results}
    assert len(trace_ids) == concurrency

    for item in results:
        assert item["child_trace_id"] == item["root_trace_id"]
        assert item["child_parent_span_id"] == item["root_span_id"]
        assert item["child_span_id"] != item["root_span_id"]

    span_events = [event for event in client.buffer if event["type"] == "span"]
    assert len(span_events) == concurrency * 4
    for event in span_events:
        assert event["data"]["trace_id"] in trace_ids


# ─────────────────────────────────────────────────────────────
# 6. Flush & Offline retry
# ─────────────────────────────────────────────────────────────


def test_flush_sends_traces(make_client):
    """flush() POSTs buffered traces to the backend."""
    client = make_client()
    client.trace(TraceData(trace_type="test", name="flush-me", status="success"))

    with patch("agentmonitor.client.requests.post") as mock_post:
        mock_response = MagicMock()
        mock_response.ok = True
        mock_response.status_code = 200
        mock_post.return_value = mock_response

        client.flush()

        assert client.buffer == []
        mock_post.assert_called_once()
        args, kwargs = mock_post.call_args
        assert kwargs["json"]["name"] == "flush-me"
        assert "Authorization" in kwargs["headers"]
        assert args[0] == "http://localhost:3000/api/v1/traces"


def test_offline_retry(make_client):
    """Failed traces move to offline_buffer and are retried on next flush."""
    client = make_client()
    client.trace(TraceData(trace_type="test", name="retry-trace", status="success"))

    with patch("agentmonitor.client.requests.post") as mock_post:
        # First flush: network failure.
        mock_post.side_effect = Exception("Network error")
        client.flush()

        assert len(client.buffer) == 1  # restored by flush except handler
        assert len(client.offline_buffer) == 1
        assert client.offline_buffer[0].name == "retry-trace"
        assert client.is_online is False

        # Second flush: network recovers.
        mock_response = MagicMock()
        mock_response.ok = True
        mock_response.status_code = 200
        mock_post.side_effect = None
        mock_post.return_value = mock_response

        client.flush()

        assert len(client.buffer) == 0
        assert len(client.offline_buffer) == 0
        assert client.is_online is True
        assert mock_post.call_count >= 2


# ─────────────────────────────────────────────────────────────
# 7. Sampling (_should_sample)
# ─────────────────────────────────────────────────────────────


def test_sampling_rate_zero_drops_traces(make_client):
    """sample_rate=0 drops non-error traces."""
    client = make_client(sample_rate=0.0)
    client.trace(TraceData(trace_type="test", name="dropped", status="success"))
    assert client.buffer == []


def test_sampling_rate_one_keeps_all_traces(make_client):
    """sample_rate=1 keeps all traces."""
    client = make_client(sample_rate=1.0)
    for i in range(5):
        client.trace(
            TraceData(trace_type="test", name=f"kept-{i}", status="success")
        )
    assert len(client.buffer) == 5


def test_error_traces_always_captured(make_client):
    """Error traces are always captured regardless of sample_rate."""
    client = make_client(sample_rate=0.0, always_capture=["error"])
    client.trace(
        TraceData(
            trace_type="test", name="error-trace", status="error", error="boom"
        )
    )
    assert len(client.buffer) == 1
    assert client.buffer[0]["data"]["name"] == "error-trace"
    assert client.buffer[0]["data"]["status"] == "error"


def test_session_sampling_consistency(make_client):
    """Session-level sampling decisions are cached and consistent."""
    client = make_client(sample_rate=0.5)

    with patch.object(random, "random", return_value=0.3):
        # 0.3 < 0.5 => sample True, decision cached.
        result1 = client._should_sample(
            TraceData(
                trace_type="test", name="t1", session_id="s1", status="success"
            )
        )
        assert result1 is True

    with patch.object(random, "random", return_value=0.8):
        # Same session: should reuse cached decision even though new random is 0.8.
        result2 = client._should_sample(
            TraceData(
                trace_type="test", name="t2", session_id="s1", status="success"
            )
        )
        assert result2 is True

    with patch.object(random, "random", return_value=0.8):
        # New session: 0.8 > 0.5 => sample False.
        result3 = client._should_sample(
            TraceData(
                trace_type="test", name="t3", session_id="s2", status="success"
            )
        )
        assert result3 is False


# ─────────────────────────────────────────────────────────────
# 8. Breakpoint handling
# ─────────────────────────────────────────────────────────────


def test_breakpoint_keyword_trigger(make_client):
    """Keyword breakpoint triggers a snapshot POST when content matches."""
    client = make_client(enable_breakpoints=True)
    client.start_session(session_id="s1")
    client.breakpoint_rules = [
        Breakpoint(
            id="bp1",
            project_id="proj",
            name="keyword-bp",
            type="keyword",
            condition="SECRET",
            enabled=True,
        )
    ]
    client.breakpoint_cache_expiry = int(time.time() * 1000) + 60000

    with patch("agentmonitor.client.requests.post") as mock_post:
        mock_response = MagicMock()
        mock_response.ok = True
        mock_post.return_value = mock_response

        msg = MessageData(
            session_id="s1", role="user", content="my SECRET code", metadata={}
        )
        client.track_message(msg)

        snapshot_calls = [
            c for c in mock_post.call_args_list if "snapshots" in str(c)
        ]
        assert len(snapshot_calls) == 1
        _args, kwargs = snapshot_calls[0]
        payload = kwargs["json"]
        assert payload["sessionId"] == "s1"
        assert payload["breakpointId"] == "bp1"
        assert "keyword-bp" in payload["triggerReason"]


def test_breakpoint_latency_trigger(make_client):
    """Latency breakpoint triggers when latency_ms exceeds condition."""
    client = make_client(enable_breakpoints=True)
    client.breakpoint_rules = [
        Breakpoint(
            id="bp2",
            project_id="proj",
            name="latency-bp",
            type="latency",
            condition="100",
            enabled=True,
        )
    ]
    client.breakpoint_cache_expiry = int(time.time() * 1000) + 60000

    with patch("agentmonitor.client.requests.post") as mock_post:
        mock_response = MagicMock()
        mock_response.ok = True
        mock_post.return_value = mock_response

        tool = ToolCallData(
            id="t1",
            session_id="s1",
            tool_name="slow_tool",
            input_params={},
            output={"done": True},
            latency_ms=200.0,
        )
        client.track_tool_call(tool)

        snapshot_calls = [
            c for c in mock_post.call_args_list if "snapshots" in str(c)
        ]
        assert len(snapshot_calls) == 1
        _args, kwargs = snapshot_calls[0]
        assert kwargs["json"]["breakpointId"] == "bp2"


def test_breakpoint_no_trigger_when_disabled(make_client):
    """Disabled breakpoints do not trigger snapshot POSTs."""
    client = make_client(enable_breakpoints=True)
    client.breakpoint_rules = [
        Breakpoint(
            id="bp3",
            project_id="proj",
            name="disabled-bp",
            type="keyword",
            condition="ALERT",
            enabled=False,
        )
    ]
    client.breakpoint_cache_expiry = int(time.time() * 1000) + 60000

    with patch("agentmonitor.client.requests.post") as mock_post:
        msg = MessageData(
            session_id="s1", role="user", content="ALERT something", metadata={}
        )
        client.track_message(msg)

        snapshot_calls = [
            c for c in mock_post.call_args_list if "snapshots" in str(c)
        ]
        assert len(snapshot_calls) == 0


def test_breakpoint_error_trigger(make_client):
    """Error breakpoint triggers when an error is present."""
    client = make_client(enable_breakpoints=True)
    client.breakpoint_rules = [
        Breakpoint(
            id="bp4",
            project_id="proj",
            name="error-bp",
            type="error",
            condition="",
            enabled=True,
        )
    ]
    client.breakpoint_cache_expiry = int(time.time() * 1000) + 60000

    with patch("agentmonitor.client.requests.post") as mock_post:
        mock_response = MagicMock()
        mock_response.ok = True
        mock_post.return_value = mock_response

        tool = ToolCallData(
            id="t1",
            session_id="s1",
            tool_name="bad_tool",
            input_params={},
            output=None,
            error="something went wrong",
        )
        client.track_tool_call(tool)

        snapshot_calls = [
            c for c in mock_post.call_args_list if "snapshots" in str(c)
        ]
        assert len(snapshot_calls) == 1
