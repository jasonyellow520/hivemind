# HIVEMIND v2: Completion Log

## Date: 2026-03-28

---

## Phase 1: Bug Fixes (All Complete)

### 1.1 Hex Layout Fixes
**File**: `frontend/src/hooks/useAgentNodes.ts`

| Bug | Fix |
|-----|-----|
| HEX_SIZE mismatch (110 vs 100) | Changed to `HEX_SIZE = 100` so `3/2 * 100 = 150px` spacing matches 200px wide hexes |
| Off-by-one spiral overflow | Changed `cellIndex++; continue` to `break` when spiral cells exhausted |
| RINGS calc missing domain gaps | Added `gapCells = Math.max(0, byDomain.size - 1)` to total cell count |
| Edge color always 'running' | Changed to `agent?.status \|\| (hasAgent ? 'running' : 'idle')` |

### 1.2 Dashboard Tab Filter
**File**: `frontend/src/hooks/useAgentNodes.ts`

Added `PROTECTED_HOSTS` array and `safeTabs = tabs.filter(...)` to exclude localhost:5173/5174/3000/8080/8081 from the hex canvas.

**Verified**: Playwright E2E test confirms no localhost tabs appear on canvas.

### 1.3 Tab Manager Race Condition
**File**: `backend/services/tab_manager.py`

- Added `_tabs_lock = asyncio.Lock()`
- Wrapped all `_tabs`/`_cdp_targets` access in `async with self._tabs_lock:`
- Merged `_assignment_lock` into `_tabs_lock`

### 1.4 MiniMax Async Fix + Model Config
**Files**: `backend/services/minimax_client.py`, `backend/services/llm_fallback.py`, `backend/config.py`

- `config.py`: Added `MINIMAX_MODEL = os.getenv("MINIMAX_MODEL", "MiniMax-M1")`
- `minimax_client.py`: Full rewrite from 30-line sync stub to async client with `openai.AsyncOpenAI`
- `llm_fallback.py`: Fixed to `await minimax_client.get_minimax_completion(...)`

### 1.5 Agent Logs Cleanup
**File**: `backend/mind/worker.py`

Replaced deprecated `loop.call_later(60, lambda)` with proper async cleanup:
```python
async def _cleanup_logs(aid, delay=60.0):
    await asyncio.sleep(delay)
    agent_logs.pop(aid, None)
asyncio.create_task(_cleanup_logs(agent_id))
```

### 1.6 iMessage Event Types
**File**: `backend/models/events.py`

Already had correct `imessage_received()`, `imessage_sent()`, `imessage_status_update()` helper functions. Router updated to use them instead of manual `WSEvent` construction.

### 1.7 Hardcoded CDP URL
**File**: `backend/mind/queen.py`

Replaced hardcoded `"http://127.0.0.1:9222"` with `CDP_DEFAULT_URL` imported from `services.tab_manager`.

### 1.8 Conversation Store Persistence
**File**: `backend/services/conversation_store.py`

Added `_periodic_save_loop()` that saves to disk every 5 minutes. Launched in `start()`, cancelled in `stop()`.

### 1.9 Test Import Paths
**Files**: `backend/tests/conftest.py`, `backend/tests/test_imessage_router.py`

- Added `conftest.py` with `sys.path` setup pointing to `backend/`
- Fixed test patches from `backend.routers.imessage.xxx` to `routers.imessage.xxx`

### 1.10 Dead Code Removal
Deleted `backend/hive/` directory (7 files, no imports referenced it).

---

## Phase 2: Subtask DAG Execution (Complete)

**File**: `backend/mind/queen.py`

Replaced broken independent/dependent split with proper topological DAG execution:
- Uses `asyncio.wait(running.values(), return_when=FIRST_COMPLETED)`
- Tasks launch as soon as all dependencies complete (not after all independent tasks finish)
- Handles dependency chains like A->B->D, A->C->D correctly

---

## Phase 3: LangGraph + Dispatcher Architecture (Complete)

