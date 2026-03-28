"""
Unified MiniMax Orchestrator.

All user input (web, iMessage, voice) flows through here.

Flow:
1. Preload supermemory RAG context
2. Preload live agent status
3. Give MiniMax the full context + tools
4. MiniMax decides: answer directly, save to memory, or delegate browser task to Queen
"""

import asyncio
import json
import logging
import re
import uuid
from typing import AsyncGenerator

from services import supermemory_service
from services.minimax_client import client as minimax_client, MINIMAX_MODEL
from config import MINIMAX_MODEL as MODEL_NAME

logger = logging.getLogger(__name__)

# Minimum relevance score to consider a RAG result useful
RAG_SCORE_THRESHOLD = 0.3
RAG_MIN_CONTENT_LEN = 20

# ── Tool definitions for MiniMax function calling ──

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "save_memory",
            "description": (
                "Save a fact, note, preference, or reminder to long-term memory. "
                "Use when the user says 'remember', 'note', 'save', 'remind me', "
                "or shares personal info worth keeping."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "content": {
                        "type": "string",
                        "description": "The fact or note to save, written clearly for future recall",
                    }
                },
                "required": ["content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "delegate_browser_task",
            "description": (
                "Delegate a task to browser agents that can navigate websites, "
                "fill forms, search the web, compare prices, book things, "
                "extract data from pages, etc. Use when the user needs something "
                "done on the internet that requires actually visiting websites."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "task": {
                        "type": "string",
                        "description": "Clear, detailed description of what browser agents should do",
                    }
                },
                "required": ["task"],
            },
        },
    },
]

SYSTEM_PROMPT = """\
You are HIVEMIND, an AI assistant backed by a swarm of browser automation agents.

You have two tools:
- save_memory: Save facts, notes, or preferences for later recall
- delegate_browser_task: Send tasks to browser agents that navigate real websites

RULES:
- If the user asks to remember/note/save something → use save_memory
- If the user needs something done on the web (search, buy, compare, book, fill forms) → use delegate_browser_task
- If you can answer from the context/memory provided below or from general knowledge → just reply directly, no tools needed
- If agents are currently running, you can see their status below — report on it if asked
- Be conversational, concise, and helpful

{context_block}"""


async def _rag_lookup(query: str) -> str | None:
    """Search supermemory for relevant context. Returns context string or None."""
    try:
        results = await supermemory_service.search_memory(query, limit=3)
        if not results:
            return None

        best_score = max(r.get("score", 0) for r in results)
        snippets = []
        for r in results:
            text = r.get("content") or r.get("summary") or ""
            if len(text) >= RAG_MIN_CONTENT_LEN:
                snippets.append(text[:500])

        if snippets and best_score >= RAG_SCORE_THRESHOLD:
            return "\n---\n".join(snippets)
        return None
    except Exception as e:
        logger.warning("RAG lookup failed: %s", e)
        return None


def _build_status_text() -> str:
    """Gather live agent/task status."""
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

    return "\n".join(parts) if parts else ""


async def _save_to_memory(content: str) -> None:
    """Save a note/fact to supermemory."""
    try:
        await supermemory_service.save_memory(
            content=content,
            metadata={"type": "user_note"},
        )
        logger.info("Saved to memory: %s", content[:80])
    except Exception as e:
        logger.error("Failed to save to memory: %s", e)


async def _delegate_to_queen(text: str) -> str:
    """Hand off to Queen — spawns browser agents. Returns task_id."""
    from mind.queen import execute_task
    from models.task import TaskRequest, TaskResponse, TaskStatus
    from routers.tasks import _running_tasks, active_tasks
    from services.websocket_manager import manager as ws_manager
    from models import events

    tid = str(uuid.uuid4())[:8]
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


def _clean_think_tags(text: str) -> str:
    """Remove <think>...</think> tags from MiniMax output."""
    return re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()


async def process(
    text: str,
    conversation_history: list[dict] | None = None,
    source: str = "web",
) -> AsyncGenerator[dict, None]:
    """Unified processing pipeline. Yields event dicts:

    - {"type": "text", "content": "..."} — text response
    - {"type": "task_dispatched", "task_id": "...", "message": "..."} — Queen handling it
    - {"type": "done"} — stream complete
    """

    if not minimax_client:
        # Fallback if MiniMax not configured — go straight to Gemini chat
        logger.warning("MiniMax not configured, falling back to Gemini chat")
        from services.mistral_client import gemini_chat

        messages = [
            {"role": "system", "content": "You are Mindd, a helpful AI assistant."},
            {"role": "user", "content": text},
        ]
        reply = await gemini_chat(messages)
        yield {"type": "text", "content": reply or "No response."}
        yield {"type": "done"}
        return

    history = conversation_history or []

    # ── Step 1: Preload context (RAG + agent status) ──
    rag_context = await _rag_lookup(text)
    status_text = _build_status_text()

    context_parts = []
    if rag_context:
        context_parts.append(f"MEMORIES FROM PAST TASKS:\n{rag_context}")
    if status_text:
        context_parts.append(f"LIVE AGENT STATUS:\n{status_text}")

    context_block = "\n\n".join(context_parts) if context_parts else "No relevant memories or active agents."

    system_msg = SYSTEM_PROMPT.format(context_block=context_block)

    # ── Step 2: Build message history ──
    messages: list[dict] = [{"role": "system", "content": system_msg}]
    for m in history[-10:]:
        role = "user" if m.get("direction") == "inbound" else "assistant"
        content = m.get("text") or m.get("content") or ""
        if content:
            messages.append({"role": role, "content": content})
    messages.append({"role": "user", "content": text})

    # ── Step 3: Call MiniMax with tools ──
    try:
        response = await minimax_client.chat.completions.create(
            model=MODEL_NAME,
            messages=messages,
            tools=TOOLS,
            timeout=30.0,
            temperature=0.5,
            max_tokens=1024,
        )
    except Exception as e:
        logger.error("MiniMax orchestrator call failed: %s", e)
        yield {"type": "text", "content": f"Sorry, I ran into an issue: {e}"}
        yield {"type": "done"}
        return

    choice = response.choices[0].message
    tool_calls = choice.tool_calls or []
    content = _clean_think_tags(choice.content or "")

    # ── Step 4: Execute tool calls ──
    for tc in tool_calls:
        fn_name = tc.function.name
        try:
            args = json.loads(tc.function.arguments)
        except json.JSONDecodeError:
            logger.warning("Bad tool call args: %s", tc.function.arguments)
            continue

        if fn_name == "save_memory":
            fact = args.get("content", text)
            await _save_to_memory(fact)
            reply = content or "Got it, I'll remember that."
            yield {"type": "text", "content": reply}
            yield {"type": "done"}
            return

        elif fn_name == "delegate_browser_task":
            task_text = args.get("task", text)
            logger.info("Orchestrator: delegating to Queen: %s", task_text[:80])
            task_id = await _delegate_to_queen(task_text)
            ack = content or f"On it — working on: {task_text[:100]}"
            yield {
                "type": "task_dispatched",
                "task_id": task_id,
                "message": ack,
            }
            yield {"type": "done"}
            return

    # ── Step 5: No tool calls — MiniMax answered directly ──
    if content:
        yield {"type": "text", "content": content}
    else:
        yield {"type": "text", "content": "I'm not sure how to help with that. Could you rephrase?"}
    yield {"type": "done"}
