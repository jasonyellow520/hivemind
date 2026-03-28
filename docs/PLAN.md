# HIVEMIND v2: iMessage-Controlled AI Browser Swarm

## Context

Hackathon project (Productivity & Life Hacks track). The team already has a working multi-agent browser orchestration system ("HIVEMIND" at `mistralhackathon/`) where a Queen agent (Gemini 3.1 Pro) decomposes tasks and dispatches Worker agents (Gemini 3 Flash) that each control a real Chrome tab via CDP. The goal is to add **iMessage as a command interface** using Photon iMessage Kit, integrate **MiniMax-M2.7** for all conversational AI, redesign the orchestration with **LangGraph**, and fix existing bugs.

**Pitch**: "Text your AI. No app install needed --- just iMessage. One message deploys a swarm of browser agents that shop, research, and compare for you."

---

## System Architecture

```
  iPhone (iMessage)
       |
       v
+----------------------------------------------+
|  macOS Machine                                |
|                                               |
|  iMessage Bridge       FastAPI Backend        |
|  (Node.js :3001)  <--> (:8080)               |
|  Photon iMessage Kit   LangGraph Router       |
|  - polls chat.db       - intent classifier    |
|  - webhooks to FastAPI  - Queen/swarm path     |
|  - sends via AppleScript- chat agent path     |
|                                               |
|  Chrome CDP (:9222)    React Frontend (:5173) |
|  - Worker agents        - Hex hive canvas     |
|  - tab control          - iMessage panel      |
+----------------------------------------------+
```

### Message Flow

```
iMessage received
    --> Photon SDK polls chat.db (2s)
    --> POST /api/v1/imessage/webhook (FastAPI)
    --> LangGraph: classify_intent (MiniMax-M2.7)
        |
        |--> "information" --> quick_answer (MiniMax) --> reply via iMessage
        |
        |--> "browser_task" --> Queen decompose (Gemini Pro)
                --> dispatch Workers (Gemini Flash)
                --> status updates via iMessage ("Agent 1 on Amazon...")
                --> synthesize results (MiniMax)
                --> reply via iMessage (text + screenshots)

While swarm runs: new messages --> parallel chat agent (MiniMax) --> instant replies
```

---

## Model Allocation

| Role | Model | Why |
|---|---|---|
| Intent Classifier | **MiniMax-M2.7** | Cheap ($0.30/M), fast, strong classification |
| Quick Answer Agent | **MiniMax-M2.7** | Conversational, handles info queries |
| Parallel Chat Agent | **MiniMax-M2.7** | Always-on while swarm busy, low cost |
| Result Synthesizer | **MiniMax-M2.7** | Summarizes agent outputs for iMessage |
| Status Updates | **MiniMax-M2.7** | Quick 1-sentence progress messages |
| Queen Decomposer | **Gemini 3.1 Pro** | Complex planning, existing & proven |
| Worker Agents | **Gemini 3 Flash** | Browser control needs speed + vision |
| Queen Guidance | **Gemini 3.1 Pro** | Worker help queries, existing |

**MiniMax**: 5 integration points (all iMessage-facing). **Gemini**: 3 (all browser-facing). Best of both worlds.

---

## LangGraph Design

### Main Graph (`build_hivemind_graph()`)

**State: `HiveMindState`** extends existing `MindState`:
```
+ message_id, sender_id, message_text, conversation_id
+ intent ("information" | "browser_task" | "status_query" | "followup")
+ intent_confidence
+ response_text, response_attachments
+ status_updates_sent
```

**Nodes:**
1. `receive_message` -- normalize input from webhook
2. `classify_intent` -- MiniMax-M2.7 classifies intent
3. `quick_answer` -- MiniMax answers info queries directly
4. `queen_plan` -- existing Gemini decomposition (reuse `queen.execute_task()` internals)
5. `dispatch_workers` -- existing worker dispatch via `asyncio.gather`
6. `monitor_workers` -- poll worker status, send iMessage progress updates
7. `aggregate` -- collect results
8. `synthesize_results` -- MiniMax creates user-friendly summary
9. `format_reply` -- format for iMessage (text + optional screenshot attachments)
10. `send_imessage_reply` -- call bridge's /send endpoint

