# Unified MiniMax Orchestrator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the separate task/chat entry points with a single MiniMax orchestrator that classifies intent, checks supermemory RAG, and either answers directly from memory or delegates to the Queen (Gemini) for knowledge answers and browser agent tasks.

**Architecture:** All user input (web CommandBar, iMessage, Alt+Z chatbar, voice) routes through a single `orchestrator.process()` function. MiniMax classifies the intent and searches supermemory. If RAG has the answer, MiniMax responds directly. If not, the request goes to Queen — who either answers from Gemini's knowledge or spawns browser agents. The web path streams responses via SSE; the iMessage path returns a full string.

**Tech Stack:** Python/FastAPI (backend), React/TypeScript (frontend), MiniMax M2.7 (classification + RAG answers), Gemini (Queen/Workers/chat fallback), Supermemory (RAG), OpenAI SDK (MiniMax client)

---

## File Structure

### New Files
- `backend/mind/orchestrator.py` — Unified orchestrator: classify, RAG lookup, route to MiniMax answer or Queen
- `backend/routers/input.py` — Single `POST /api/v1/input` SSE endpoint

### Modified Files
- `backend/routers/imessage.py:88-134` — `_process_incoming_message()` calls orchestrator instead of HiveMindGraph
- `backend/services/minimax_client.py` — Add `answer_with_context()` for RAG-backed responses and `stream_answer_chunks()` for chunked delivery
- `backend/main.py:8,118-126` — Register new `input` router
- `frontend/src/components/Dashboard/CommandBar.tsx` — Remove mode toggle, single input always hits `/api/v1/input`

### Unchanged Files (kept for backward compat)
- `backend/routers/chat.py` — Kept as-is; old endpoint still works
- `backend/routers/tasks.py` — Kept as-is; Queen still uses it internally, orchestrator calls `execute_task()` directly
- `backend/mind/graph.py` — Kept; HiveMindGraph remains available but iMessage no longer uses it by default

---

### Task 1: Add `answer_with_context()` to MiniMax client

**Files:**
- Modify: `backend/services/minimax_client.py`

This adds the function the orchestrator will call when RAG has relevant data and MiniMax should answer directly.

- [ ] **Step 1: Add `answer_with_context()` function**

Append to `backend/services/minimax_client.py`:

```python
async def answer_with_context(
    question: str,
    rag_context: str,
    conversation_history: list[dict] | None = None,
) -> str:
    """Answer a question using RAG context from supermemory."""
    messages = [
        {
            "role": "system",
            "content": (
                "You are HIVEMIND, an AI assistant backed by a browser automation swarm. "
                "Answer the user's question using ONLY the context provided below. "
                "If the context doesn't fully answer the question, say what you know "
                "and mention that the information may be outdated.\n\n"
                f"Context from memory:\n{rag_context}"
            ),
        },
    ]
    if conversation_history:
        for m in conversation_history[-8:]:
            role = "user" if m.get("direction") == "inbound" else "assistant"
            text = m.get("text") or m.get("content") or ""
            if text:
                messages.append({"role": role, "content": text})
    messages.append({"role": "user", "content": question})

    try:
        return await get_minimax_completion(messages, temperature=0.3, max_tokens=1024)
    except Exception as e:
        logger.error(f"answer_with_context failed: {e}")
        raise
```

- [ ] **Step 2: Add `format_status_reply()` function**

Append to `backend/services/minimax_client.py`:

```python
async def format_status_reply(
    question: str,
    status_data: str,
) -> str:
    """Format a status query response using MiniMax."""
    messages = [
        {
            "role": "system",
            "content": (
                "You are HIVEMIND. The user is asking about the status of running tasks. "
                "Format the status data below into a clear, concise reply.\n\n"
                f"Current status:\n{status_data}"
            ),
        },
        {"role": "user", "content": question},
    ]
    try:
        return await get_minimax_completion(messages, temperature=0.3, max_tokens=512)
    except Exception as e:
        logger.error(f"format_status_reply failed: {e}")
        return status_data  # Fallback to raw status
```

- [ ] **Step 3: Verify MiniMax client imports work**

