# HIVEMIND v2: Remaining Work & Known Issues

## Status: Core implementation complete (Phases 1-5). See [COMPLETION.md](COMPLETION.md) for what's done.

---

## Remaining Work

### Person A -- Dashboard Redesign + Demo + Pitch
All tasks remain open. Person A works independently in Stitch (Google design tool).

| # | Task | Status |
|---|------|--------|
| A1 | Redesign dashboard layout in Stitch | Not started |
| A2 | Redesign CommandBar, EventFeed, AgentLogPanel | Not started |
| A3 | Redesign QueenNode, WorkerNode, TabNode visuals | Not started |
| A4 | Landing/hero page for hackathon demo | Not started |
| A5 | Pitch deck -- "Text your AI" narrative | Not started |
| A6 | Demo script + talking points (3-min flow) | Not started |
| A7 | Record backup demo video | Blocked by working demo |
| A8 | Apply Stitch designs to React components | Blocked by A1-A3 |

### Person B -- iMessage Bridge (Photon SDK)
The Node.js iMessage bridge sidecar has not been built yet. This is macOS-only work.

| # | Task | Status |
|---|------|--------|
| B1 | Set up `backend/imessage-bridge/` Node.js project | Not started |
| B2 | Implement Photon polling + webhook POST | Not started (blocked by B1) |
| B3 | Implement `/send` endpoint for outbound iMessages | Not started (blocked by B1) |
| B7 | End-to-end test: iMessage -> swarm -> reply | Blocked by B2, B3 |

### Person C -- Intent Classification Testing

| # | Task | Status |
|---|------|--------|
| C2 | Test intent classification with 10+ sample messages | Not started (needs MiniMax API key) |

---

## Known Issues

### High Priority

1. **Backend needs restart after code changes**
   The running uvicorn instance does not have the new iMessage routes loaded. Restart with `cd backend && uvicorn main:app --reload --port 8080`.

2. **MiniMax API key not tested**
   The `minimax_client.py` is complete but `MINIMAX_API_KEY` may not be set in `.env`. Without it, all MiniMax functions will raise RuntimeError. The `llm_fallback.py` falls back to Gemini.

3. **iMessage bridge not built**
   The `imessage_sender.py` HTTP client is ready but the bridge sidecar (Node.js on macOS) at `http://localhost:3001` doesn't exist yet. All iMessage send operations will fail until Person B builds it.

### Medium Priority

4. **Conversation store is in-memory**
   `conversation_store.py` persists to a JSON file every 5 minutes. A crash within the 5-minute window loses messages. For hackathon, this is acceptable. Production would need a database.

5. **No rate limiting on iMessage webhook**
   The `/api/v1/imessage/webhook` endpoint has no rate limiting. A flood of messages would spawn many LangGraph invocations concurrently.

6. **Screenshot cache unbounded**
   `tab_manager.py` screenshot cache grows with open tabs but has no max-size eviction. With many tabs open for hours, memory could grow. Low risk for hackathon demo.

### Low Priority

7. **Intent classification accuracy unknown**
   The MiniMax intent classifier prompt is designed but untested with real messages. May need prompt tuning after testing (C2 task).

8. **Task-clustered layout untested with real multi-task swarms**
   The angular sector layout logic is implemented but hasn't been tested with 2+ concurrent tasks spawning workers. Visual verification pending.

9. **build_chat_graph() not implemented as separate graph**
   Instead of a separate parallel chat graph, chat-while-swarm functionality is integrated directly into the `chat_respond` node of `build_hivemind_graph()`. This is simpler but means chat goes through the full Dispatcher graph. For hackathon this is fine.

---

## Architecture Decisions

### What changed from original plan

| Original Plan | Actual Implementation | Why |
|---------------|----------------------|-----|
| Separate `build_chat_graph()` | Chat integrated into `build_hivemind_graph()` | Simpler, same behavior — `chat_respond` node checks swarm status |
| `_assignment_lock` separate from `_tabs_lock` | Merged into single `_tabs_lock` | Assignments modify `_tabs` dict, single lock prevents deadlocks |
| MiniMax-M2.7 model | Configurable via `MINIMAX_MODEL` env var (default: MiniMax-M1) | Flexibility for different MiniMax models |
| iMessage panel in frontend | No iMessage UI in dashboard | Per team decision — iMessage is purely backend, users interact via iPhone |

---

## Environment Checklist (Pre-Demo)

```bash
# 1. Set API keys in backend/.env
GEMINI_API_KEY=...
MINIMAX_API_KEY=...        # Required for intent classification + chat
IMESSAGE_BRIDGE_URL=http://localhost:3001
IMESSAGE_ENABLED=true

# 2. Start Chrome with CDP
chrome --remote-debugging-port=9222 --remote-allow-origins=*

# 3. Start backend (MUST restart to pick up new routes)
cd backend && uvicorn main:app --reload --port 8080

# 4. Start frontend
cd frontend && npm run dev

# 5. Start iMessage bridge (macOS only, Person B)
cd backend/imessage-bridge && npm start

# 6. Open some tabs in Chrome for the hex canvas demo
# 7. Navigate to http://localhost:5173
```

---

## Test Commands

```bash
# Verify backend routes load
cd backend && python -c "from main import app; print(len(app.routes), 'routes')"

# Run Playwright E2E tests
python tests/e2e_playwright.py

# Test iMessage webhook (after backend restart)
curl -X POST http://localhost:8080/api/v1/imessage/webhook \
  -H "Content-Type: application/json" \
  -d '{"text":"Search Amazon for AirPods","from_phone":"+15551234567","to_phone":"+15559876543","message_id":"test-001","timestamp":"2026-03-28T12:00:00"}'

# Test iMessage health
curl http://localhost:8080/api/v1/imessage/health

# Run unit tests
cd backend && python -m pytest tests/ -v
```
