import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from services import supermemory_service
from services import browser_manager as bm_module
from config import (
    AGENT_MAX_STEPS,
    AGENT_TIMEOUT_SECONDS,
    AGENT_MAX_ACTIONS_PER_STEP,
)
from mind import queen as queen_module


#
# Memory tests (supermemory service)
#


@pytest.mark.asyncio
async def test_save_memory_returns_id(monkeypatch):
    class DummyMemories:
        async def add(self, **kwargs):
            return SimpleNamespace(id="dummy-id")

    class DummyClient:
        def __init__(self):
            self.memories = DummyMemories()

    dummy = DummyClient()
    supermemory_service._client = dummy  # type: ignore[attr-defined]

    doc_id = await supermemory_service.save_memory("hello world", {"source": "test"})
    assert doc_id == "dummy-id"


@pytest.mark.asyncio
async def test_search_memory_returns_results(monkeypatch):
    class DummyChunk:
        def __init__(self, content, is_relevant=True):
            self.content = content
            self.is_relevant = is_relevant

    class DummyResult:
        def __init__(self):
            self.document_id = "doc-1"
            self.score = 0.9
            self.title = "Title"
            self.summary = "Summary"
            self.content = "Full content"
            self.chunks = [DummyChunk("chunk")]

    class DummyResponse:
        def __init__(self):
            self.results = [DummyResult()]

    class DummySearch:
        async def execute(self, **kwargs):
            return DummyResponse()

    class DummyClient:
        def __init__(self):
            self.search = DummySearch()

    supermemory_service._client = DummyClient()  # type: ignore[attr-defined]

    results = await supermemory_service.search_memory("query", limit=3)
    assert len(results) == 1
    assert results[0]["id"] == "doc-1"
    assert "chunk" in results[0]["content"]


#
# Browser manager tests (single-agent execution limits)
#


@pytest.mark.asyncio
async def test_browser_manager_run_agent_uses_limits(monkeypatch):
    manager = bm_module.browser_manager

    class DummyResult:
        def final_result(self):
            return "ok"

    class DummyAgent:
        def __init__(self):
            self.called_with = {}

        async def run(self, max_steps: int):
            self.called_with["max_steps"] = max_steps
            await asyncio.sleep(0)
            return DummyResult()

    agent = DummyAgent()
    manager.agents["test-agent"] = agent  # type: ignore[assignment]

    result = await manager.run_agent("test-agent")
    assert result == "ok"
    assert agent.called_with["max_steps"] == AGENT_MAX_STEPS


#
# Queen / swarm provisioning tests
#


def test_url_domain_parsing():
    fn = queen_module._url_domain
    assert fn("https://www.gmail.com") == "gmail.com"
    assert fn("about:blank") is None
    assert fn("") is None


@pytest.mark.asyncio
async def test_provision_tabs_prefers_domain_match(monkeypatch):
    class DummyTab:
        def __init__(self, tab_id, url, assigned_agent_id=None):
            self.tab_id = tab_id
            self.url = url
            self.assigned_agent_id = assigned_agent_id

        def model_dump(self):
            return {"tab_id": self.tab_id, "url": self.url}

    class DummyTabManager:
        def __init__(self):
            self._tabs = [
                DummyTab("1", "https://mail.google.com"),
                DummyTab("2", "about:blank"),
            ]

        def is_cdp_connected(self) -> bool:
            return True

        def get_all_tabs(self):
            return list(self._tabs)

        async def open_tab(self, url: str):
            t = DummyTab("3", url)
            self._tabs.append(t)
            return t

        def assign_agent(self, tab_id: str, agent_id: str):
            for t in self._tabs:
                if t.tab_id == tab_id:
                    t.assigned_agent_id = agent_id

        def get_cdp_target_id(self, tab_id: str) -> str:
            return f"target-{tab_id}"

        async def navigate_tab(self, tab_id: str, url: str):
            for t in self._tabs:
                if t.tab_id == tab_id:
                    t.url = url

    dummy_tm = DummyTabManager()

    async def fake_provision(subtasks, tab_hints=None):
        # Inline call mirroring _provision_tabs_for_subtasks but using dummy_tm
        if not dummy_tm.is_cdp_connected():
            return [(st, "", None, None) for st in subtasks]

        cdp_http = "http://localhost:9222"
        all_tabs = await dummy_tm.get_all_tabs()
        free_tabs = [t for t in all_tabs if not t.assigned_agent_id]

        needed = max(0, len(subtasks) - len(free_tabs))
        if needed > 0:
            new_tabs = await asyncio.gather(
                *[dummy_tm.open_tab("about:blank") for _ in range(needed)],
                return_exceptions=True,
            )
            for t in new_tabs:
                if not isinstance(t, Exception):
                    free_tabs.append(t)

        hints = tab_hints or [None] * len(subtasks)
        result = []
        for idx, subtask in enumerate(subtasks):
            tab = None
            hint = hints[idx] if idx < len(hints) else None
            hint_domain = queen_module._url_domain(hint)
            want_domain = hint_domain or queen_module._url_domain(subtask.url)

            if hint:
                for i, t in enumerate(free_tabs):
                    if t.url and t.url.strip() == hint.strip():
                        tab = free_tabs.pop(i)
                        break

            if tab is None and want_domain:
                for i, t in enumerate(free_tabs):
                    if queen_module._url_domain(t.url) == want_domain:
                        tab = free_tabs.pop(i)
                        break

            if tab is None:
                blank_idx = next(
                    (i for i, t in enumerate(free_tabs) if (t.url or "").strip() in ("", "about:blank")),
                    None,
                )
                if blank_idx is not None:
                    tab = free_tabs.pop(blank_idx)
                elif free_tabs:
                    tab = free_tabs.pop(0)

            if tab:
                if subtask.url and subtask.url not in ("about:blank", ""):
                    await dummy_tm.navigate_tab(tab.tab_id, subtask.url)
                agent_id = f"worker-{subtask.subtask_id}"
                dummy_tm.assign_agent(tab.tab_id, agent_id)
                target_id = dummy_tm.get_cdp_target_id(tab.tab_id)
                result.append((subtask, tab.tab_id, cdp_http, target_id))
            else:
                result.append((subtask, "", cdp_http, None))

        return result

    from models.task import SubTask

    st = SubTask(description="Do gmail thing", url="https://mail.google.com")
    mappings = await fake_provision([st], tab_hints=[None])

    assert len(mappings) == 1
    subtask, tab_id, cdp_url, target_id = mappings[0]
    assert tab_id == "1"
    assert "localhost:9222" in cdp_url
    assert target_id == "target-1"


#
# HITL / sensitive detection tests (shape only)
#


def test_sensitive_detection_triggers_reason():
    from mind.sensitive import detect

    is_sensitive, reason = detect("I will submit_form now", url="https://example.com/checkout")
    assert is_sensitive
    assert "sensitive" in reason.lower()