Run: `cd backend && python -c "from services.minimax_client import answer_with_context, format_status_reply, classify_intent; print('OK')"`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add backend/services/minimax_client.py
git commit -m "feat: add answer_with_context and format_status_reply to minimax_client"
```

---

### Task 2: Create the unified orchestrator

**Files:**
- Create: `backend/mind/orchestrator.py`

This is the core brain — classify intent, RAG lookup, route appropriately.

- [ ] **Step 1: Create `backend/mind/orchestrator.py`**

```python
"""
Unified MiniMax Orchestrator.

All user input (web, iMessage, voice) flows through here.
MiniMax classifies intent and checks supermemory RAG.
If RAG has the answer → MiniMax responds directly.
If not → delegates to Queen (Gemini) for knowledge or browser tasks.
"""

import logging
import uuid
from typing import AsyncGenerator

from services import minimax_client, supermemory_service
from services.minimax_client import classify_intent, answer_with_context, format_status_reply

logger = logging.getLogger(__name__)

# Minimum relevance score to consider a RAG result a "hit"
RAG_SCORE_THRESHOLD = 0.4
# Minimum content length to consider a RAG result useful
RAG_MIN_CONTENT_LEN = 20


async def _rag_lookup(query: str) -> tuple[str | None, float]:
    """Search supermemory for relevant context.

    Returns (context_string, best_score).  context_string is None when
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
            parts.append(f"Agent {agent_id}: step {step}, {action}" + (f" on {url}" if url else ""))
    except Exception:
        pass

    if not parts:
        return "No active tasks or agents right now."
    return "\n".join(parts)


async def _delegate_to_queen(text: str, task_id: str | None = None) -> str:
    """Hand off to Queen — she decides whether to answer from knowledge or spawn agents."""
    from mind.queen import execute_task
    from models.task import TaskRequest

    tid = task_id or str(uuid.uuid4())[:8]
    request = TaskRequest(task=text)

    # Run in background so we can return an ack immediately
    import asyncio
    from routers.tasks import _running_tasks, active_tasks
    from services.websocket_manager import manager as ws_manager
    from models import events

    _running_tasks[tid] = "decomposing"

    async def _run():
        _running_tasks[tid] = "running"
        try:
            result = await execute_task(request, task_id=tid)
            active_tasks[tid] = result
        except Exception as e:
            logger.error("Queen task %s failed: %s", tid, e)
            from models.task import TaskResponse, TaskStatus
            active_tasks[tid] = TaskResponse(
                task_id=tid,
                status=TaskStatus.FAILED,
                subtasks=[],
                results=[],
                final_result=f"Task failed: {e}",
            )
            await ws_manager.broadcast(events.task_failed(tid, str(e), master_task=text))
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

    - {"type": "text", "content": "..."} — a text chunk (for streaming)
    - {"type": "task_dispatched", "task_id": "...", "message": "..."} — Queen is handling it
    - {"type": "done"} — stream complete
    """

    history = conversation_history or []

    # Step 1: Classify intent via MiniMax
    classification = await classify_intent(text, history)
    intent = classification.get("intent", "unclear")
    extracted_task = classification.get("extracted_task")
    confidence = classification.get("confidence", 0.0)

    logger.info(
        "Orchestrator: intent=%s (%.2f) for: %s",
        intent, confidence, text[:80],
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
        # RAG has relevant data — MiniMax answers directly
        logger.info("Orchestrator: RAG hit (score=%.2f), MiniMax answering directly", rag_score)
        try:
            reply = await answer_with_context(text, rag_context, history)
            yield {"type": "text", "content": reply}
            yield {"type": "done"}
            return
        except Exception as e:
            logger.warning("MiniMax answer_with_context failed: %s, falling through to Queen", e)

    # Step 4: No RAG hit — delegate to Queen
    task_text = extracted_task or text
    logger.info("Orchestrator: no RAG hit, delegating to Queen: %s", task_text[:80])
    task_id = await _delegate_to_queen(task_text)

    yield {
        "type": "task_dispatched",
        "task_id": task_id,
        "message": f"On it — working on: {task_text[:100]}",
    }
    yield {"type": "done"}
```

- [ ] **Step 2: Verify orchestrator imports work**

Run: `cd backend && python -c "from mind.orchestrator import process; print('OK')"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add backend/mind/orchestrator.py
git commit -m "feat: create unified MiniMax orchestrator (classify + RAG + Queen delegation)"
```

---

### Task 3: Create the unified `/api/v1/input` endpoint

**Files:**
- Create: `backend/routers/input.py`
- Modify: `backend/main.py:8,118-126`

- [ ] **Step 1: Create `backend/routers/input.py`**

```python
"""
Unified input endpoint.

Single entry point for the web dashboard CommandBar.
Routes all input through the MiniMax orchestrator.
Returns SSE stream for real-time responses.
"""

import json
import logging
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from mind.orchestrator import process

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/input", tags=["input"])

# Shared conversation history for web dashboard sessions
_conversation_history: list[dict] = []


class InputMessage(BaseModel):
    message: str


@router.post("/")
async def unified_input(msg: InputMessage):
    """Unified SSE endpoint — all web dashboard input goes here."""
    _conversation_history.append({"role": "user", "content": msg.message})

    async def generate():
        full_reply = ""
        try:
            async for event in process(
                text=msg.message,
                conversation_history=_conversation_history,
                source="web",
            ):
                if event["type"] == "text":
                    chunk = event["content"]
                    full_reply += chunk
                    yield f"data: {json.dumps({'type': 'text', 'text': chunk})}\n\n"

                elif event["type"] == "task_dispatched":
                    task_id = event["task_id"]
                    message = event["message"]
                    full_reply = message
                    yield f"data: {json.dumps({'type': 'task_dispatched', 'task_id': task_id, 'text': message})}\n\n"

                elif event["type"] == "done":
                    yield "data: [DONE]\n\n"

        except Exception as e:
            logger.error("Unified input stream error: %s", e)
            error_msg = f"Error: {str(e)}"
            full_reply = error_msg
            yield f"data: {json.dumps({'type': 'text', 'text': error_msg})}\n\n"
            yield "data: [DONE]\n\n"

        if full_reply:
            _conversation_history.append({"role": "assistant", "content": full_reply})

        # Save to supermemory
        try:
            from services import supermemory_service
            await supermemory_service.save_chat_exchange(msg.message, full_reply)
        except Exception:
            pass

    return StreamingResponse(generate(), media_type="text/event-stream")


@router.delete("/history")
async def clear_history():
    """Clear the web conversation history."""
    _conversation_history.clear()
    return {"status": "cleared"}
```

- [ ] **Step 2: Register the router in `backend/main.py`**

In `backend/main.py` line 8, add `input` to the router imports:

Change:
```python
from routers import tasks, hitl, agents, tabs, chat, screencast, memory, voice, imessage
```
To:
```python
from routers import tasks, hitl, agents, tabs, chat, screencast, memory, voice, imessage, input
```

After line 126 (`app.include_router(imessage.router)`), add:
```python
app.include_router(input.router)
```

- [ ] **Step 3: Verify the server starts**

Run: `cd backend && python -c "from routers.input import router; print('routes:', [r.path for r in router.routes])"`
Expected: `routes: ['/api/v1/input/', '/api/v1/input/history']` (or similar)

- [ ] **Step 4: Commit**

```bash
git add backend/routers/input.py backend/main.py
git commit -m "feat: add unified /api/v1/input SSE endpoint"
```

---

### Task 4: Wire iMessage bridge through the orchestrator

**Files:**
- Modify: `backend/routers/imessage.py:88-134`

Replace the HiveMindGraph dispatch with a direct call to the orchestrator. The iMessage bridge collects the full response (no streaming) and sends it back via iMessage.

- [ ] **Step 1: Replace `_process_incoming_message` in `backend/routers/imessage.py`**

Replace lines 88-134 (the entire `_process_incoming_message` function) with:

```python
async def _process_incoming_message(message: WebhookMessage):
    """Process incoming iMessage through the unified orchestrator."""
    try:
        from mind.orchestrator import process
        from services import conversation_store, imessage_sender

        # Load conversation history for context
        history = await conversation_store.get_messages_by_conversation(
            message.from_phone, limit=10
        )

        full_reply = ""
        task_dispatched = False

        async for event in process(
            text=message.text,
            conversation_history=history,
            source="imessage",
        ):
            if event["type"] == "text":
                full_reply += event["content"]
            elif event["type"] == "task_dispatched":
                task_dispatched = True
                task_id = event["task_id"]
                full_reply = event["message"]
                # Associate task with phone for status updates
                try:
                    await conversation_store.associate_task_with_conversation(
                        task_id, message.from_phone
                    )
                except Exception:
                    pass

        # Send reply via iMessage
        if full_reply:
            try:
                await imessage_sender.send_imessage(
                    to_phone=message.from_phone,
                    text=full_reply,
                )
                logger.info("Orchestrator reply sent to %s: %s", message.from_phone, full_reply[:60])
            except Exception as e:
                logger.error("Failed to send iMessage reply: %s", e)

        # Store outbound message
        try:
            from datetime import datetime
            await conversation_store.add_message(
                message_id=f"reply-{message.message_id}",
                from_phone="system",
                to_phone=message.from_phone,
                text=full_reply,
                timestamp=datetime.utcnow(),
                direction="outbound",
            )
        except Exception:
            pass

    except Exception as e:
        logger.error("Orchestrator failed for message %s: %s", message.message_id, e)
        try:
            from services import imessage_sender
            await imessage_sender.send_imessage(
                to_phone=message.from_phone,
                text="Sorry, I had trouble processing that. Please try again.",
            )
        except Exception:
            pass
```

- [ ] **Step 2: Verify imessage router imports work**

Run: `cd backend && python -c "from routers.imessage import router; print('OK')"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add backend/routers/imessage.py
git commit -m "feat: wire iMessage bridge through unified orchestrator"
```

---

### Task 5: Update CommandBar to use unified input (remove mode toggle)

**Files:**
- Modify: `frontend/src/components/Dashboard/CommandBar.tsx`

Remove the `task`/`chat` mode toggle. All input goes to `POST /api/v1/input`. The response stream now includes both text replies AND task dispatch acks.

- [ ] **Step 1: Remove mode state and update handleSubmit**

In `CommandBar.tsx`, make these changes:

1. **Remove the `mode` state** (line 39): Delete `const [mode, setMode] = useState<'task' | 'chat'>('chat')`

2. **Replace `handleSubmit`** (lines 567-592) with:

```typescript
const handleSubmit = useCallback(async () => {
    const trimmed = input.trim()
    if (!trimmed || isSubmitting) return

    pushCommand(trimmed)
    setInput('')
    setHistoryIdx(-1)
    setShowSuggestions(false)

    if (trimmed.startsWith('/')) {
      await handleSlashCommand(trimmed)
      return
    }

    // Tab-selected mode still routes directly as a task to that specific tab
    if (selectedTab) {
      await sendTask(trimmed)
      return
    }

    // Everything else goes through the unified orchestrator
    await sendUnified(trimmed)
  }, [input, isSubmitting, pushCommand, handleSlashCommand, selectedTab, sendTask])
```

3. **Add `sendUnified` function** (after `sendChat`, around line 503):

```typescript
const sendUnified = useCallback(async (message: string) => {
    setChatOpen(true)
    setChatMessages((prev) => [...prev, { role: 'user', text: message }])
    setIsSubmitting(true)

    try {
      const res = await fetch('/api/v1/input/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      })

      if (!res.ok || !res.body) throw new Error('Stream unavailable')

      setChatMessages((prev) => [...prev, { role: 'assistant', text: '' }])

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let fullReply = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const text = decoder.decode(value, { stream: true })
        const lines = text.split('\n')
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const payload = line.slice(6).trim()
            if (payload === '[DONE]') continue
            try {
              const parsed = JSON.parse(payload)
              if (parsed.type === 'text' && parsed.text) {
                fullReply += parsed.text
                const reply = fullReply
                setChatMessages((prev) => {
                  const updated = [...prev]
                  updated[updated.length - 1] = { role: 'assistant', text: reply }
                  return updated
                })
              } else if (parsed.type === 'task_dispatched') {
                fullReply = parsed.text || 'Working on it...'
                const reply = fullReply
                setChatMessages((prev) => {
                  const updated = [...prev]
                  updated[updated.length - 1] = { role: 'assistant', text: reply }
                  return updated
                })
                // Also update task store so the dashboard shows agent activity
                const store = useMindStore.getState()
                store.setTask({
                  masterTask: message,
                  status: 'decomposing',
                  finalResult: null,
                  agentResults: [],
                })
              }
            } catch {
              // Skip malformed chunks
            }
          }
        }
      }

      useMindStore.getState().pushFeed({
        type: 'log',
        text: `> ${fullReply.slice(0, 60)}`,
        timestamp: new Date().toISOString(),
      })
    } catch {
      // Fallback to old chat endpoint
      try {
        const res = await fetch('/api/v1/chat/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message }),
        })
        const data = await res.json()
        setChatMessages((prev) => {
          const last = prev[prev.length - 1]
          if (last?.role === 'assistant' && last.text === '') {
            const updated = [...prev]
            updated[updated.length - 1] = { role: 'assistant', text: data.reply || 'No response.' }
            return updated
          }
          return [...prev, { role: 'assistant', text: data.reply || 'No response.' }]
        })
      } catch {
        setChatMessages((prev) => [...prev, { role: 'assistant', text: 'Connection error. Is the backend running?' }])
      }
    } finally {
      setIsSubmitting(false)
    }
  }, [])
