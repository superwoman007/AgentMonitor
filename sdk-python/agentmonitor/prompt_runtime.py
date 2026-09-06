"""PR-12: Prompt Runtime 客户端。

对应后端 ``GET /api/v2/runtime/prompts/:name`` 接口，提供：

- ETag / 304 协商缓存
- 硬 TTL 缓存（默认 60 秒）
- 线程安全（与 Python SDK 其它模块一致，使用 threading.Lock 保护内存缓存）
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field
from typing import Any, Dict, Literal, Optional

try:
    import requests
except ImportError:  # pragma: no cover - requests 是必选依赖
    raise ImportError("请安装 requests: pip install requests")


PromptEnvironment = Literal["production", "staging", "development"]


@dataclass
class ResolvedPrompt:
    """Runtime 解析返回的已发布 Prompt。"""

    prompt_id: str
    prompt_name: str
    prompt_version_id: str
    version_number: int
    environment: str
    content: str
    variables_schema: Optional[Dict[str, Any]] = None
    model_defaults: Optional[Dict[str, Any]] = None
    etag: str = ""
    deployed_at: str = ""

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ResolvedPrompt":
        """从后端 JSON 构造（后端字段为 camelCase）。"""
        return cls(
            prompt_id=data["promptId"],
            prompt_name=data["promptName"],
            prompt_version_id=data["promptVersionId"],
            version_number=data["versionNumber"],
            environment=data["environment"],
            content=data["content"],
            variables_schema=data.get("variablesSchema"),
            model_defaults=data.get("modelDefaults"),
            etag=data.get("etag", ""),
            deployed_at=data.get("deployedAt", ""),
        )


@dataclass
class _CacheEntry:
    prompt: ResolvedPrompt
    cached_at: float


class PromptRuntimeClient:
    """Prompt Runtime 客户端。"""

    def __init__(
        self,
        base_url: str,
        api_key: str,
        project_id: str,
        default_max_age_sec: float = 60.0,
        session: Optional[requests.Session] = None,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._project_id = project_id
        self._default_max_age = default_max_age_sec
        self._cache: Dict[str, _CacheEntry] = {}
        self._lock = threading.Lock()
        self._session = session or requests.Session()

    def _cache_key(self, prompt_name: str, environment: str) -> str:
        return f"{self._project_id}::{environment}::{prompt_name}"

    def get(
        self,
        prompt_name: str,
        environment: PromptEnvironment = "production",
        max_age_sec: Optional[float] = None,
        force_refresh: bool = False,
        timeout: float = 10.0,
    ) -> ResolvedPrompt:
        """按名称解析一个已发布的 Prompt。

        - 未过期缓存直接命中；
        - 过期后带 If-None-Match 协商；
        - 304 则延长缓存寿命；200 覆盖；非 2xx/304 抛异常。
        """
        ttl = self._default_max_age if max_age_sec is None else max_age_sec
        key = self._cache_key(prompt_name, environment)
        now = time.monotonic()

        with self._lock:
            existing = self._cache.get(key)
        if not force_refresh and existing is not None and now - existing.cached_at < ttl:
            return existing.prompt

        url = (
            f"{self._base_url}/api/v2/runtime/prompts/"
            f"{requests.utils.quote(prompt_name, safe='')}"
        )
        params = {"projectId": self._project_id, "environment": environment}
        headers = {"Authorization": f"Bearer {self._api_key}"}
        if existing is not None:
            headers["If-None-Match"] = existing.prompt.etag

        resp = self._session.get(url, params=params, headers=headers, timeout=timeout)
        if resp.status_code == 304 and existing is not None:
            with self._lock:
                self._cache[key] = _CacheEntry(prompt=existing.prompt, cached_at=time.monotonic())
            return existing.prompt

        if not resp.ok:
            raise RuntimeError(
                f"Prompt runtime {resp.status_code}: {resp.text.strip() or resp.reason}"
            )

        data = resp.json()
        prompt = ResolvedPrompt.from_dict(data)
        with self._lock:
            self._cache[key] = _CacheEntry(prompt=prompt, cached_at=time.monotonic())
        return prompt

    def clear_cache(self) -> None:
        """清空全部缓存。"""
        with self._lock:
            self._cache.clear()

    @property
    def cache_size(self) -> int:
        """当前缓存条目数（主要用于测试 / 可观测性）。"""
        with self._lock:
            return len(self._cache)


__all__ = [
    "PromptRuntimeClient",
    "ResolvedPrompt",
    "PromptEnvironment",
]
