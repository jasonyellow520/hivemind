# HIVEMIND v2 — Remaining Work

> For completed work, see [COMPLETION.md](COMPLETION.md)

---

## What's Left

### Person A — Dashboard Redesign + Demo + Pitch

Redesigns the swarm dashboard in **Stitch** (Google design tool). Independent from all backend work.

- [ ] **A1** Redesign dashboard layout in Stitch — hex canvas, page structure, spacing, color palette (4h) `P0`
- [ ] **A2** Redesign CommandBar, EventFeed ticker, AgentLogPanel for cleaner look (3h) `P0`
- [ ] **A3** Redesign QueenNode, WorkerNode, TabNode hex visuals (shapes, glows, status indicators) (3h) `P0`
- [ ] **A4** Add landing/hero page or onboarding screen for hackathon demo (2h) `P1`
- [ ] **A5** Build pitch deck — "Text your AI" narrative, architecture diagrams, market positioning (4h) `P0`
- [ ] **A6** Prepare demo script + talking points (3-min flow) (2h) `P1`
- [ ] **A7** Record backup demo video (1h) `P2` — needs working demo
- [ ] **A8** Apply Stitch designs to React components (with help from others if needed) (3h) `P1` — after A1-A3

### Person B — iMessage Bridge (Photon SDK, macOS)

The Node.js sidecar that bridges iPhone iMessage to the FastAPI backend. All backend endpoints are ready — Person B just needs to build the bridge itself.

- [ ] **B1** Set up `backend/imessage-bridge/` Node.js project + install Photon SDK (1h) `P0`
- [ ] **B2** Implement Photon polling + webhook POST to `/api/v1/imessage/webhook` (3h) `P0` — after B1
- [ ] **B3** Implement `/send` endpoint for outbound iMessages (text + files) (2h) `P0` — after B1
- [ ] **B7** End-to-end test: iMessage → swarm runs → reply arrives on phone (2h) `P1` — after B2, B3

### Person C — Testing

- [ ] **C2** Test MiniMax intent classification with 10+ sample messages (1h) `P0` — needs `MINIMAX_API_KEY` in `.env`

### Integration & Polish

- [ ] **I1** Test full iMessage loop: webhook → Dispatcher → Queen → Workers → iMessage reply (2h) — after B1-B3
- [ ] **I2** Stress test concurrent iMessages while swarm is running (1h)
- [ ] **I3** Tune MiniMax prompts based on C2 classification test results (1h) — after C2

---

## Critical Path to Demo

```
B1 (bridge setup) → B2 (polling) → B3 (send) → B7 (e2e test) → DEMO
                                                    |
A1-A3 (Stitch redesign) → A8 (apply to React) ----+→ A5 (pitch) → DEMO
```

Everything else (backend endpoints, LangGraph, MiniMax client, conversation store, DAG execution, dashboard protection) is **done**.

---

## Known Issues

1. **Backend port**: `run.py` starts on port **8081** (not 8080). Frontend Vite proxy must match.
2. **iMessage bridge not built**: `imessage_sender.py` HTTP client is ready, but the bridge at `localhost:3001` doesn't exist yet.
3. **MiniMax API key**: Not tested. The `llm_fallback.py` falls back to Gemini if MiniMax is unavailable.
4. **Conversation store is in-memory**: Persists to JSON every 5 min. Crash within window loses messages.
5. **Vite WS proxy errors on startup**: `ECONNREFUSED` errors appear when frontend starts before backend. Harmless — reconnects automatically once backend is up. Using `python run.py` from root starts both together.

---

## Quick Start

```bash
# Single command (both backend + frontend):
python run.py

# Or separately:
# Terminal 1: Chrome
chrome --remote-debugging-port=9222 --remote-allow-origins=*
# Terminal 2: Backend
cd backend && python run.py
# Terminal 3: Frontend
cd frontend && npm run dev
# Terminal 4: iMessage Bridge (macOS only, Person B)
cd backend/imessage-bridge && npm start
```

### Required API Keys (`backend/.env`)

```
GEMINI_API_KEY=...
MINIMAX_API_KEY=...
IMESSAGE_BRIDGE_URL=http://localhost:3001
IMESSAGE_ENABLED=true
```