**Routing:**
- After `classify_intent`: conditional edge based on `state["intent"]`
- `"information"` -> `quick_answer` -> `format_reply` -> `send_imessage_reply`
- `"browser_task"` -> `queen_plan` -> `dispatch_workers` -> `monitor_workers` -> `aggregate` -> `synthesize_results` -> `format_reply` -> `send_imessage_reply`

### Parallel Chat Graph (`build_chat_graph()`)
Separate graph for handling messages while swarm is running:
1. `receive_chat` -- ingest message + check if swarm active
2. `check_status` -- if user asks "how's it going?", inject live agent status
3. `answer` -- MiniMax chat with conversation history
4. `send_reply` -- reply via iMessage

**Concurrency**: Webhook checks `conversation_store` for active swarm tasks. If swarm running AND new message is info/status query, dispatch to chat graph instead.

---

## New Files to Create

### 1. iMessage Bridge Sidecar
**`backend/imessage-bridge/`** (TypeScript, Node.js)

| File | Purpose |
|---|---|
| `package.json` | deps: `@photon-ai/imessage-kit`, `express`, `axios` |
| `src/index.ts` | Init Photon SDK, webhook to FastAPI, expose `/send` + `/health` |
| `src/config.ts` | `WEBHOOK_URL`, `BRIDGE_PORT=3001`, `POLL_INTERVAL=2000` |

### 2. Backend - New Files

| File | Purpose |
|---|---|
| `routers/imessage.py` | `POST /webhook`, `POST /send`, `GET /conversations`, `GET /status` |
| `services/minimax_client.py` | OpenAI SDK + MiniMax base_url. Functions: `classify_intent()`, `quick_answer()`, `synthesize_results()`, `chat_with_context()`. Fallback to Gemini if MiniMax down. |
| `services/imessage_sender.py` | `send_text()`, `send_file()`, `send_status_update()`. Calls bridge HTTP. Retry + queue. |
| `services/conversation_store.py` | In-memory dict by sender_id. Message history (20), active task IDs, timestamps. Asyncio locks. |

### 3. Frontend - New Files

| File | Purpose |
|---|---|
| `components/iMessage/iMessagePanel.tsx` | Side panel: conversation list, message bubbles, intent badges |
| `components/iMessage/ConversationBubble.tsx` | Blue (incoming) / Green (outgoing) message bubbles |

---

## Files to Modify

### Backend

| File | Change |
|---|---|
| `mind/graph.py` | **REWRITE**: New `build_hivemind_graph()` with intent routing. Keep calling existing `queen.execute_task()` internals from graph nodes. |
| `mind/state.py` | Add `HiveMindState` TypedDict. Keep existing `MindState`/`WorkerState`. |
| `config.py` | Add `MINIMAX_API_KEY`, `MINIMAX_MODEL`, `IMESSAGE_BRIDGE_URL`, `IMESSAGE_ENABLED` |
| `main.py` | Include `routers.imessage`, bridge health-check in lifespan |
| `models/events.py` | Add `IMESSAGE_RECEIVED`, `IMESSAGE_SENT`, `IMESSAGE_STATUS` event types |
| `.env.template` | Add MiniMax + iMessage bridge env vars |
| `requirements.txt` | Already has `openai` -- no new deps needed |

### Backend Bug Fixes

| File | Bug | Fix |
|---|---|---|
| `mind/worker.py` ~L282 | Agent logs memory leak: `call_later(60)` unreliable, no max-size guard | Add `len(agent_logs) > 100` pruning + use `asyncio.get_running_loop().call_later()` |
| `services/tab_manager.py` | Screenshot cache grows unbounded | LRU eviction: only keep screenshots for open tabs, remove on tab close |
| `mind/queen.py` ~L276-312 | Subtask dependency execution broken: runs ALL dependent after ALL independent | Build proper DAG, execute in topological order, pass completed results to dependents |

### Frontend