### 3.1 HiveMindState
**File**: `backend/mind/state.py`

Added `HiveMindState(TypedDict)` with 17 fields: message context, intent classification, task execution, response, and control flow.

### 3.2 MiniMax Client
**File**: `backend/services/minimax_client.py`

Full async rewrite with 5 functions:
- `get_minimax_completion()` — base completion via `openai.AsyncOpenAI`
- `classify_intent()` — returns `{"intent", "confidence", "extracted_task"}`
- `quick_answer()` — conversational reply
- `chat_with_context()` — status-aware chat while swarm runs
- `synthesize_results()` — iMessage-friendly summary of agent outputs

### 3.3 LangGraph Rewrite
**File**: `backend/mind/graph.py`

Kept existing `build_mind_graph()` for web CommandBar. Added `build_hivemind_graph()` with:
- 7 nodes: receive_message, classify_intent, chat_respond, dispatch_queen, query_status, clarify, send_reply
- Conditional routing: classify_intent -> route_intent -> {chat, browser_task, status_query, unclear}
- All paths converge to send_reply -> END

### 3.4 iMessage Router Wiring
**File**: `backend/routers/imessage.py`

Replaced keyword-matching `_process_incoming_message()` with LangGraph invocation:
```python
graph = build_hivemind_graph()
result = await graph.ainvoke(initial_state)
```

### 3.5 Frontend WebSocket Events
**Files**: `frontend/src/types/mind.types.ts`, `frontend/src/store/useWebSocket.ts`

Added `IMESSAGE_RECEIVED`, `IMESSAGE_SENT`, `IMESSAGE_STATUS_UPDATE` event types and handlers that push to the activity feed.

---

## Phase 4: Dashboard Protection Hardening (Complete)

5 layers of protection:

| Layer | Location | Status |
|-------|----------|--------|
| 1. CDP tab filter | `tab_manager.scan_tabs()` | Working (pre-existing) |
| 2. Agent prohibited_domains | `browser_manager.py` L19-30 | Working (pre-existing) |
| 3. Frontend tab filter | `useAgentNodes.ts` PROTECTED_HOSTS | Added |
| 4. Agent start_url validation | `browser_manager.create_agent()` | Added |
| 5. Navigation guard | `tab_manager.navigate_tab()` | Added |

---

## Swarm-Tab Lifecycle Coupling (Complete)

**Problem**: Worker/swarm nodes persisted on the hex canvas even after their tab was closed or task completed. Phantom swarm hexagons appeared with no corresponding tab.

**Fixes**:
- **`frontend/src/store/useMindStore.ts`** — `setTabs()` now prunes agents whose tab was closed (only if agent is not actively running/planning)
- **`frontend/src/hooks/useAgentNodes.ts`** — `liveAgents` filter: completed/failed agents without a matching tab are excluded from rendering
- **`backend/routers/tabs.py`** — `close_tab()` now kills the assigned agent and broadcasts `AGENT_FAILED` when a tab is deleted
- **`backend/mind/graph.py`** — Fixed `chat_respond` bug: `_running_tasks` values are strings, not dicts (was calling `.get()` on a string)

---

## Ghost Tab Fix + Screenshot 404 Fix (Complete)

**Problem**: Playwright E2E tests created ghost tabs in Chrome via CDP — invisible in Chrome's tab bar but still reported by `/json`. These reappeared as hexagons on every rescan. Also, background tabs returned 404 on screenshot endpoint since Chrome can only screenshot the active tab.

**Fixes**:
- **`backend/services/tab_manager.py`** — Added `_closed_ids: set[str]` blacklist. Tabs explicitly closed by the user are excluded from future CDP rescans so ghost tabs never reappear. Blacklist auto-clears when the tab genuinely disappears from CDP.
- **`backend/services/tab_manager.py`** — Expanded `scan_tabs()` filter to include `localhost:8080/8081` and all `127.0.0.1:*` variants (was only filtering 3 hosts, now filters 10).
- **`backend/routers/tabs.py`** — Screenshot endpoint returns 200 with empty `screenshot_b64` instead of 404 for uncached/background tabs. Frontend already handles empty screenshots gracefully.
- **`tests/e2e_playwright.py`** — Rewritten to reuse a single page (finds existing dashboard tab). API tests use `fetch()` instead of `page.goto()`. No more ghost tab creation.

