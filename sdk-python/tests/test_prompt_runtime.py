"""PR-12 Prompt Runtime 客户端单元测试。"""

import time
import threading
import pytest
from unittest.mock import MagicMock

from agentmonitor.prompt_runtime import PromptRuntimeClient, ResolvedPrompt


SAMPLE = {
    "promptId": "p-1",
    "promptName": "refund-agent",
    "promptVersionId": "v-1",
    "versionNumber": 3,
    "environment": "production",
    "content": "You are a refund agent v3",
    "variablesSchema": {"type": "object"},
    "modelDefaults": {"temperature": 0.2},
    "etag": '"pv-abc123"',
    "deployedAt": "2026-08-26T00:00:00.000Z",
}


def _make_response(status_code=200, json_data=None, headers=None, text=""):
    resp = MagicMock()
    resp.status_code = status_code
    resp.ok = 200 <= status_code < 300
    resp.headers = headers or {}
    resp.text = text
    resp.reason = "OK" if status_code == 200 else "ERR"
    resp.json = MagicMock(return_value=json_data or {})
    return resp


@pytest.fixture
def mock_session():
    session = MagicMock()
    session.get = MagicMock()
    return session


@pytest.fixture
def client(mock_session):
    return PromptRuntimeClient(
        base_url="https://api.example.com",
        api_key="amt_test",
        project_id="proj-1",
        default_max_age_sec=1.0,
        session=mock_session,
    )


def test_first_fetch_calls_runtime_and_returns_prompt(client, mock_session):
    mock_session.get.return_value = _make_response(200, SAMPLE, {"ETag": SAMPLE["etag"]})
    prompt = client.get("refund-agent")
    assert isinstance(prompt, ResolvedPrompt)
    assert prompt.prompt_version_id == "v-1"
    assert prompt.version_number == 3
    assert prompt.environment == "production"
    assert mock_session.get.call_count == 1
    url = mock_session.get.call_args.args[0]
    assert "/api/v2/runtime/prompts/refund-agent" in url
    params = mock_session.get.call_args.kwargs["params"]
    assert params["projectId"] == "proj-1"
    assert params["environment"] == "production"


def test_ttl_hit_returns_cache_without_network(client, mock_session):
    mock_session.get.return_value = _make_response(200, SAMPLE)
    client.get("refund-agent")
    client.get("refund-agent")
    assert mock_session.get.call_count == 1


def test_expired_ttl_uses_if_none_match_and_304_extends_cache(client, mock_session):
    mock_session.get.side_effect = [
        _make_response(200, SAMPLE, {"ETag": SAMPLE["etag"]}),
        _make_response(304, headers={"ETag": SAMPLE["etag"]}),
        _make_response(304, headers={"ETag": SAMPLE["etag"]}),
    ]
    first = client.get("refund-agent")
    assert first.prompt_version_id == "v-1"

    # 超过 TTL
    time.sleep(1.1)
    second = client.get("refund-agent")
    assert second.prompt_version_id == "v-1"
    headers = mock_session.get.call_args.kwargs["headers"]
    assert headers["If-None-Match"] == SAMPLE["etag"]

    # 304 后 TTL 续期，再次不发请求
    client.get("refund-agent")
    assert mock_session.get.call_count == 2


def test_force_refresh_skips_ttl_but_keeps_etag(client, mock_session):
    updated = {**SAMPLE, "promptVersionId": "v-2", "versionNumber": 4, "content": "v4", "etag": '"pv-new"'}
    mock_session.get.side_effect = [
        _make_response(200, SAMPLE, {"ETag": SAMPLE["etag"]}),
        _make_response(200, updated, {"ETag": updated["etag"]}),
    ]
    client.get("refund-agent")
    v2 = client.get("refund-agent", force_refresh=True)
    assert v2.prompt_version_id == "v-2"
    assert v2.content == "v4"


def test_different_environments_use_different_cache_keys(client, mock_session):
    staging = {**SAMPLE, "environment": "staging", "etag": '"etag-stg"'}
    mock_session.get.side_effect = [
        _make_response(200, SAMPLE, {"ETag": SAMPLE["etag"]}),
        _make_response(200, staging, {"ETag": staging["etag"]}),
    ]
    prod = client.get("refund-agent", environment="production")
    stg = client.get("refund-agent", environment="staging")
    assert prod.environment == "production"
    assert stg.environment == "staging"
    assert mock_session.get.call_count == 2
    assert client.cache_size == 2


def test_non_ok_response_raises(client, mock_session):
    mock_session.get.return_value = _make_response(404, text="not found")
    with pytest.raises(RuntimeError, match="404"):
        client.get("missing")


def test_clear_cache(client, mock_session):
    mock_session.get.return_value = _make_response(200, SAMPLE)
    client.get("refund-agent")
    assert client.cache_size == 1
    client.clear_cache()
    assert client.cache_size == 0


def test_cache_is_thread_safe(client, mock_session):
    """并发 20 个线程，首个请求填充缓存，其余应全部命中 TTL 缓存。"""
    mock_session.get.return_value = _make_response(200, SAMPLE, {"ETag": SAMPLE["etag"]})
    results = []
    errors = []

    def worker():
        try:
            results.append(client.get("refund-agent"))
        except Exception as exc:  # pragma: no cover - 仅用于失败时输出
            errors.append(exc)

    threads = [threading.Thread(target=worker) for _ in range(20)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert not errors
    assert len(results) == 20
    assert all(r.prompt_version_id == "v-1" for r in results)
    # TTL 足够长时，只允许 1 次网络请求（其它线程在锁内要么看到已填充缓存，要么等锁后看到）
    assert mock_session.get.call_count == 1