| File | Change |
|---|---|
| `store/useMindStore.ts` | Add `iMessageConversations`, `iMessageEnabled`, actions: `addIMessage`, `updateIMessageStatus` |
| `store/useWebSocket.ts` | Handle `IMESSAGE_RECEIVED`, `IMESSAGE_SENT`, `IMESSAGE_STATUS` events |
| `types/mind.types.ts` | Add `iMessageConversation`, `iMessageMessage` interfaces |
| `App.tsx` | Add iMessage panel toggle (phone icon), 'M' keyboard shortcut |

---

## Team Assignments

### Person A (Non-tech) -- Website Redesign + Demo + Pitch
Person A owns the entire user-facing experience: redesigning the dashboard UI, building the pitch, and preparing the demo.

| # | Task | Effort | Blocked By | Priority |
|---|---|---|---|---|
| A1 | Redesign dashboard layout -- modernize the hex canvas, improve colors/spacing/typography | 4h | -- | P0 |
| A2 | Design + build the iMessage panel UI (conversation bubbles, intent badges, status indicators) | 3h | -- | P0 |
| A3 | Redesign the CommandBar, EventFeed, and AgentLogPanel for cleaner look | 3h | -- | P0 |
| A4 | Add a landing/splash page or onboarding screen for the hackathon demo | 2h | -- | P1 |
| A5 | Build pitch deck -- "Text your AI" narrative, architecture diagrams, market positioning | 4h | -- | P0 |
| A6 | Prepare demo script + talking points (3-min flow) | 2h | -- | P1 |
| A7 | Record backup demo video | 1h | Working demo | P2 |
| A8 | Polish animations, transitions, loading states across the app | 2h | A1-A3 | P1 |

### Person B -- iMessage Kit Integration + Bug Fixes
Person B owns the Photon iMessage Kit sidecar, the frontend wiring for iMessage events, and fixing existing bugs.

| # | Task | Effort | Blocked By | Priority |
|---|---|---|---|---|
| B1 | Set up `backend/imessage-bridge/` Node.js project + install Photon SDK | 1h | -- | P0 |
| B2 | Implement Photon polling + webhook POST to FastAPI on new message | 3h | B1 | P0 |
| B3 | Implement `/send` endpoint for outbound iMessages (text + file attachments) | 2h | B1 | P0 |
| B4 | Wire WebSocket iMessage events in frontend store (`useMindStore.ts`, `useWebSocket.ts`) | 2h | D3 | P1 |
| B5 | Add iMessage panel toggle to `App.tsx` + 'M' keyboard shortcut | 1h | A2 | P1 |
| B6 | Fix `worker.py` agent_logs memory leak (~L282) | 0.5h | -- | P1 |
| B7 | Fix `tab_manager.py` screenshot cache bloat | 0.5h | -- | P1 |
| B8 | Fix `queen.py` subtask dependency DAG execution (~L276-312) | 2h | -- | P1 |
| B9 | End-to-end test: send iMessage -> dashboard shows it -> swarm runs -> reply arrives | 2h | All above | P1 |

### Person C -- LangGraph + MiniMax (Backend Logic)
| # | Task | Effort | Blocked By | Priority |
|---|---|---|---|---|
| C1 | Create `services/minimax_client.py` (OpenAI SDK + MiniMax base_url) | 2h | API key | P0 |
| C2 | Test intent classification accuracy (10+ sample messages) | 1h | C1 | P0 |
| C3 | Extend `mind/state.py` with `HiveMindState` | 1h | -- | P0 |
| C4 | Rewrite `mind/graph.py` with full LangGraph intent routing flow | 4h | C1, C3 | P0 |
| C5 | Implement parallel chat graph (`build_chat_graph()`) | 2h | C4 | P1 |
| C6 | Wire graph invocation from `routers/imessage.py` webhook handler | 1h | C4, D1 | P1 |

