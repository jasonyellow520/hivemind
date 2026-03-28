"""
Playwright + Gemini agent: connects to existing Chrome via CDP,
focuses a specific tab, and runs an accessibility-tree see-think-act loop.
Uses page.locator("body").aria_snapshot() for fast text-only snapshots
instead of screenshots — ~4x fewer tokens, no vision model needed.
"""
import asyncio
import logging
import re
from typing import Optional, Callable

import aiohttp
from playwright.async_api import async_playwright, Browser, Page

from google import genai
from google.genai import types
from config import GEMINI_API_KEY

logger = logging.getLogger(__name__)

CDP_DEFAULT_URL = "http://127.0.0.1:9222"
MAX_STEPS = 15
AGENT_MODEL = "gemini-3-flash-preview"

BLOCKED_HOSTS = {
    "localhost:5173", "localhost:5174", "localhost:3000",
    "localhost:8080", "localhost:8081",
    "127.0.0.1:5173", "127.0.0.1:5174", "127.0.0.1:3000",
    "127.0.0.1:8080", "127.0.0.1:8081",
}


def _is_blocked_url(url: str) -> bool:
    """Check if a URL targets a protected localhost address."""
    try:
        from urllib.parse import urlparse
        parsed = urlparse(url)
        netloc = (parsed.netloc or "").lower()
        return netloc in BLOCKED_HOSTS or netloc.startswith("localhost") or netloc.startswith("127.0.0.1")
    except Exception:
        return False

ACTION_PROMPT = """You are controlling a browser. You see an accessibility tree snapshot of the current page (YAML format).

TASK: {task}

Current URL: {url}

ACCESSIBILITY TREE:
{snapshot}

Reply with exactly ONE action in this format (one line each):
ACTION: click|type|goto|scroll|press_key|wait|done
ROLE: ARIA role of the element (button, link, textbox, combobox, heading, etc.)
NAME: Accessible name of the element (the quoted text from the snapshot)
VALUE: text to type, URL to navigate to, key to press, scroll amount, wait ms, or result summary (for done)

Rules:
- CRITICAL: NEVER navigate to localhost, 127.0.0.1, or any URL containing localhost:5173, localhost:5174, localhost:8080, localhost:8081. These are the Hivemind dashboard — navigating there will break the system.
- Only reference elements that appear in the snapshot above. Never guess element names.
- Use "done" when the task is complete; VALUE must be a short summary of what was accomplished.
- For "click", ROLE and NAME must match an element in the snapshot.
- For "type", ROLE should be textbox/combobox/searchbox, NAME is the field label, VALUE is the text.
- For "goto", VALUE is the full URL (ROLE and NAME can be empty).
- For "scroll", VALUE is pixels to scroll (positive=down, negative=up). Default 500.
- For "press_key", VALUE is the key name (Enter, Tab, Escape, ArrowDown, etc.).
- For "wait", VALUE is milliseconds to wait (max 5000).
- Reply only with those four lines, no other text."""


def _parse_action(response: str) -> tuple[str, str, str, str]:
    """Parse ACTION, ROLE, NAME, VALUE from model response."""
    action, role, name, value = "done", "", "", ""
    for line in response.strip().split("\n"):
        line = line.strip()
        upper = line.upper()
        if upper.startswith("ACTION:"):
            action = line.split(":", 1)[1].strip().lower()
        elif upper.startswith("ROLE:"):
            role = line.split(":", 1)[1].strip().lower()
        elif upper.startswith("NAME:"):
            name = line.split(":", 1)[1].strip()
        elif upper.startswith("VALUE:"):
            value = line.split(":", 1)[1].strip()
    return action, role, name, value


async def _get_page_index_for_target(cdp_url: str, target_id: str) -> Optional[int]:
    """Fetch /json from CDP, find index of page-type target with given id."""
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{cdp_url}/json",
                timeout=aiohttp.ClientTimeout(total=5),
            ) as resp:
                if resp.status != 200:
                    return None
                targets = await resp.json()
        page_targets = [
            t for t in targets
            if t.get("type") == "page"
            and not t.get("url", "").startswith("chrome://")
            and not t.get("url", "").startswith("devtools://")
        ]
        for i, t in enumerate(page_targets):
            if t.get("id") == target_id:
                return i
    except Exception as e:
        logger.debug(f"CDP /json failed: {e}")
    return None


async def _get_aria_snapshot(page: Page, max_length: int = 8000) -> str:
    """Get accessibility tree snapshot, truncated to max_length."""
    try:
        snapshot = await page.locator("body").aria_snapshot()
        if len(snapshot) > max_length:
            snapshot = snapshot[:max_length] + "\n... (truncated)"
        return snapshot
    except Exception as e:
        logger.debug(f"aria_snapshot failed: {e}")
        return f"(Could not read accessibility tree: {e})"


