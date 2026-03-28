import asyncio
import logging
from dataclasses import dataclass, field
from typing import Optional, Callable, Union

from config import (
    GEMINI_API_KEY,
    WORKER_MODEL,
    BROWSER_ENGINE,
    AGENT_MAX_STEPS,
    AGENT_TIMEOUT_SECONDS,
    AGENT_MAX_ACTIONS_PER_STEP,
)

logger = logging.getLogger(__name__)

CDP_DEFAULT_URL = "http://127.0.0.1:9222"

PROTECTED_DOMAINS = [
    "localhost:5173",
    "localhost:5174",
    "localhost:3000",
    "localhost:8080",
    "localhost:8081",
    "127.0.0.1:5173",
    "127.0.0.1:5174",
    "127.0.0.1:3000",
    "127.0.0.1:8080",
    "127.0.0.1:8081",
]


@dataclass
class _PlaywrightHandle:
    """Lightweight handle for a playwright-based agent (no heavy Agent object)."""
    agent_id: str
    task: str
    on_step_callback: Optional[Callable]
    start_url: Optional[str]
    cdp_url: str
    cdp_target_id: Optional[str]
    cancel_event: asyncio.Event = field(default_factory=asyncio.Event)


def _create_worker_llm():
    from browser_use.llm.google.chat import ChatGoogle
    return ChatGoogle(
        model=WORKER_MODEL,
        api_key=GEMINI_API_KEY,
        temperature=0.1,
        thinking_level="minimal",
        max_retries=3,
    )