```

- [ ] **Step 2: Remove mode toggle UI and update references**

1. **Remove the mode toggle button** in the JSX (lines 916-932 — the `<button onClick={() => setMode(...)}>` block). Replace that entire block with a static label:

```tsx
<div
  className="flex items-center gap-1.5 shrink-0 px-2 py-1 rounded-lg"
  style={{ background: 'rgba(0,212,255,0.08)', border: '1px solid rgba(0,212,255,0.2)' }}
>
  <Terminal className="w-3 h-3" style={{ color: '#00d4ff' }} />
  <span className="terminal-text text-[10px] font-semibold" style={{ color: '#00d4ff' }}>
    MIND
  </span>
</div>
```

2. **Update `modeLabel` and `modeColor`** (line 627-628): Replace with:
```typescript
const modeLabel = selectedTab ? `→ ${domain(selectedTab.url)}` : 'MIND'
const modeColor = '#00d4ff'
```

3. **Update the placeholder text** (lines 957-964): Replace with:
```typescript
placeholder={
  selectedTab
    ? `Give AI a task for ${domain(selectedTab.url)}...`
    : isRunning
      ? 'Mind is processing...'
      : 'Ask anything or give a task... (Ctrl+K)'
}
```

4. **Update disabled prop** (line 965): Change `disabled={isSubmitting && mode === 'task'}` to `disabled={isSubmitting}`

5. **Update submit button disabled** (line 1078): Change `disabled={!input.trim() || (isSubmitting && mode === 'task')}` to `disabled={!input.trim() || isSubmitting}`

6. **Update thinking indicator** (line 740): Change `{isSubmitting && mode === 'chat' && (` to `{isSubmitting && (`

7. **Remove `/task` slash command** from `SLASH_COMMANDS` array (line 10) and from `handleSlashCommand` switch (lines 389-391).

8. **Remove example tasks condition** (line 858): Change `{task.status === 'idle' && !input && mode === 'task' && !chatOpen && (` to `{task.status === 'idle' && !input && !chatOpen && (`

9. **Update voice dispatch** (line 220): Change `'/api/v1/tasks/submit'` to `'/api/v1/input/'` and change the body from `JSON.stringify({ task: text })` to `JSON.stringify({ message: text })`.

- [ ] **Step 3: Verify frontend compiles**

Run: `cd frontend && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors (or only pre-existing ones)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/Dashboard/CommandBar.tsx
git commit -m "feat: remove task/chat mode toggle, unify input through orchestrator"
```

---

### Task 6: Integration test — end-to-end verification

**Files:** None (manual verification)

- [ ] **Step 1: Start backend and verify endpoint exists**

Run: `cd backend && python -c "from main import app; routes = [r.path for r in app.routes]; print('/api/v1/input/' in [r.path for r in app.routes] or any('/input' in str(r.path) for r in app.routes))"`

- [ ] **Step 2: Verify orchestrator pipeline works in isolation**

Run:
```bash
cd backend && python -c "
import asyncio
from mind.orchestrator import process

async def test():
    events = []
    async for e in process('hello, how are you?', source='test'):
        events.append(e)
        print(e)
    assert any(e['type'] in ('text', 'task_dispatched') for e in events), 'No response events'
    print('PASS')

asyncio.run(test())
"
```

- [ ] **Step 3: Verify frontend builds**

Run: `cd frontend && npm run build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: unified MiniMax orchestrator — single input for web + iMessage"
```

---

## Execution Notes

- **Cross-platform**: All code uses standard Python asyncio and HTTP. No Windows-specific paths. The `openai` SDK (for MiniMax) and `google-genai` SDK (for Gemini) both work on Mac and Windows.
- **iMessage bridge**: Still Mac-only by nature, but the orchestrator itself is platform-agnostic. On Windows, iMessage endpoints just won't receive webhooks — everything else works.
- **Backward compat**: Old `/api/v1/chat/stream` and `/api/v1/tasks/submit` endpoints remain functional. The orchestrator is additive.
- **`input` as a module name**: Python has a built-in `input()` function but `routers/input.py` is imported as `routers.input` which doesn't shadow it. This is safe.
