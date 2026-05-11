"""AgentMonitor LangChain Callback Handler

Auto-trace LangChain Chain / Agent / LLM / Tool execution flow.
"""

import time
import uuid
from typing import Any, Dict, Optional
from datetime import datetime

from .client import AgentMonitor


class AgentMonitorLangChainCallback:
    """LangChain Callback Handler that auto-reports Trace/Span to AgentMonitor.

    Usage:
        from agentmonitor import AgentMonitor, SDKConfig
        from agentmonitor.langchain_callback import AgentMonitorLangChainCallback

        monitor = AgentMonitor.init(SDKConfig(api_key="...", base_url="..."))
        callback = AgentMonitorLangChainCallback(monitor)

        llm = ChatOpenAI(callbacks=[callback])
        agent = initialize_agent(tools, llm, callbacks=[callback])
    """

    def __init__(self, monitor: AgentMonitor):
        self.monitor = monitor
        # run_id -> {span_id, trace_id, parent_run_id, name, trace_type, started_at}
        self._run_map: Dict[str, Dict[str, Any]] = {}

    def _now(self) -> str:
        return datetime.utcnow().isoformat() + "Z"

    def _start_span(
        self,
        run_id: str,
        parent_run_id: Optional[str],
        name: str,
        trace_type: str,
        input_data: Any,
    ) -> str:
        trace_id = None
        if parent_run_id:
            trace_id = self._run_map.get(str(parent_run_id), {}).get("trace_id")
        if not trace_id:
            trace_id = str(uuid.uuid4())

        span_id = str(uuid.uuid4())
        parent_span_id = None
        if parent_run_id:
            parent_span_id = self._run_map.get(str(parent_run_id), {}).get("span_id")

        self._run_map[str(run_id)] = {
            "span_id": span_id,
            "trace_id": trace_id,
            "parent_run_id": str(parent_run_id) if parent_run_id else None,
            "name": name,
            "trace_type": trace_type,
            "started_at": time.time(),
        }

        self.monitor.buffer.append({
            "type": "span",
            "data": {
                "span_id": span_id,
                "trace_id": trace_id,
                "parent_span_id": parent_span_id,
                "name": name,
                "trace_type": trace_type,
                "started_at": self._now(),
                "input": input_data,
                "session_id": self.monitor.current_session_id,
            },
        })
        self.monitor._maybe_flush()
        return span_id

    def _end_span(
        self,
        run_id: str,
        output: Any = None,
        error: Optional[str] = None,
        status: str = "success",
    ):
        info = self._run_map.pop(str(run_id), None)
        if not info:
            return

        latency_ms = (time.time() - info["started_at"]) * 1000
        self.monitor.buffer.append({
            "type": "span",
            "data": {
                "span_id": info["span_id"],
                "trace_id": info["trace_id"],
                "name": info["name"],
                "trace_type": info["trace_type"],
                "started_at": datetime.utcfromtimestamp(info["started_at"]).isoformat() + "Z",
                "ended_at": self._now(),
                "latency_ms": latency_ms,
                "output": output,
                "error": error,
                "status": "error" if error else status,
            },
        })
        self.monitor._maybe_flush()

    # LangChain Callback Methods

    def on_chain_start(self, serialized, inputs, *, run_id, parent_run_id=None, **kwargs):
        name = serialized.get("name", "chain") if isinstance(serialized, dict) else "chain"
        self._start_span(str(run_id), parent_run_id, name, "chain", inputs)

    def on_chain_end(self, outputs, *, run_id, **kwargs):
        self._end_span(str(run_id), output=outputs, status="success")

    def on_chain_error(self, error, *, run_id, **kwargs):
        self._end_span(str(run_id), error=str(error), status="error")

    def on_llm_start(self, serialized, prompts, *, run_id, parent_run_id=None, **kwargs):
        name = serialized.get("name", "llm") if isinstance(serialized, dict) else "llm"
        self._start_span(str(run_id), parent_run_id, name, "llm", {"prompts": prompts})

    def on_llm_end(self, response, *, run_id, **kwargs):
        output = None
        try:
            if response and hasattr(response, "generations"):
                output = [{"text": g.text} for gen in response.generations for g in gen]
        except Exception:
            pass
        self._end_span(str(run_id), output=output, status="success")

    def on_llm_error(self, error, *, run_id, **kwargs):
        self._end_span(str(run_id), error=str(error), status="error")

    def on_tool_start(self, serialized, input_str, *, run_id, parent_run_id=None, **kwargs):
        name = serialized.get("name", "tool") if isinstance(serialized, dict) else "tool"
        self._start_span(str(run_id), parent_run_id, name, "tool", {"input": input_str})

    def on_tool_end(self, output, *, run_id, **kwargs):
        self._end_span(str(run_id), output=output, status="success")

    def on_tool_error(self, error, *, run_id, **kwargs):
        self._end_span(str(run_id), error=str(error), status="error")

    def on_agent_action(self, action, *, run_id, parent_run_id=None, **kwargs):
        name = getattr(action, "tool", "agent_action")
        self._start_span(str(run_id), parent_run_id, name, "agent_action", {"tool": name, "input": getattr(action, "tool_input", None)})

    def on_agent_finish(self, finish, *, run_id, **kwargs):
        self._end_span(str(run_id), output=getattr(finish, "return_values", None), status="success")

    def on_text(self, text, *, run_id, parent_run_id=None, **kwargs):
        pass

    def on_retriever_start(self, serialized, query, *, run_id, parent_run_id=None, **kwargs):
        name = serialized.get("name", "retriever") if isinstance(serialized, dict) else "retriever"
        self._start_span(str(run_id), parent_run_id, name, "retriever", {"query": query})

    def on_retriever_end(self, documents, *, run_id, **kwargs):
        output = [{"page_content": d.page_content, "metadata": d.metadata} for d in documents] if documents else None
        self._end_span(str(run_id), output=output, status="success")

    def on_retriever_error(self, error, *, run_id, **kwargs):
        self._end_span(str(run_id), error=str(error), status="error")
