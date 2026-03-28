"""
Unified MiniMax Orchestrator.

All user input (web, iMessage, voice) flows through here.
MiniMax classifies intent and checks supermemory RAG.
If RAG has the answer -> MiniMax responds directly.
If not -> delegates to Queen (Gemini) for knowledge or browser tasks.
"""

import asyncio
import logging
import uuid
from typing import AsyncGenerator

from services import minimax_client, supermemory_service
from services.minimax_client import (
    classify_intent,
    answer_with_context,
    format_status_reply,
)

logger = logging.getLogger(__name__)

# Minimum relevance score to consider a RAG result a "hit"
RAG_SCORE_THRESHOLD = 0.4
# Minimum content length to consider a RAG result useful
RAG_MIN_CONTENT_LEN = 20


async def _rag_lookup(query: str) -> tuple[str | None, float]:
    """Search supermemory for relevant context.

    Returns (context_string, best_score). context_string is None when
    nothing useful was found.
    """
    try:
        results = await supermemory_service.search_memory(query, limit=3)
        if not results:
            return None, 0.0

        best_score = max(r.get("score", 0) for r in results)
        snippets = []
        for r in results:
            text = r.get("content") or r.get("summary") or ""
            if len(text) >= RAG_MIN_CONTENT_LEN:
                snippets.append(text[:500])

        if snippets and best_score >= RAG_SCORE_THRESHOLD:
            return "\n---\n".join(snippets), best_score
        return None, best_score
    except Exception as e:
        logger.warning("RAG lookup failed: %s", e)
        return None, 0.0


def _build_status_text() -> str:
    """Gather live agent/task status for status_query intent."""
    parts: list[str] = []
    try:
        from routers.tasks import _running_tasks, active_tasks

        if _running_tasks:
            for tid, status in _running_tasks.items():
                parts.append(f"Task {tid}: {status}")
        if active_tasks:
            completed = [
                (tid, resp)
                for tid, resp in active_tasks.items()
                if resp.status == "completed"
            ]
            for tid, resp in completed[-3:]:
                result_preview = (resp.final_result or "")[:150]
                parts.append(f"Completed {tid}: {result_preview}")
    except Exception:
        pass

    try:
        from mind.worker import agent_logs
        from services.browser_manager import browser_manager

        for agent_id in browser_manager.agents:
            logs = agent_logs.get(agent_id, [])
            recent = logs[-1] if logs else {}
            step = recent.get("step", 0)
            action = recent.get("action", "working")
            url = recent.get("url", "")
            parts.append(
                f"Agent {agent_id}: step {step}, {action}"
                + (f" on {url}" if url else "")
            )
    except Exception:
        pass

    if not parts:
        return "No active tasks or agents right now."
    return "\n".join(parts)


async def _delegate_to_queen(text: str, task_id: str | None = None) -> str:
    """Hand off to Queen -- she decides whether to answer from knowledge or spawn agents."""
    from mind.queen import execute_task
    from models.task import TaskRequest, TaskResponse, TaskStatus
    from routers.tasks import _running_tasks, active_tasks
    from services.websocket_manager import manager as ws_manager
    from models import events

    tid = task_id or str(uuid.uuid4())[:8]
    request = TaskRequest(task=text)
    _running_tasks[tid] = "decomposing"

    async def _run():
        _running_tasks[tid] = "running"
        try:
            result = await execute_task(request, task_id=tid)
            active_tasks[tid] = result
        except Exception as e:
            logger.error("Queen task %s failed: %s", tid, e)
            active_tasks[tid] = TaskResponse(
                task_id=tid,
                status=TaskStatus.FAILED,
                subtasks=[],
                results=[],
                final_result=f"Task failed: {e}",
            )
            await ws_manager.broadcast(
                events.task_failed(tid, str(e), master_task=text)
            )
        finally:
            _running_tasks.pop(tid, None)

    asyncio.create_task(_run())
    return tid


async def process(
    text: str,
    conversation_history: list[dict] | None = None,
    source: str = "web",
) -> AsyncGenerator[dict, None]:
    """Unified processing pipeline. Yields event dicts:

    - {"type": "text", "content": "..."} -- a text chunk (for streaming)
    - {"type": "task_dispatched", "task_id": "...", "message": "..."} -- Queen is handling it
    - {"type": "done"} -- stream complete
    """

    history = conversation_history or []

    # Step 1: Classify intent via MiniMax
    classification = await classify_intent(text, history)
    intent = classification.get("intent", "unclear")
    extracted_task = classification.get("extracted_task")
    confidence = classification.get("confidence", 0.0)

    logger.info(
        "Orchestrator: intent=%s (%.2f) for: %s",
        intent,
        confidence,
        text[:80],
    )

    # Step 2: Handle status queries directly
    if intent == "status_query":
        status_text = _build_status_text()
        try:
            reply = await format_status_reply(text, status_text)
        except Exception:
            reply = status_text
        yield {"type": "text", "content": reply}
        yield {"type": "done"}
        return

    # Step 3: RAG lookup for everything else
    rag_context, rag_score = await _rag_lookup(text)

    if rag_context:
        # RAG has relevant data -- MiniMax answers directly
        logger.info(
            "Orchestrator: RAG hit (score=%.2f), MiniMax answering directly",
            rag_score,
        )
        try:
            reply = await answer_with_context(text, rag_context, history)
            yield {"type": "text", "content": reply}
            yield {"type": "done"}
            return
        except Exception as e:
            logger.warning(
                "MiniMax answer_with_context failed: %s, falling through to Queen", e
            )

    # Step 4: No RAG hit -- delegate to Queen
    task_text = extracted_task or text
    logger.info("Orchestrator: no RAG hit, delegating to Queen: %s", task_text[:80])
    task_id = await _delegate_to_queen(task_text)

    yield {
        "type": "task_dispatched",
        "task_id": task_id,
        "message": f"On it — working on: {task_text[:100]}",
    }
    yield {"type": "done"}