async def run_playwright_agent(
    task: str,
    cdp_url: str = CDP_DEFAULT_URL,
    cdp_target_id: Optional[str] = None,
    start_url: Optional[str] = None,
    on_step_callback: Optional[Callable] = None,
    cancel_event: Optional[asyncio.Event] = None,
    max_steps: int = MAX_STEPS,
) -> str:
    """
    Run a task on Chrome via Playwright + Gemini (accessibility tree, no screenshots).
    Connects to cdp_url, focuses the tab with cdp_target_id (if given),
    then runs a see-think-act loop until done or max steps.
    """
    if not GEMINI_API_KEY:
        raise ValueError("GEMINI_API_KEY is required for Playwright agent")

    client = genai.Client(api_key=GEMINI_API_KEY)

    page_index: Optional[int] = None
    if cdp_target_id:
        page_index = await _get_page_index_for_target(cdp_url, cdp_target_id)

    browser: Optional[Browser] = None
    page: Optional[Page] = None
    created_new_page = False
    pw = await async_playwright().start()
    try:
        browser = await pw.chromium.connect_over_cdp(cdp_url)
        contexts = browser.contexts
        if not contexts:
            raise RuntimeError("No browser context after CDP connect")
        context = contexts[0]
        pages = context.pages

        # Filter out dashboard/backend pages — agents must never touch these
        safe_pages = [p for p in pages if not _is_blocked_url(p.url)]

        if page_index is not None and 0 <= page_index < len(pages):
            candidate = pages[page_index]
            if _is_blocked_url(candidate.url):
                logger.warning("Target page index %d is a protected page (%s), creating new tab",
                               page_index, candidate.url)
                page = await context.new_page()
                created_new_page = True
            else:
                page = candidate
        elif safe_pages:
            page = safe_pages[0]
        else:
            page = await context.new_page()
            created_new_page = True

        if start_url:
            if created_new_page or (page.url != start_url and "about:blank" in page.url):
                await page.goto(start_url, wait_until="domcontentloaded", timeout=15000)

        step = 0
        last_result = ""

        while step < max_steps:
            # Check cancellation
            if cancel_event and cancel_event.is_set():
                last_result = "Cancelled by user."
                break

            step += 1

            # Get accessibility snapshot instead of screenshot
            snapshot = await _get_aria_snapshot(page)
            current_url = page.url if page else ""

            try:
                prompt = ACTION_PROMPT.format(
                    task=task,
                    url=current_url,
                    snapshot=snapshot,
                )
                response = await client.aio.models.generate_content(
                    model=AGENT_MODEL,
                    contents=[types.Part.from_text(text=prompt)],
                    config=types.GenerateContentConfig(temperature=0.1, max_output_tokens=512),
                )
                content = (response.text or "").strip()
            except Exception as e:
                logger.warning(f"Gemini call failed: {e}")
                last_result = f"Error: {e}"
                break

            action, role, name, value = _parse_action(content)

            if on_step_callback:
                try:
                    class _State:
                        url = current_url
                    if asyncio.iscoroutinefunction(on_step_callback):
                        await on_step_callback(_State(), content[:200], step)
                    else:
                        on_step_callback(_State(), content[:200], step)
                except Exception:
                    pass

            if action == "done":
                last_result = value or "Task completed."
                break

            try:
                if action == "goto" and value:
                    if _is_blocked_url(value):
                        logger.warning("Blocked navigation to protected URL: %s", value)
                        last_result = "Blocked: cannot navigate to dashboard/backend URLs."
                        continue
                    await page.goto(value, wait_until="domcontentloaded", timeout=15000)
                elif action == "click" and role and name:
                    await page.get_by_role(role, name=name).click(timeout=5000)
                    await page.wait_for_timeout(500)
                elif action == "type" and role and name and value:
                    await page.get_by_role(role, name=name).fill(value, timeout=5000)
                    await page.wait_for_timeout(300)
                elif action == "scroll":
                    scroll_amount = int(value) if value else 500
                    await page.mouse.wheel(0, scroll_amount)
                    await page.wait_for_timeout(300)
                elif action == "press_key" and value:
                    await page.keyboard.press(value)
                    await page.wait_for_timeout(300)
                elif action == "wait":
                    wait_ms = min(int(value), 5000) if value else 1000
                    await page.wait_for_timeout(wait_ms)
                else:
                    logger.debug(f"Skip invalid action: {action} role={role!r} name={name!r}")
            except Exception as e:
                logger.debug(f"Playwright action failed: {e}")
                last_result = str(e)

        return last_result or "Max steps reached."
    finally:
        # Close the page first so the tab doesn't linger as a CDP ghost
        if page:
            try:
                await page.close()
            except Exception:
                pass
        if browser:
            try:
                await browser.close()
            except Exception:
                pass
        await pw.stop()
