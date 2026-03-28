# Team Task Board

## Quick Links
- [Full Implementation Plan](docs/PLAN.md)
- [Backend](backend/) | [Frontend](frontend/)

## Team Roles

| Person | Role | Focus Area |
|--------|------|------------|
| **Person A** | Website Redesign + Demo + Pitch | Non-tech. Redesign the entire dashboard UI, build pitch deck, prepare demo |
| **Person B** | iMessage Kit + Bug Fixes | Photon iMessage Kit (TypeScript sidecar), frontend event wiring, existing bug fixes |
| **Person C** | Backend Logic | LangGraph redesign, MiniMax integration |
| **Person D** | Backend Logic | API routes, sender service, conversation store |

---

## Task Board

### Person A -- Website Redesign + Demo + Pitch

Person A owns the entire visual experience: redesign the dashboard, build the iMessage panel UI, create the pitch, and prep the demo.

- [ ] **A1** Redesign dashboard layout -- modernize hex canvas, improve colors/spacing/typography (4h) `P0`
- [ ] **A2** Design + build iMessage panel UI (conversation bubbles, intent badges, status indicators) (3h) `P0`
- [ ] **A3** Redesign CommandBar, EventFeed, and AgentLogPanel for cleaner look (3h) `P0`
- [ ] **A4** Add landing/splash page or onboarding screen for hackathon demo (2h) `P1`
- [ ] **A5** Build pitch deck -- "Text your AI" narrative, architecture diagrams, market positioning (4h) `P0`
- [ ] **A6** Prepare demo script + talking points (3-min flow) (2h) `P1`
- [ ] **A7** Record backup demo video (1h) `P2` -- blocked by working demo
- [ ] **A8** Polish animations, transitions, loading states across the app (2h) `P1` -- blocked by A1-A3

### Person B -- iMessage Kit Integration + Bug Fixes

Person B owns the Photon iMessage Kit sidecar (TypeScript/Node.js on macOS), wires iMessage events into the frontend, and fixes existing backend bugs.

- [ ] **B1** Set up `backend/imessage-bridge/` Node.js project + install Photon SDK (1h) `P0`
- [ ] **B2** Implement Photon polling + webhook POST to FastAPI on new message (3h) `P0` -- blocked by B1
- [ ] **B3** Implement `/send` endpoint for outbound iMessages (text + file attachments) (2h) `P0` -- blocked by B1
- [ ] **B4** Wire WebSocket iMessage events in frontend store (`useMindStore.ts`, `useWebSocket.ts`) (2h) `P1` -- blocked by D3
- [ ] **B5** Add iMessage panel toggle to `App.tsx` + 'M' keyboard shortcut (1h) `P1` -- blocked by A2
- [ ] **B6** Fix `worker.py` agent_logs memory leak (~L282) (0.5h) `P1`
- [ ] **B7** Fix `tab_manager.py` screenshot cache bloat (0.5h) `P1`
- [ ] **B8** Fix `queen.py` subtask dependency DAG execution (~L276-312) (2h) `P1`
- [ ] **B9** End-to-end test: iMessage -> dashboard -> swarm runs -> reply arrives (2h) `P1` -- blocked by all above

### Person C -- LangGraph + MiniMax (Backend Logic)

- [ ] **C1** Create `backend/services/minimax_client.py` using OpenAI SDK + MiniMax base_url (2h) `P0`
- [ ] **C2** Test intent classification with 10+ sample messages (1h) `P0` -- blocked by C1
- [ ] **C3** Extend `backend/mind/state.py` with `HiveMindState` (1h) `P0`
- [ ] **C4** Rewrite `backend/mind/graph.py` with LangGraph intent routing flow (4h) `P0` -- blocked by C1, C3
- [ ] **C5** Implement parallel chat graph `build_chat_graph()` (2h) `P1` -- blocked by C4
- [ ] **C6** Wire graph invocation from `routers/imessage.py` webhook (1h) `P1` -- blocked by C4, D1

### Person D -- API Routes + Sender Services (Backend Logic)

- [ ] **D1** Create `backend/routers/imessage.py` (webhook + send + conversations endpoints) (2h) `P0`
- [ ] **D2** Create `backend/services/imessage_sender.py` (HTTP client to bridge /send) (2h) `P0`
- [ ] **D3** Create `backend/services/conversation_store.py` + update config/events/main.py (2h) `P0`
- [ ] **D4** Implement iMessage status updates during swarm execution (2h) `P1` -- blocked by D2, C4
- [ ] **D5** Screenshot-as-iMessage-attachment feature (send tab screenshots back) (1h) `P1` -- blocked by D2
- [ ] **D6** Add MiniMax fallback-to-Gemini wrapper in minimax_client.py (1h) `P1` -- blocked by C1

---

## Critical Path

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

## Environment Setup

Each team member needs:

```bash
# Clone
git clone https://github.com/Kvndoshi/uschacks.git
cd uschacks

# Backend (Persons B, C, D)
cd backend
pip install -r requirements.txt
playwright install chromium
cp .env.template .env   # Fill in API keys

# Frontend (Persons A, B)
cd ../frontend
npm install

# iMessage Bridge (Person B only, macOS required)
cd ../backend/imessage-bridge
npm install
```

### Required API Keys (in `backend/.env`)

```
GEMINI_API_KEY=...          # Google AI Studio
MINIMAX_API_KEY=...         # platform.minimax.io
SUPERMEMORY_API_KEY=...     # Optional
ELEVENLABS_API_KEY=...      # Optional
IMESSAGE_BRIDGE_URL=http://localhost:3001
IMESSAGE_ENABLED=true
```

### Running

```bash
# Terminal 1: Chrome with CDP
chrome --remote-debugging-port=9222 --remote-allow-origins=*

# Terminal 2: Backend
cd backend && python run.py

# Terminal 3: Frontend
cd frontend && npm run dev

# Terminal 4: iMessage Bridge (macOS only)
cd backend/imessage-bridge && npm start
```

---

## Model Usage

| Role | Model | Cost |
|------|-------|------|
| Intent Classifier | MiniMax-M2.7 | $0.30/M input |
| Quick Answer | MiniMax-M2.7 | $0.30/M input |
| Chat Agent | MiniMax-M2.7 | $0.30/M input |
| Result Synthesizer | MiniMax-M2.7 | $0.30/M input |
| Queen Decomposer | Gemini 3.1 Pro | Existing |
| Worker Agents | Gemini 3 Flash | Existing |
