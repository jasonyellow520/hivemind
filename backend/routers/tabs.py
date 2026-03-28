import base64
import logging
from fastapi import APIRouter, BackgroundTasks, HTTPException, Response
from pydantic import BaseModel
from typing import Optional
from services.tab_manager import tab_manager, BrowserTabInfo
from services.websocket_manager import manager as ws_manager
from models.events import WSEvent, EventType

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/tabs", tags=["tabs"])


class TabInstructionRequest(BaseModel):
    tab_id: str
    instruction: str


class TabInstructionsSubmit(BaseModel):
    instructions: list[TabInstructionRequest]
    global_task: str = ""


class OpenTabRequest(BaseModel):
    url: str = "about:blank"


class NavigateRequest(BaseModel):
    url: str


async def _broadcast_tabs():
    """Broadcast current tab state to all connected clients."""
    tab_dicts = [t.model_dump() for t in await tab_manager.get_all_tabs()]
    await ws_manager.broadcast(WSEvent(
        type=EventType.TABS_UPDATE,
        data={
            "tabs": tab_dicts,
            "cdp_connected": tab_manager.is_cdp_connected(),
        },
    ))
    return tab_dicts


@router.get("/scan")
async def scan_tabs():
    """Scan the managed/connected browser for all open tabs."""
    try:
        tabs = await tab_manager.scan_tabs()
        tab_dicts = [t.model_dump() for t in tabs]
        await ws_manager.broadcast(WSEvent(
            type=EventType.TABS_UPDATE,
            data={
                "tabs": tab_dicts,
                "cdp_connected": tab_manager.is_cdp_connected(),
            },
        ))
        return {
            "tabs": tab_dicts,
            "cdp_connected": tab_manager.is_cdp_connected(),
            "count": len(tab_dicts),
        }
    except Exception as e:
        logger.error(f"Tab scan failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/")
async def list_tabs():
    """Get current in-memory tab list (no re-scan)."""
    tabs = await tab_manager.get_all_tabs()
    return {
        "tabs": [t.model_dump() for t in tabs],
        "cdp_connected": tab_manager.is_cdp_connected(),
    }


@router.post("/open")
async def open_tab(req: OpenTabRequest):
    """Open a new tab in the managed browser."""
    tab = await tab_manager.open_tab(req.url)
    await _broadcast_tabs()
    return {"tab": tab.model_dump()}


@router.delete("/{tab_id}")
async def close_tab(tab_id: str):
    """Close a specific tab and kill any assigned agent."""
    # Kill the agent assigned to this tab (if any)
    try:
        tab = await tab_manager.get_tab(tab_id)
        if tab and tab.assigned_agent_id:
            from services.browser_manager import browser_manager
            await browser_manager.kill_agent(tab.assigned_agent_id)
            from models import events as evt
            await ws_manager.broadcast(evt.agent_failed(
                agent_id=tab.assigned_agent_id,
                error="Tab closed",
            ))
    except Exception as e:
        logger.warning("Failed to kill agent for closed tab %s: %s", tab_id, e)

    success = await tab_manager.close_tab(tab_id)
    if not success:
        raise HTTPException(status_code=404, detail=f"Tab {tab_id} not found or already closed")
    await _broadcast_tabs()
    return {"status": "closed", "tab_id": tab_id}


@router.post("/{tab_id}/navigate")
async def navigate_tab(tab_id: str, req: NavigateRequest):
    """Navigate a specific tab to a URL."""
    success = await tab_manager.navigate_tab(tab_id, req.url)
    if not success:
        raise HTTPException(status_code=404, detail=f"Tab {tab_id} not found")
    await _broadcast_tabs()
    return {"status": "navigated", "tab_id": tab_id, "url": req.url}


@router.get("/{tab_id}/screenshot")
async def screenshot_tab(tab_id: str):
    """Get a JPEG screenshot of a specific tab (base64 encoded).
    Returns empty screenshot_b64 if not yet cached (background tabs can't be captured)."""
    img_bytes = await tab_manager.get_tab_screenshot(tab_id)
    if not img_bytes:
        # Try one rescan in case the tab list is stale
        await tab_manager.scan_tabs()
        img_bytes = await tab_manager.get_tab_screenshot(tab_id)
    if not img_bytes:
        # Return empty rather than 404 — background tabs can't be screenshotted
        return {"tab_id": tab_id, "screenshot_b64": "", "type": "image/jpeg"}
    b64 = base64.b64encode(img_bytes).decode()
    return {"tab_id": tab_id, "screenshot_b64": b64, "type": "image/jpeg"}