---

## Phase 5: Task-Clustered Swarm Layout (Complete)

**File**: `frontend/src/hooks/useAgentNodes.ts`

- Workers grouped by `taskId` into `taskGroups` Map
- Each task occupies an angular sector around the Queen
- Workers positioned within their task's sector at even intervals
- Tasks sorted by domain similarity so related tasks get adjacent sectors
- Tabs follow their assigned task's sector

---

## Phase 6: Playwright E2E Testing (Complete)

**File**: `tests/e2e_playwright.py`

Test script connects to running Chrome via CDP (port 9222). Results:

| Test | Result | Detail |
|------|--------|--------|
| Dashboard renders | PASS | ReactFlow canvas + CommandBar present |
| Hex layout | PASS | Correct node count, no overlap |
| Dashboard protection | PASS | No localhost tabs on canvas |
| Backend API | PASS | Health endpoint responding |
| WebSocket | PASS | Connection established |
| iMessage API | PASS | Health endpoint returns "degraded" (bridge not running, expected) |

All 6 tests passing after backend restart on port 8081.

Screenshots saved to `tests/screenshots/`.

---

## Files Modified

| File | Changes |
|------|---------|
| `frontend/src/hooks/useAgentNodes.ts` | Hex math fixes, dashboard filter, task-clustered layout, stale agent filter |
| `frontend/src/store/useMindStore.ts` | `setTabs()` prunes orphaned agents on tab update |
| `backend/mind/graph.py` | Full LangGraph rewrite with HiveMind Dispatcher |
| `backend/mind/state.py` | Added HiveMindState TypedDict |
| `backend/mind/queen.py` | DAG execution rewrite, CDP URL fix |
| `backend/mind/worker.py` | Agent logs async cleanup |
| `backend/services/minimax_client.py` | Full async rewrite (5 functions) |
| `backend/services/llm_fallback.py` | Fixed async await |
| `backend/services/tab_manager.py` | asyncio.Lock, navigation guard, `_closed_ids` ghost tab blacklist, expanded scan filter |
| `backend/services/browser_manager.py` | start_url validation |
| `backend/services/conversation_store.py` | Periodic persistence |
| `backend/routers/imessage.py` | LangGraph wiring, event fixes |
| `backend/routers/tabs.py` | `close_tab()` kills assigned agent, screenshot 404→200 fix |
| `backend/config.py` | MINIMAX_MODEL constant |
| `backend/models/events.py` | iMessage event helpers (already present) |
| `frontend/src/types/mind.types.ts` | iMessage event types |
| `frontend/src/store/useWebSocket.ts` | iMessage event handlers |
| `backend/tests/conftest.py` | sys.path fix |
| `backend/tests/test_imessage_router.py` | Import path fixes |

## Files Created
| File | Purpose |
|------|---------|
| `backend/routers/imessage.py` | iMessage webhook, send, conversations API |
| `backend/services/conversation_store.py` | In-memory conversation history with persistence |
| `backend/services/imessage_sender.py` | HTTP client to iMessage bridge |
| `backend/services/minimax_client.py` | MiniMax LLM client (classify, chat, synthesize) |
| `backend/services/llm_fallback.py` | MiniMax-to-Gemini fallback wrapper |
| `backend/tests/conftest.py` | Test configuration |
| `backend/tests/test_imessage_router.py` | Router unit tests |
| `tests/e2e_playwright.py` | Playwright E2E test suite |
| `run.py` | Single launcher for backend + frontend |

## Files Deleted
| File | Reason |
|------|--------|
| `backend/hive/` (7 files) | Dead code, no imports referenced it |