### Person D -- API Routes + Sender Services (Backend Logic)
| # | Task | Effort | Blocked By | Priority |
|---|---|---|---|---|
| D1 | Create `routers/imessage.py` (webhook + send + conversations endpoints) | 2h | -- | P0 |
| D2 | Create `services/imessage_sender.py` (HTTP client to bridge's /send) | 2h | -- | P0 |
| D3 | Create `services/conversation_store.py` + update config/events/main.py | 2h | -- | P0 |
| D4 | Implement iMessage status updates during swarm execution | 2h | D2, C4 | P1 |
| D5 | Screenshot-as-iMessage-attachment feature (send tab screenshots back) | 1h | D2 | P1 |
| D6 | Add MiniMax fallback-to-Gemini wrapper in minimax_client.py | 1h | C1 | P1 |

### Critical Path
```
C1 (minimax client) --> C2 (test) --> C4 (graph rewrite) --+
                                                            |
D1 (router) + D2 (sender) + D3 (config) ------------------+--> C6 (wire) --> B9 (e2e)
                                                            |
B1 (bridge) --> B2 (webhook) --> B3 (/send) ---------------+
                                                            |
A1+A2+A3 (redesign) --> A5 (pitch) --> A6 (demo script) ---+--> DEMO
```

**Day 1 parallel starts**: C1 + D1 + D2 + D3 + B1 + A1 -- all independent, everyone productive immediately.

---

## Demo Script (3 minutes)

**[0:00-0:30] Hook**
- Show phone. Send iMessage: *"Hey HIVEMIND, compare AirPods Pro prices on Amazon vs Best Buy"*
- Dashboard lights up -- iMessage panel shows incoming message, intent badge: "SWARM"

**[0:30-1:00] Swarm Deployment**
- Queen decomposes: 2 agents spawn on hex grid
- Phone gets iMessage: *"Deploying 2 agents to compare prices..."*
- Chrome tabs open live on screen

**[1:00-1:45] Concurrent Chat (the "wow" moment)**
- While swarm runs, send another iMessage: *"What's the battery life of AirPods Pro 2?"*
- Phone gets instant MiniMax answer within 3 seconds -- WHILE swarm agents are still navigating
- Dashboard shows both: swarm progress + parallel chat exchange

**[1:45-2:15] Results Delivered**
- Swarm completes. Phone receives:
  > *Amazon: $189.99 (Prime eligible)*
  > *Best Buy: $199.99 (open box $179.99)*
  > *Best deal: Best Buy open-box saves $10*

**[2:15-2:45] Architecture Slide**
- "MiniMax handles all conversations at $0.30/M tokens"
- "Gemini handles browser control where vision matters"
- "LangGraph routes everything as a state machine"
- "No app install. Just iMessage."

**[2:45-3:00] Close**
- "HIVEMIND: text your AI, command a swarm."

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| macOS-only for iMessage Kit | Person B secures Mac on Day 1 (has one). Backup: demo from web UI |
| Photon SDK bugs with chat.db | Test early. Fallback: direct SQLite query + `osascript` |
| MiniMax API downtime | `minimax_client.py` has `_fallback_to_gemini()` wrapper |
| LangGraph rewrite breaks existing flow | Rewrite incrementally. Graph nodes call existing `execute_task()` internals, don't rewrite worker/browser plumbing |
| Demo latency (swarm takes 30-60s) | Pre-warm Chrome tabs. Use simple 2-agent task. Chat agent fills dead time |
| macOS security blocks AppleScript send | Pre-approve Accessibility + Full Disk Access + Automation before demo |
| Race conditions from concurrent iMessages | `conversation_store.py` uses asyncio locks. One active swarm per conversation. |

---

## Verification Plan

1. **Unit test MiniMax client**: Call `classify_intent()` with 10 sample messages, verify accuracy > 80%
2. **Unit test iMessage bridge**: Send test message via `/send`, verify it arrives on phone
3. **Integration test webhook flow**: Send iMessage -> verify webhook fires -> verify LangGraph invocation
4. **Integration test full loop**: Send "search Amazon for X" via iMessage -> verify agents spawn -> verify reply arrives
5. **Concurrent chat test**: Start a swarm task, immediately send info query -> verify both complete
6. **Frontend test**: Verify iMessage panel shows conversations, intent badges, and real-time updates
7. **Bug fix verification**: Run 5+ tasks with 3+ subtasks each, verify no agent_logs leak or screenshot bloat