class BrowserManager:
    """Manages browser agents with dual engine dispatch.

    Supports two engines:
    - "playwright": Accessibility-tree agent (fast, text-only, ~1-3s/step)
    - "browser-use": Full browser-use agent (vision-based, ~4-8s/step)

    Engine selection is controlled by BROWSER_ENGINE config."""

    def __init__(self):
        self.agents: dict[str, Union[object, _PlaywrightHandle]] = {}
        self._browsers: dict[str, object] = {}
        self._llm = None  # Lazy init — only when browser-use engine is needed
        self._agent_tasks: dict[str, asyncio.Task] = {}

    def _get_llm(self):
        if self._llm is None:
            self._llm = _create_worker_llm()
        return self._llm

    def _create_browser(self, cdp_url: str):
        from browser_use import Browser
        return Browser(
            cdp_url=cdp_url,
            headless=False,
            prohibited_domains=PROTECTED_DOMAINS,
            wait_between_actions=1.0,
            enable_default_extensions=False,
        )

    async def create_agent(
        self,
        agent_id: str,
        task: str,
        on_step_callback: Optional[Callable] = None,
        start_url: Optional[str] = None,
        cdp_url: Optional[str] = None,
        cdp_target_id: Optional[str] = None,
    ):
        """Create an agent using the configured engine."""
        effective_cdp = cdp_url or CDP_DEFAULT_URL

        # Reject agents targeting the dashboard or backend
        if start_url:
            for domain in PROTECTED_DOMAINS:
                if domain in start_url:
                    raise ValueError(f"Cannot create agent targeting protected domain: {domain}")

        if BROWSER_ENGINE == "playwright":
            handle = _PlaywrightHandle(
                agent_id=agent_id,
                task=task,
                on_step_callback=on_step_callback,
                start_url=start_url,
                cdp_url=effective_cdp,
                cdp_target_id=cdp_target_id,
            )
            self.agents[agent_id] = handle
            logger.info("Agent %s created (playwright, CDP %s): %s",
                        agent_id, effective_cdp, task[:60])
            return handle

        # browser-use engine
        try:
            from browser_use import Agent, Browser
            browser = self._create_browser(effective_cdp)
            self._browsers[agent_id] = browser

            agent = Agent(
                task=task,
                llm=self._get_llm(),
                browser=browser,
                register_new_step_callback=on_step_callback,
                max_actions_per_step=AGENT_MAX_ACTIONS_PER_STEP,
                use_vision=True,
                enable_planning=True,
                extend_system_message=(
                    "You are part of a multi-agent swarm system called Hivemind. "
                    "Complete your assigned task efficiently with minimal steps. "
                    "CRITICAL: NEVER navigate to localhost, 127.0.0.1, or any URL containing "
                    "localhost:5173, localhost:5174, localhost:8080, localhost:8081, "
                    "127.0.0.1:5173, 127.0.0.1:5174, 127.0.0.1:8080, 127.0.0.1:8081. "
                    "These are the Hivemind dashboard and backend — navigating there will break the system. "
                    "NEVER change the URL of any page that is on localhost or 127.0.0.1. "
                    "Do NOT open new tabs — work only in your assigned tab. "
                    "When the task is complete, use the done action immediately."
                ),
            )
            self.agents[agent_id] = agent
            logger.info("Agent %s created (browser-use, CDP %s): %s",
                        agent_id, effective_cdp, task[:60])
            return agent

        except Exception as e:
            logger.error("Failed to create agent %s: %s", agent_id, e, exc_info=True)
            raise

    async def run_agent(self, agent_id: str) -> str:
        agent = self.agents.get(agent_id)
        if not agent:
            raise ValueError(f"Agent {agent_id} not found")

        if isinstance(agent, _PlaywrightHandle):
            from services.playwright_agent import run_playwright_agent
            try:
                result = await asyncio.wait_for(
                    run_playwright_agent(
                        task=agent.task,
                        cdp_url=agent.cdp_url,
                        cdp_target_id=agent.cdp_target_id,
                        start_url=agent.start_url,
                        on_step_callback=agent.on_step_callback,
                        cancel_event=agent.cancel_event,
                        max_steps=AGENT_MAX_STEPS,
                    ),
                    timeout=AGENT_TIMEOUT_SECONDS,
                )
                logger.info("Agent %s finished (playwright): %s", agent_id, str(result)[:100])
                return str(result)
            except Exception as e:
                logger.error("Agent %s failed (playwright): %s", agent_id, e, exc_info=True)
                raise

        # browser-use agent
        try:
            result = await asyncio.wait_for(
                agent.run(max_steps=AGENT_MAX_STEPS),
                timeout=AGENT_TIMEOUT_SECONDS,
            )
            final = result.final_result() if result else "No result"
            logger.info("Agent %s finished (browser-use): %s", agent_id, str(final)[:100])
            return str(final)
        except Exception as e:
            logger.error("Agent %s failed (browser-use): %s", agent_id, e, exc_info=True)
            raise

    async def stop_agent(self, agent_id: str):
        """Stop and clean up an agent."""
        self._agent_tasks.pop(agent_id, None)
        agent = self.agents.pop(agent_id, None)

        if isinstance(agent, _PlaywrightHandle):
            agent.cancel_event.set()
            logger.info("Agent %s stopped (playwright)", agent_id)
            return

        browser = self._browsers.pop(agent_id, None)
        if browser:
            try:
                await browser.close()
            except Exception:
                pass
        logger.info("Agent %s stopped", agent_id)

    async def kill_agent(self, agent_id: str) -> bool:
        """Cancel the asyncio task for a running agent and clean up."""
        task = self._agent_tasks.pop(agent_id, None)
        if task and not task.done():
            task.cancel()
            try:
                await asyncio.shield(task)
            except (asyncio.CancelledError, Exception):
                pass

        agent = self.agents.pop(agent_id, None)
        if isinstance(agent, _PlaywrightHandle):
            agent.cancel_event.set()
            logger.info("Agent %s killed (playwright)", agent_id)
            return True

        browser = self._browsers.pop(agent_id, None)
        if browser:
            try:
                await browser.close()
            except Exception:
                pass
        logger.info("Agent %s killed", agent_id)
        return True

    def register_task(self, agent_id: str, task: asyncio.Task) -> None:
        self._agent_tasks[agent_id] = task

    async def stop_all(self):
        for aid in list(self.agents.keys()):
            await self.stop_agent(aid)


browser_manager = BrowserManager()
