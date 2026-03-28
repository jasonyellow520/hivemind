import asyncio
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from services.websocket_manager import manager as ws_manager
from models.events import WSEvent, EventType
from routers import tasks, hitl, agents, tabs, chat, screencast, memory, voice, imessage, input

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(levelname)s: %(message)s")
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Mind backend starting...")
    # Log event loop type (Windows: need ProactorEventLoop for subprocess/browser-use)
    try:
        loop = asyncio.get_running_loop()
        logger.info("Event loop: %s", type(loop).__name__)
    except RuntimeError:
        pass

    # Log configured AI models on startup
    try:
        from config import QUEEN_MODEL, WORKER_MODEL, CHAT_MODEL, GEMINI_API_KEY
        logger.info(
            "AI models — Queen: %s | Worker: %s | Chat: %s | Gemini key: %s",
            QUEEN_MODEL,
            WORKER_MODEL,
            CHAT_MODEL,
            "configured" if GEMINI_API_KEY else "NOT SET",
        )
        logger.info("Voice: Gemini Live with ElevenLabs TTS fallback")
    except Exception:
        pass

    await ws_manager.start_heartbeat(interval=10)

    # Initialize conversation store
    from services.conversation_store import conversation_store
    await conversation_store.start()

    from services.tab_manager import tab_manager

    async def _chrome_sync_loop():
        """Poll Chrome every 2s; push TABS_UPDATE only when tabs change.
        Also injects chatbar into newly discovered tabs (fire-and-forget, non-blocking)."""
        prev_snapshot = ""
        prev_tab_ids: set[str] = set()
        while True:
            await asyncio.sleep(2)
            try:
                tabs_list = await tab_manager.scan_tabs()
                # Snapshot: tab IDs + URLs so we detect open/close/navigate
                snapshot = "|".join(f"{t.tab_id}:{t.url}" for t in tabs_list)
                if snapshot != prev_snapshot:
                    prev_snapshot = snapshot
                    await ws_manager.broadcast(WSEvent(
                        type=EventType.TABS_UPDATE,
                        data={
                            "tabs": [t.model_dump() for t in tabs_list],
                            "cdp_connected": tab_manager.is_cdp_connected(),
                        },
                    ))

                # Chatbar injection: inject into newly seen tabs only.
                # Uses a short timeout and doesn't block the sync loop.
                current_tab_ids = {t.tab_id for t in tabs_list}
                new_tab_ids = current_tab_ids - prev_tab_ids
                prev_tab_ids = current_tab_ids
                for tab_id in new_tab_ids:
                    if tab_id not in tab_manager._chatbar_injected:
                        # Fire-and-forget with timeout guard
                        asyncio.create_task(_safe_inject_chatbar(tab_id))
            except Exception as e:
                logger.debug("Chrome sync: %s", e)

    async def _safe_inject_chatbar(tab_id: str):
        """Inject chatbar into a tab with a timeout, silently skipping on error."""
        try:
            await asyncio.wait_for(tab_manager.inject_chatbar(tab_id), timeout=4.0)
        except Exception:
            pass

    sync_task = asyncio.create_task(_chrome_sync_loop())
    screenshot_task = asyncio.create_task(tab_manager.start_screenshot_loop())

    yield

    sync_task.cancel()
    screenshot_task.cancel()
    logger.info("Mind backend shutting down...")
    await ws_manager.stop_heartbeat()
    from services.browser_manager import browser_manager
    await browser_manager.stop_all()
    await tab_manager.close()

    # Stop conversation store
    from services.conversation_store import conversation_store
    await conversation_store.stop()


app = FastAPI(
    title="Mindd - Multi-Agent Swarm Dashboard",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(tasks.router)
app.include_router(hitl.router)
app.include_router(agents.router)
app.include_router(tabs.router)
app.include_router(chat.router)
app.include_router(screencast.router)
app.include_router(memory.router)
app.include_router(voice.router)
app.include_router(imessage.router)
app.include_router(input.router)


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await ws_manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            logger.debug(f"WS received: {data}")
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)


@app.websocket("/ws/voice")
async def voice_websocket(websocket: WebSocket):
    """Proxy to the voice router's WebSocket handler."""
    await voice.voice_ws(websocket)


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "connections": len(ws_manager.active_connections),
    }
