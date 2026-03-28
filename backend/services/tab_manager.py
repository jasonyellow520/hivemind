import asyncio
import json
import base64
import logging
import threading
import aiohttp
from typing import Optional
from pydantic import BaseModel

logger = logging.getLogger(__name__)

CDP_DEFAULT_PORT = 9222
CDP_DEFAULT_URL = f"http://127.0.0.1:{CDP_DEFAULT_PORT}"


class BrowserTabInfo(BaseModel):
    tab_id: str
    title: str
    url: str
    favicon: str = ""
    instruction: str = ""
    assigned_agent_id: Optional[str] = None
    is_cdp: bool = False


class TabManager:
    """
    Tab manager using Chrome DevTools Protocol.
    Uses stable targetIds (cdp-{id}) so instructions survive re-scans.
    """

    def __init__(self):
        self._tabs: dict[str, BrowserTabInfo] = {}
        self._cdp_targets: dict[str, dict] = {}
        self._using_cdp: bool = False
        self._screenshot_cache: dict[str, bytes] = {}
        self._active_screencasts: set[str] = set()
        self._chatbar_injected: set[str] = set()
        self._capture_lock = asyncio.Lock()
        # threading.Lock for screenshot cache — safe from both thread pool and async contexts
        self._screenshot_lock = threading.Lock()
        # asyncio.Lock for all tab dict mutations/reads
        self._tabs_lock = asyncio.Lock()
        # Tabs the user explicitly closed — survives re-scans so CDP ghosts don't reappear
        self._closed_ids: set[str] = set()

    def _make_tab_id(self, target: dict) -> str:
        return f"cdp-{target['id']}"

    async def _check_cdp(self) -> bool:
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(
                    f"{CDP_DEFAULT_URL}/json/version",
                    timeout=aiohttp.ClientTimeout(total=2),
                ) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        logger.debug(f"CDP available: {data.get('Browser', 'unknown')}")
                        return True
        except Exception:
            pass
        return False

    async def scan_tabs(self) -> list[BrowserTabInfo]:
        """Scan Chrome tabs via CDP HTTP API. Preserves instructions across scans."""
        self._using_cdp = await self._check_cdp()

        if not self._using_cdp:
            async with self._tabs_lock:
                return list(self._tabs.values())

        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(
                    f"{CDP_DEFAULT_URL}/json",
                    timeout=aiohttp.ClientTimeout(total=5),
                ) as resp:
                    if resp.status != 200:
                        async with self._tabs_lock:
                            return list(self._tabs.values())
                    targets = await resp.json()

            _SCAN_FILTER_HOSTS = (
                "localhost:5173", "localhost:5174", "localhost:3000",
                "localhost:8080", "localhost:8081",
                "127.0.0.1:5173", "127.0.0.1:5174", "127.0.0.1:3000",
                "127.0.0.1:8080", "127.0.0.1:8081",
            )
            page_targets = [
                t for t in targets
                if t.get("type") == "page"
                and not t.get("url", "").startswith("chrome://")
                and not t.get("url", "").startswith("devtools://")
                and not any(host in t.get("url", "") for host in _SCAN_FILTER_HOSTS)
            ]

            async with self._tabs_lock:
                current_ids: set[str] = set()

                for target in page_targets:
                    tab_id = self._make_tab_id(target)
                    # Skip tabs the user explicitly closed (CDP ghosts)
                    if tab_id in self._closed_ids:
                        continue
                    current_ids.add(tab_id)
                    existing = self._tabs.get(tab_id)

                    tab = BrowserTabInfo(
                        tab_id=tab_id,
                        title=target.get("title", "Tab"),
                        url=target.get("url", "about:blank"),
                        favicon=target.get("faviconUrl", ""),
                        # Preserve user-set instruction and agent assignment across re-scans
                        instruction=existing.instruction if existing else "",
                        assigned_agent_id=existing.assigned_agent_id if existing else None,
                        is_cdp=True,
                    )
                    self._tabs[tab_id] = tab
                    self._cdp_targets[tab_id] = target

                # Remove tabs that no longer exist in Chrome
                all_cdp_ids = {self._make_tab_id(t) for t in page_targets}
                for old_id in list(self._tabs.keys()):
                    if old_id not in current_ids:
                        self._tabs.pop(old_id, None)
                        self._cdp_targets.pop(old_id, None)
                # Keep _closed_ids around even after CDP stops listing them,
                # so ghosts don't reappear. Only prune IDs older than what
                # CDP has ever returned (i.e. never prune — accumulate).
                # The set is small (bounded by total tabs ever closed in session).

                logger.debug(f"Synced {len(page_targets)} Chrome tabs")
                return list(self._tabs.values())

        except Exception as e:
            logger.error(f"CDP scan error: {e}")
            async with self._tabs_lock:
                return list(self._tabs.values())

    async def _activate_tab(self, target_id: str):
        """Bring a specific Chrome tab to the foreground via CDP."""
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(
                    f"{CDP_DEFAULT_URL}/json/activate/{target_id}",
                    timeout=aiohttp.ClientTimeout(total=3),
                ) as resp:
                    if resp.status == 200:
                        logger.debug(f"Activated tab {target_id[:20]}...")
        except Exception as e:
            logger.debug(f"Activate tab failed (non-fatal): {e}")

    async def _find_dashboard_target_id(self) -> Optional[str]:
        """Find the target ID of the Mindd dashboard tab (the one on localhost)."""
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(
                    f"{CDP_DEFAULT_URL}/json",
                    timeout=aiohttp.ClientTimeout(total=3),
                ) as resp:
                    if resp.status != 200:
                        return None
                    targets = await resp.json()
            for t in targets:
                if t.get("type") == "page":
                    url = t.get("url", "")
                    if "localhost:5173" in url or "localhost:5174" in url or "localhost:3000" in url:
                        return t.get("id")
        except Exception:
            pass
        return None

    async def _refocus_dashboard(self):
        """After modifying tabs, bring the dashboard tab back to front."""
        dash_id = await self._find_dashboard_target_id()
        if dash_id:
            await self._activate_tab(dash_id)

    async def open_tab(self, url: str = "about:blank") -> BrowserTabInfo:
        """Open a new tab in Chrome via CDP and return its stable tab info.
        Re-focuses the dashboard tab afterwards so the user stays on the mindspace."""
        if not self._using_cdp:
            await self.scan_tabs()

        try:
            encoded_url = url.replace(" ", "%20")
            cdp_url = f"{CDP_DEFAULT_URL}/json/new?{encoded_url}"
            timeout = aiohttp.ClientTimeout(total=10)
            async with aiohttp.ClientSession() as session:
                # Chrome 130+ requires PUT for /json/new
                async with session.put(cdp_url, timeout=timeout) as resp:
                    if resp.status == 200:
                        target = await resp.json()
                        tab_id = self._make_tab_id(target)
                        tab = BrowserTabInfo(
                            tab_id=tab_id,
                            title=target.get("title", "New Tab"),
                            url=target.get("url", url),
                            is_cdp=True,
                        )
                        async with self._tabs_lock:
                            self._tabs[tab_id] = tab
                            self._cdp_targets[tab_id] = target
                        logger.info(f"Opened tab {tab_id}: {url}")
                        await self._refocus_dashboard()
                        return tab
                    elif resp.status == 405:
                        # Older Chrome uses GET
                        async with session.get(cdp_url, timeout=timeout) as resp2:
                            if resp2.status == 200:
                                target = await resp2.json()
                                tab_id = self._make_tab_id(target)
                                tab = BrowserTabInfo(
                                    tab_id=tab_id,
                                    title=target.get("title", "New Tab"),
                                    url=target.get("url", url),
                                    is_cdp=True,
                                )
                                async with self._tabs_lock:
                                    self._tabs[tab_id] = tab
                                    self._cdp_targets[tab_id] = target
                                logger.info(f"Opened tab {tab_id}: {url}")
                                await self._refocus_dashboard()
                                return tab
        except Exception as e:
            logger.error(f"Failed to open tab: {e}")

        # Fallback placeholder if CDP call fails
        async with self._tabs_lock:
            tab_id = f"local-{len(self._tabs)}"
            tab = BrowserTabInfo(tab_id=tab_id, title="New Tab", url=url, is_cdp=False)
            self._tabs[tab_id] = tab
        return tab

    async def close_tab(self, tab_id: str) -> bool:
        """Close a Chrome tab via CDP using its stable targetId.
        Adds to _closed_ids so a re-scan won't resurrect it."""
        async with self._tabs_lock:
            if tab_id not in self._tabs:
                return False
            target = self._cdp_targets.get(tab_id)

        if target:
            target_id = target.get("id", "")
            if target_id:
                try:
                    async with aiohttp.ClientSession() as session:
                        async with session.get(
                            f"{CDP_DEFAULT_URL}/json/close/{target_id}",
                            timeout=aiohttp.ClientTimeout(total=5),
                        ) as resp:
                            if resp.status == 200:
                                logger.info(f"Closed Chrome tab {tab_id}")
                except Exception as e:
                    logger.error(f"Close tab CDP call failed: {e}")

        async with self._tabs_lock:
            self._tabs.pop(tab_id, None)
            self._cdp_targets.pop(tab_id, None)
            self._closed_ids.add(tab_id)
        return True

    _PROTECTED_HOSTS = [
        "localhost:5173", "localhost:5174", "localhost:3000",
        "localhost:8080", "localhost:8081",
        "127.0.0.1:5173", "127.0.0.1:5174", "127.0.0.1:3000",
        "127.0.0.1:8080", "127.0.0.1:8081",
    ]

    async def navigate_tab(self, tab_id: str, url: str) -> bool:
        """Navigate a specific Chrome tab to a URL via CDP WebSocket."""
        if any(host in url for host in self._PROTECTED_HOSTS):
            logger.warning("Blocked navigation to protected URL: %s", url)
            return None

        target = self._cdp_targets.get(tab_id)
        if target:
            ws_url = target.get("webSocketDebuggerUrl")
            if ws_url:
                try:
                    async with aiohttp.ClientSession() as session:
                        async with session.ws_connect(
                            ws_url, timeout=aiohttp.ClientTimeout(total=10), origin="http://localhost:9222"
                        ) as ws:
                            await ws.send_json({
                                "id": 1,
                                "method": "Page.navigate",
                                "params": {"url": url},
                            })
                            async for msg in ws:
                                if msg.type == aiohttp.WSMsgType.TEXT:
                                    data = json.loads(msg.data)
                                    if data.get("id") == 1:
                                        break
                                elif msg.type in (aiohttp.WSMsgType.CLOSE, aiohttp.WSMsgType.ERROR):
                                    break
                    logger.info(f"Navigated {tab_id} to {url}")
                except Exception as e:
                    logger.error(f"Navigate {tab_id} via CDP WS failed: {e}")

        async with self._tabs_lock:
            if tab_id in self._tabs:
                self._tabs[tab_id] = self._tabs[tab_id].model_copy(update={"url": url})
            result = tab_id in self._tabs
        await self._refocus_dashboard()
        return result

    async def get_tab_screenshot(self, tab_id: str) -> Optional[bytes]:
        """Return cached screenshot. Never blocks — cache is filled by background task."""
        with self._screenshot_lock:
            return self._screenshot_cache.get(tab_id)

    def register_screencast(self, tab_id: str) -> None:
        self._active_screencasts.add(tab_id)

    def unregister_screencast(self, tab_id: str) -> None:
        self._active_screencasts.discard(tab_id)

    async def _capture_one(self, tab_id: str) -> None:
        """Capture screenshot for one tab into the in-memory cache via CDP WebSocket.
        Only works for the currently active/focused tab; background tabs silently skip."""
        if tab_id in self._active_screencasts:
            return
        target = self._cdp_targets.get(tab_id)
        if not target:
            return
        ws_url = target.get("webSocketDebuggerUrl")
        if not ws_url:
            return
        try:
            timeout = aiohttp.ClientTimeout(total=4)
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.ws_connect(ws_url, origin="http://localhost:9222") as ws:
                    await ws.send_json({"id": 1, "method": "Page.enable", "params": {}})
                    await ws.send_json({
                        "id": 2,
                        "method": "Page.captureScreenshot",
                        "params": {"format": "jpeg", "quality": 40, "captureBeyondViewport": False},
                    })
                    async for msg in ws:
                        if msg.type == aiohttp.WSMsgType.TEXT:
                            data = json.loads(msg.data)
                            msg_id = data.get("id")
                            if msg_id == 2:
                                err = data.get("error")
                                if err:
                                    # -32603 = background tab, normal — skip silently
                                    return
                                img_b64 = data.get("result", {}).get("data", "")
                                if img_b64:
                                    decoded = base64.b64decode(img_b64)
                                    with self._screenshot_lock:
                                        self._screenshot_cache[tab_id] = decoded
                                return
                        elif msg.type in (aiohttp.WSMsgType.CLOSE, aiohttp.WSMsgType.ERROR):
                            return
        except (asyncio.TimeoutError, Exception):
            pass

    async def start_screenshot_loop(self) -> None:
        """Background task: capture screenshots in a thread pool to avoid blocking the event loop.
        Chrome only screenshots the active tab; background tabs silently skip."""
        import concurrent.futures
        pool = concurrent.futures.ThreadPoolExecutor(max_workers=1)
        loop = asyncio.get_event_loop()

        def _sync_capture_all():
            """Run in a thread: synchronously capture each tab via CDP WS."""
            import websocket as ws_lib
            for tid in list(self._cdp_targets.keys()):
                if tid in self._active_screencasts:
                    continue
                target = self._cdp_targets.get(tid)
                if not target:
                    continue
                ws_url = target.get("webSocketDebuggerUrl")
                if not ws_url:
                    continue
                try:
                    ws = ws_lib.create_connection(ws_url, timeout=3, origin="http://localhost:9222")
                    ws.send(json.dumps({"id": 1, "method": "Page.enable", "params": {}}))
                    ws.send(json.dumps({
                        "id": 2,
                        "method": "Page.captureScreenshot",
                        "params": {"format": "jpeg", "quality": 40, "captureBeyondViewport": False},
                    }))
                    while True:
                        raw = ws.recv()
                        data = json.loads(raw)
                        if data.get("id") == 2:
                            err = data.get("error")
                            if not err:
                                img_b64 = data.get("result", {}).get("data", "")
                                if img_b64:
                                    decoded = base64.b64decode(img_b64)
                                    with self._screenshot_lock:
                                        self._screenshot_cache[tid] = decoded
                            break
                    ws.close()
                except Exception:
                    pass

        while True:
            await asyncio.sleep(3.0)
            if not self._using_cdp or not self._cdp_targets:
                continue
            try:
                await loop.run_in_executor(pool, _sync_capture_all)
            except Exception:
                pass

    async def dispatch_input(self, tab_id: str, action: str, x: float = 0, y: float = 0, text: str = "", key: str = "", delta_x: float = 0, delta_y: float = 0) -> bool:
        """Forward mouse/keyboard/scroll events to a tab via CDP.
        Actions: click, mousedown, mouseup, mousemove, type, keydown, scroll"""
        target = self._cdp_targets.get(tab_id)
        if not target:
            return False
        ws_url = target.get("webSocketDebuggerUrl")
        if not ws_url:
            return False

        commands: list[dict] = []
        msg_id = 1

        if action == "click":
            commands = [
                {"id": msg_id, "method": "Input.dispatchMouseEvent", "params": {"type": "mousePressed", "x": x, "y": y, "button": "left", "clickCount": 1}},
                {"id": msg_id + 1, "method": "Input.dispatchMouseEvent", "params": {"type": "mouseReleased", "x": x, "y": y, "button": "left", "clickCount": 1}},
            ]
        elif action == "type":
            commands = [{"id": msg_id + i, "method": "Input.dispatchKeyEvent", "params": {"type": "char", "text": ch}} for i, ch in enumerate(text)]
        elif action == "keydown":
            params: dict = {"type": "keyDown", "key": key}
            if key == "Enter":
                params.update({"code": "Enter", "windowsVirtualKeyCode": 13, "nativeVirtualKeyCode": 13})
            elif key == "Backspace":
                params.update({"code": "Backspace", "windowsVirtualKeyCode": 8, "nativeVirtualKeyCode": 8})
            elif key == "Tab":
                params.update({"code": "Tab", "windowsVirtualKeyCode": 9, "nativeVirtualKeyCode": 9})
            elif key == "Escape":
                params.update({"code": "Escape", "windowsVirtualKeyCode": 27, "nativeVirtualKeyCode": 27})
            commands = [{"id": msg_id, "method": "Input.dispatchKeyEvent", "params": params}]
        elif action == "scroll":
            commands = [{"id": msg_id, "method": "Input.dispatchMouseEvent", "params": {"type": "mouseWheel", "x": x, "y": y, "deltaX": delta_x, "deltaY": delta_y}}]

        if not commands:
            return False

        try:
            async with aiohttp.ClientSession() as session:
                async with session.ws_connect(ws_url, timeout=aiohttp.ClientTimeout(total=3), origin="http://localhost:9222") as ws:
                    for cmd in commands:
                        await ws.send_json(cmd)
                    # Fire-and-forget: no response wait needed for input events
            return True
        except Exception as e:
            logger.debug(f"Input dispatch failed for {tab_id}: {e}")
            return False

    async def navigate_history(self, tab_id: str, direction: str) -> bool:
        """Navigate back or forward in a tab's browser history via CDP."""
        target = self._cdp_targets.get(tab_id)
        if not target:
            return False
        ws_url = target.get("webSocketDebuggerUrl")
        if not ws_url:
            return False
        method = "Page.goBack" if direction == "back" else "Page.goForward"
        try:
            async with aiohttp.ClientSession() as session:
                async with session.ws_connect(ws_url, timeout=aiohttp.ClientTimeout(total=5), origin="http://localhost:9222") as ws:
                    await ws.send_json({"id": 1, "method": method, "params": {}})
                    async for msg in ws:
                        if msg.type == aiohttp.WSMsgType.TEXT:
                            data = json.loads(msg.data)
                            if data.get("id") == 1:
                                return True
                        elif msg.type in (aiohttp.WSMsgType.CLOSE, aiohttp.WSMsgType.ERROR):
                            break
        except Exception as e:
            logger.debug(f"navigate_history {direction} failed: {e}")
        return False

    def get_cdp_ws_url(self, tab_id: str) -> Optional[str]:
        """Return the CDP WebSocket debugger URL for a specific tab (for agent use)."""
        target = self._cdp_targets.get(tab_id)
        return target.get("webSocketDebuggerUrl") if target else None

    def get_cdp_target_id(self, tab_id: str) -> Optional[str]:
        """Return the raw CDP target ID for a specific tab (for agent focus)."""
        target = self._cdp_targets.get(tab_id)
        return target.get("id") if target else None

    async def set_instruction(self, tab_id: str, instruction: str):
        async with self._tabs_lock:
            if tab_id in self._tabs:
                self._tabs[tab_id] = self._tabs[tab_id].model_copy(update={"instruction": instruction})

    async def assign_agent(self, tab_id: str, agent_id: str):
        """Assign an agent to a tab. Thread-safe via asyncio lock."""
        async with self._tabs_lock:
            if tab_id in self._tabs:
                self._tabs[tab_id] = self._tabs[tab_id].model_copy(update={"assigned_agent_id": agent_id})

    async def unassign_agent(self, tab_id: str):
        """Remove agent assignment from a tab. Thread-safe via asyncio lock."""
        async with self._tabs_lock:
            if tab_id in self._tabs:
                self._tabs[tab_id] = self._tabs[tab_id].model_copy(update={"assigned_agent_id": None})

    async def get_tabs_with_instructions(self) -> list[BrowserTabInfo]:
        async with self._tabs_lock:
            return [t for t in self._tabs.values() if t.instruction.strip()]

    async def get_all_tabs(self) -> list[BrowserTabInfo]:
        async with self._tabs_lock:
            return list(self._tabs.values())

    async def get_tab(self, tab_id: str) -> Optional[BrowserTabInfo]:
        async with self._tabs_lock:
            return self._tabs.get(tab_id)

    def is_cdp_connected(self) -> bool:
        return self._using_cdp

    async def activate_tab(self, tab_id: str) -> bool:
        """Bring a Chrome tab to the foreground (public)."""
        target = self._cdp_targets.get(tab_id)
        if not target:
            return False
        target_id = target.get("id", "")
        if target_id:
            await self._activate_tab(target_id)
            return True
        return False

    async def get_page_text(self, tab_id: str) -> str:
        """Extract visible text from a tab via CDP Runtime.evaluate."""
        ws_url = self.get_cdp_ws_url(tab_id)
        if not ws_url:
            return ""
        script = "document.body?.innerText?.slice(0,2000) ?? ''"
        try:
            async with aiohttp.ClientSession() as session:
                async with session.ws_connect(ws_url, timeout=aiohttp.ClientTimeout(total=5), origin="http://localhost:9222") as ws:
                    await ws.send_json({
                        "id": 1, "method": "Runtime.evaluate",
                        "params": {"expression": script, "returnByValue": True},
                    })
                    async for msg in ws:
                        if msg.type == aiohttp.WSMsgType.TEXT:
                            data = json.loads(msg.data)
                            if data.get("id") == 1:
                                return data.get("result", {}).get("result", {}).get("value", "")
                        elif msg.type in (aiohttp.WSMsgType.CLOSE, aiohttp.WSMsgType.ERROR):
                            break
        except Exception:
            pass
        return ""

    async def inject_chatbar(self, tab_id: str) -> bool:
        """Inject the Mindd floating chatbar into a Chrome tab via CDP."""
        target = self._cdp_targets.get(tab_id)
        if not target:
            return False
        ws_url = target.get("webSocketDebuggerUrl")
        if not ws_url:
            return False

        script = self._build_chatbar_script(tab_id)

        try:
            async with aiohttp.ClientSession() as session:
                async with session.ws_connect(ws_url, timeout=aiohttp.ClientTimeout(total=5), origin="http://localhost:9222") as ws:
                    await ws.send_json({
                        "id": 1, "method": "Page.addScriptToEvaluateOnNewDocument",
                        "params": {"source": script},
                    })
                    await ws.send_json({
                        "id": 2, "method": "Runtime.evaluate",
                        "params": {"expression": script},
                    })
                    acks = 0
                    async for msg in ws:
                        if msg.type == aiohttp.WSMsgType.TEXT:
                            data = json.loads(msg.data)
                            if data.get("id") in (1, 2):
                                acks += 1
                            if acks >= 2:
                                break
                        elif msg.type in (aiohttp.WSMsgType.CLOSE, aiohttp.WSMsgType.ERROR):
                            break
            self._chatbar_injected.add(tab_id)
            return True
        except Exception as e:
            logger.debug(f"Chatbar inject failed for {tab_id}: {e}")
            return False

    def _build_chatbar_script(self, tab_id: str) -> str:
        return f"""
(function() {{
  if (window.__minddChatbar) return;
  window.__minddChatbar = true;
  const BACKEND = 'http://localhost:8080';
  const TAB_ID = '{tab_id}';

  const bar = document.createElement('div');
  bar.id = '__mindd_bar';
  bar.style.cssText = `
    position:fixed;bottom:24px;right:24px;z-index:2147483647;
    background:rgba(6,8,16,0.96);border:1px solid rgba(0,212,255,0.35);
    border-radius:14px;padding:14px 16px;display:none;flex-direction:column;
    gap:10px;min-width:320px;backdrop-filter:blur(24px);
    box-shadow:0 0 40px rgba(0,212,255,0.12),0 20px 60px rgba(0,0,0,0.6);
    font-family:monospace;
  `;

  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;';
  const title = document.createElement('span');
  title.textContent = '⬡ MINDD · TASK AGENT';
  title.style.cssText = 'color:rgba(0,212,255,0.7);font-size:10px;letter-spacing:1px;';
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  closeBtn.style.cssText = 'background:none;border:none;color:rgba(255,255,255,0.3);cursor:pointer;font-size:12px;';
  closeBtn.onclick = () => {{ bar.style.display = 'none'; }};
  header.appendChild(title); header.appendChild(closeBtn);

  const ta = document.createElement('textarea');
  ta.placeholder = 'Give this tab a task... (Enter to submit)';
  ta.style.cssText = `
    background:rgba(255,255,255,0.05);border:1px solid rgba(0,212,255,0.2);
    border-radius:8px;color:rgba(255,255,255,0.85);font-size:12px;font-family:monospace;
    padding:8px 10px;resize:none;outline:none;min-height:64px;width:100%;box-sizing:border-box;
  `;

  const submit = async () => {{
    const task = ta.value.trim();
    if (!task) return;
    btn.textContent = 'DISPATCHING...';
    btn.disabled = true;
    try {{
      await fetch(BACKEND + '/api/v1/tasks/submit', {{
        method:'POST', headers:{{'Content-Type':'application/json'}},
        body: JSON.stringify({{ task_description: task, tab_id: TAB_ID }})
      }});
      ta.value = '';
      bar.style.display = 'none';
    }} catch(e) {{ btn.textContent = 'ERROR'; }}
    finally {{ btn.textContent = '⚡ RUN AGENT'; btn.disabled = false; }}
  }};

  ta.addEventListener('keydown', (e) => {{
    if (e.key === 'Enter' && !e.shiftKey) {{ e.preventDefault(); submit(); }}
    if (e.key === 'Escape') {{ bar.style.display = 'none'; }}
  }});

  const btn = document.createElement('button');
  btn.textContent = '⚡ RUN AGENT';
  btn.style.cssText = `
    background:rgba(0,212,255,0.12);border:1px solid rgba(0,212,255,0.25);
    color:#00d4ff;padding:7px 14px;border-radius:8px;cursor:pointer;
    font-family:monospace;font-size:11px;letter-spacing:1px;width:100%;
  `;
  btn.onclick = submit;

  const saveBtn = document.createElement('button');
  saveBtn.textContent = '📖 Save Page to Memory';
  saveBtn.style.cssText = `
    background:rgba(139,92,246,0.1);border:1px solid rgba(139,92,246,0.2);
    color:rgba(139,92,246,0.8);padding:5px 14px;border-radius:8px;cursor:pointer;
    font-family:monospace;font-size:10px;width:100%;
  `;
  saveBtn.onclick = async () => {{
    saveBtn.textContent = 'Saving...';
    try {{
      await fetch(BACKEND + '/api/v1/tabs/' + TAB_ID + '/save-to-memory', {{ method:'POST' }});
      saveBtn.textContent = '✓ Saved!';
      setTimeout(() => {{ saveBtn.textContent = '📖 Save Page to Memory'; }}, 2000);
    }} catch(e) {{ saveBtn.textContent = 'Error'; setTimeout(() => {{ saveBtn.textContent = '📖 Save Page to Memory'; }}, 2000); }}
  }};

  bar.appendChild(header); bar.appendChild(ta); bar.appendChild(btn); bar.appendChild(saveBtn);
  document.body.appendChild(bar);

  document.addEventListener('keydown', (e) => {{
    if (e.altKey && (e.key === 'z' || e.key === 'Z')) {{
      e.preventDefault();
      const shown = bar.style.display === 'flex';
      bar.style.display = shown ? 'none' : 'flex';
      if (!shown) setTimeout(() => ta.focus(), 50);
    }}
  }});
}})();
"""

    async def close(self):
        self._tabs.clear()
        self._cdp_targets.clear()


tab_manager = TabManager()