@router.post("/instruct")
async def set_tab_instruction(req: TabInstructionRequest):
    """Set instruction for a specific tab."""
    await tab_manager.set_instruction(req.tab_id, req.instruction)
    await _broadcast_tabs()
    return {"status": "ok", "tab_id": req.tab_id}


@router.post("/execute")
async def execute_tab_instructions(req: TabInstructionsSubmit, background_tasks: BackgroundTasks):
    """Execute instructions on tabs with instructions, in parallel."""
    for instr in req.instructions:
        await tab_manager.set_instruction(instr.tab_id, instr.instruction)

    tabs_with_instr = await tab_manager.get_tabs_with_instructions()

    async def _run():
        from mind.queen import execute_tab_tasks
        try:
            logger.info("Starting tab execution for %d tabs", len(tabs_with_instr))
            await execute_tab_tasks(tabs_with_instr, req.global_task)
            logger.info("Tab execution completed")
        except Exception as e:
            logger.error("Tab execution failed: %s", e, exc_info=True)
            from models.events import WSEvent, EventType
            await ws_manager.broadcast(WSEvent(
                type=EventType.TASK_COMPLETE,
                data={"task_id": "error", "result": f"Execution failed: {e}"},
            ))

    background_tasks.add_task(_run)
    return {"status": "executing", "tab_count": len(tabs_with_instr)}


class InputEventRequest(BaseModel):
    action: str  # click, type, keydown, scroll
    x: float = 0
    y: float = 0
    text: str = ""
    key: str = ""
    delta_x: float = 0
    delta_y: float = 0


@router.post("/{tab_id}/input")
async def dispatch_input(tab_id: str, req: InputEventRequest):
    """Forward mouse/keyboard input to a tab via CDP."""
    ok = await tab_manager.dispatch_input(
        tab_id, req.action,
        x=req.x, y=req.y, text=req.text, key=req.key,
        delta_x=req.delta_x, delta_y=req.delta_y,
    )
    if not ok:
        raise HTTPException(status_code=404, detail=f"Tab {tab_id} not found or input failed")
    return {"status": "ok"}


@router.post("/{tab_id}/navigate/back")
async def navigate_back(tab_id: str):
    """Navigate a tab back in browser history."""
    ok = await tab_manager.navigate_history(tab_id, "back")
    return {"ok": ok}


@router.post("/{tab_id}/navigate/forward")
async def navigate_forward(tab_id: str):
    """Navigate a tab forward in browser history."""
    ok = await tab_manager.navigate_history(tab_id, "forward")
    return {"ok": ok}


@router.post("/{tab_id}/activate")
async def activate_tab(tab_id: str):
    """Bring a Chrome tab to the foreground."""
    ok = await tab_manager.activate_tab(tab_id)
    return {"ok": ok}


@router.post("/{tab_id}/save-to-memory")
async def save_tab_to_memory(tab_id: str):
    """Scrape page text and save it into the Queen's shared memory + supermemory."""
    tab = await tab_manager.get_tab(tab_id)
    if not tab:
        return {"ok": False, "error": "Tab not found"}

    text_snippet = await tab_manager.get_page_text(tab_id)
    fact = f"Page: {tab.url}\nTitle: {tab.title}\nContent preview: {text_snippet[:800]}"

    from mind.memory import mind_memory
    async with mind_memory.lock:
        mind_memory.discovered_facts.append(fact)

    from services import supermemory_service
    try:
        await supermemory_service.save_page_fact(
            url=tab.url or "",
            title=tab.title or "",
            content_preview=text_snippet[:800],
        )
    except Exception:
        pass

    return {"ok": True, "fact": fact[:120] + "..."}


class ClusterLabelRequest(BaseModel):
    domain: str
    titles: str


