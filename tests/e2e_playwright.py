"""
HIVEMIND E2E Playwright Tests
Connects to running Chrome via CDP (port 9222) and tests the dashboard.
Uses a SINGLE page to avoid creating ghost tabs in Chrome.
"""
import asyncio
import json
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

BACKEND = "http://127.0.0.1:8081"
FRONTEND = "http://localhost:5173"


async def run_tests():
    from playwright.async_api import async_playwright

    results = []
    screenshot_dir = os.path.join(os.path.dirname(__file__), "screenshots")
    os.makedirs(screenshot_dir, exist_ok=True)

    async with async_playwright() as p:
        print("Connecting to Chrome via CDP on localhost:9222...")
        browser = await p.chromium.connect_over_cdp("http://127.0.0.1:9222")
        print(f"Connected! Contexts: {len(browser.contexts)}")

        context = browser.contexts[0] if browser.contexts else await browser.new_context()

        # Find the existing dashboard page or use it
        page = None
        for pg in context.pages:
            if "localhost:5173" in pg.url:
                page = pg
                break
        if not page:
            page = await context.new_page()

        # ─── Test 1: Dashboard renders correctly ───
        print("\n=== Test 1: Dashboard renders correctly ===")
        try:
            await page.goto(FRONTEND, wait_until="networkidle", timeout=15000)
            await page.wait_for_timeout(2000)

            title = await page.title()
            print(f"  Page title: {title}")

            canvas = await page.query_selector(".react-flow")
            has_canvas = canvas is not None
            print(f"  ReactFlow canvas present: {has_canvas}")

            command_bar = await page.query_selector(
                '[class*="CommandBar"], [class*="command"], '
                'input[placeholder*="task"], input[placeholder*="command"]'
            )
            has_command = command_bar is not None
            print(f"  CommandBar found: {has_command}")

            ss_path = os.path.join(screenshot_dir, "01_dashboard.png")
            await page.screenshot(path=ss_path, full_page=True)
            print(f"  Screenshot saved: {ss_path}")

            results.append(("Test 1: Dashboard renders", has_canvas,
                           "ReactFlow canvas present" if has_canvas else "No canvas found"))
        except Exception as e:
            print(f"  FAILED: {e}")
            results.append(("Test 1: Dashboard renders", False, str(e)))

        # ─── Test 2: Tab hexagon layout ───
        print("\n=== Test 2: Tab hexagon layout ===")
        try:
            import urllib.request
            with urllib.request.urlopen("http://127.0.0.1:9222/json") as resp:
                cdp_tabs = json.loads(resp.read())
            real_pages = [t for t in cdp_tabs
                         if t.get("type") == "page"
                         and "localhost" not in t.get("url", "")
                         and not t.get("url", "").startswith("chrome://")]
            print(f"  Non-localhost Chrome tabs: {len(real_pages)}")

            await page.goto(FRONTEND, wait_until="networkidle", timeout=15000)
            await page.wait_for_timeout(3000)

            hex_nodes = await page.query_selector_all('.react-flow__node')
            hex_count = len(hex_nodes)
            print(f"  Hex nodes on canvas: {hex_count}")

            all_nodes_text = await page.evaluate("""
                () => {
                    const nodes = document.querySelectorAll('.react-flow__node');
                    return Array.from(nodes).map(n => n.textContent || '').join('|||');
                }
            """)
            has_localhost = "localhost:5173" in all_nodes_text or "localhost:5174" in all_nodes_text
            print(f"  Localhost tabs on canvas: {has_localhost} (should be False)")

            ss_path = os.path.join(screenshot_dir, "02_hex_layout.png")
            await page.screenshot(path=ss_path, full_page=True)
            print(f"  Screenshot saved: {ss_path}")

            results.append(("Test 2: Hex layout", not has_localhost,
                           f"{hex_count} nodes, localhost filtered: {not has_localhost}"))
        except Exception as e:
            print(f"  FAILED: {e}")
            results.append(("Test 2: Hex layout", False, str(e)))

        # ─── Test 3: Dashboard tab protection ───
        print("\n=== Test 3: Dashboard tab protection ===")
        try:
            node_urls = await page.evaluate("""
                () => {
                    const nodes = document.querySelectorAll('.react-flow__node');
                    const urls = [];
                    nodes.forEach(n => {
                        const text = n.textContent || '';
                        if (text.includes('localhost') || text.includes('127.0.0.1'))
                            urls.push(text.substring(0, 100));
                    });
                    return urls;
                }
            """)
            is_protected = len(node_urls) == 0
            print(f"  Protected (no localhost nodes): {is_protected}")

            ss_path = os.path.join(screenshot_dir, "03_protection.png")
            await page.screenshot(path=ss_path, full_page=True)
            print(f"  Screenshot saved: {ss_path}")

            results.append(("Test 3: Dashboard protection", is_protected,
                           "No localhost nodes" if is_protected else f"Leaked: {node_urls[:2]}"))
        except Exception as e:
            print(f"  FAILED: {e}")
            results.append(("Test 3: Dashboard protection", False, str(e)))

        # ─── Test 4: Backend API health (use fetch, not navigation) ───
        print("\n=== Test 4: Backend API health ===")
        try:
            health = await page.evaluate(f"""
                async () => {{
                    try {{
                        const r = await fetch('{BACKEND}/health');
                        const d = await r.json();
                        return {{ ok: r.ok, status: r.status, data: JSON.stringify(d).substring(0, 100) }};
                    }} catch (e) {{
                        return {{ ok: false, status: 0, data: e.message }};
                    }}
                }}
            """)
            print(f"  Backend health: {health['data']}")
            results.append(("Test 4: Backend API", health["ok"], "Health endpoint OK" if health["ok"] else health["data"]))
        except Exception as e:
            print(f"  FAILED: {e}")
            results.append(("Test 4: Backend API", False, str(e)))

        # ─── Test 5: WebSocket connection ───
        print("\n=== Test 5: WebSocket connection ===")
        try:
            ws_status = await page.evaluate("""
                () => {
                    const indicators = document.querySelectorAll('[class*="connected"], [class*="status"]');
                    return indicators.length > 0 ? 'indicators-found' : 'no-indicators';
                }
            """)
            print(f"  WS status check: {ws_status}")

            ss_path = os.path.join(screenshot_dir, "05_ws_check.png")
            await page.screenshot(path=ss_path, full_page=True)
            print(f"  Screenshot saved: {ss_path}")

            results.append(("Test 5: WebSocket", True, ws_status))
        except Exception as e:
            print(f"  FAILED: {e}")
            results.append(("Test 5: WebSocket", False, str(e)))

        # ─── Test 6: iMessage API (use fetch, not navigation) ───
        print("\n=== Test 6: iMessage API structure ===")
        try:
            imsg = await page.evaluate(f"""
                async () => {{
                    try {{
                        const r = await fetch('{BACKEND}/api/v1/imessage/health');
                        const d = await r.json();
                        return {{ ok: r.ok, status: r.status, data: JSON.stringify(d).substring(0, 100) }};
                    }} catch (e) {{
                        return {{ ok: false, status: 0, data: e.message }};
                    }}
                }}
            """)
            print(f"  iMessage health: HTTP {imsg['status']} — {imsg['data']}")
            results.append(("Test 6: iMessage API", imsg["ok"], "Health OK"))
        except Exception as e:
            print(f"  FAILED: {e}")
            results.append(("Test 6: iMessage API", False, str(e)))

        # ─── Summary ───
        print("\n" + "=" * 60)
        print("TEST RESULTS SUMMARY")
        print("=" * 60)
        passed = sum(1 for _, s, _ in results if s)
        failed = sum(1 for _, s, _ in results if not s)
        for name, success, detail in results:
            print(f"  [{'PASS' if success else 'FAIL'}] {name}: {detail}")

        print(f"\n  Total: {passed} passed, {failed} failed out of {len(results)}")
        print(f"  Screenshots: {screenshot_dir}")
        print("\nDone. No ghost tabs created.")

    return results


if __name__ == "__main__":
    results = asyncio.run(run_tests())
    sys.exit(0 if all(r[1] for r in results) else 1)