@router.post("/cluster-label")
async def get_cluster_label(req: ClusterLabelRequest):
    """Ask the Queen LLM for a short topic label for a tab cluster."""
    from services.mistral_client import gemini_chat
    prompt = (
        f"Browser tabs from {req.domain}:\n{req.titles}\n\n"
        "Give a 1-3 word topic label for this group. Reply with only the label."
    )
    try:
        label = await gemini_chat(
            [{"role": "user", "content": prompt}],
            temperature=0.1,
            max_output_tokens=15,
        )
        label = (label or req.domain).strip().strip('"\'')
        return {"label": label}
    except Exception:
        return {"label": req.domain}


@router.get("/status")
async def tab_status():
    """Get tab manager connection status."""
    targets_info = {}
    for tid, target in tab_manager._cdp_targets.items():
        targets_info[tid] = {
            "has_ws_url": bool(target.get("webSocketDebuggerUrl")),
            "url": target.get("url", "")[:80],
            "title": target.get("title", "")[:60],
        }
    return {
        "cdp_connected": tab_manager.is_cdp_connected(),
        "cdp_url": "http://127.0.0.1:9222",
        "tab_count": len(await tab_manager.get_all_tabs()),
        "cdp_target_count": len(tab_manager._cdp_targets),
        "screenshot_cache_count": len(tab_manager._screenshot_cache),
        "targets": targets_info,
        "hint": "Launch Chrome with: chrome --remote-debugging-port=9222 --remote-allow-origins=*",
    }


@router.get("/diagnostic")
async def diagnostic():
    """Full pipeline diagnostic: Chrome CDP, WebSocket, screenshot, agent readiness."""
    import aiohttp, json as _json
    from config import GEMINI_API_KEY, BROWSER_ENGINE
    from services.browser_manager import browser_manager
    from mind.worker import agent_logs

    checks: dict = {}

    # 1. Chrome CDP HTTP
    try:
        async with aiohttp.ClientSession() as s:
            async with s.get("http://127.0.0.1:9222/json", timeout=aiohttp.ClientTimeout(total=3)) as r:
                targets = await r.json()
                checks["cdp_http"] = {"ok": True, "targets": len(targets)}
    except Exception as e:
        checks["cdp_http"] = {"ok": False, "error": str(e)}

    # 2. Chrome CDP WebSocket
    if checks.get("cdp_http", {}).get("ok") and targets:
        ws_url = targets[0].get("webSocketDebuggerUrl", "")
        if ws_url:
            try:
                async with aiohttp.ClientSession() as s:
                    async with s.ws_connect(ws_url, timeout=aiohttp.ClientTimeout(total=3), origin="http://localhost:9222") as ws:
                        await ws.send_json({"id": 1, "method": "Runtime.evaluate", "params": {"expression": "1+1"}})
                        async for msg in ws:
                            if msg.type == aiohttp.WSMsgType.TEXT:
                                data = _json.loads(msg.data)
                                if data.get("id") == 1:
                                    checks["cdp_ws"] = {"ok": not data.get("error"), "result": data.get("result", {}).get("result", {}).get("value")}
                                    break
                            else:
                                break
            except Exception as e:
                checks["cdp_ws"] = {"ok": False, "error": str(e)}
        else:
            checks["cdp_ws"] = {"ok": False, "error": "No webSocketDebuggerUrl in first target"}
    else:
        checks["cdp_ws"] = {"ok": False, "error": "CDP HTTP not available"}

    # 3. Screenshot cache
    checks["screenshot_cache"] = {
        "ok": len(tab_manager._screenshot_cache) > 0,
        "cached": len(tab_manager._screenshot_cache),
        "tabs": len(await tab_manager.get_all_tabs()),
    }

    # 4. Gemini API key
    checks["gemini_api_key"] = {"ok": bool(GEMINI_API_KEY), "set": bool(GEMINI_API_KEY)}

    # 5. Browser engine
    checks["browser_engine"] = {"engine": BROWSER_ENGINE}

    # 6. Active agents
    active = list(browser_manager.agents.keys())
    checks["agents"] = {"active": active, "count": len(active)}

    # 7. Agent logs
    checks["agent_logs"] = {aid: len(logs) for aid, logs in agent_logs.items()}

    # 8. WebSocket clients
    checks["ws_clients"] = {"connected": len(ws_manager.active_connections)}

    all_ok = all(c.get("ok", True) for c in checks.values() if isinstance(c, dict) and "ok" in c)
    return {"all_ok": all_ok, "checks": checks}
