import asyncio
import uuid
import logging
import aiohttp
from typing import Optional
from models.agent import AgentStatusEnum, HITLRequest
from models.task import SubTask, SubTaskResult
from models import events
from mind.sensitive import detect
from mind.memory import get_memory, get_active_memory
from services.browser_manager import browser_manager
from services.websocket_manager import manager as ws_manager
from services import elevenlabs_service
from services.mistral_client import gemini_chat
from services import imessage_sender
from services import conversation_store

logger = logging.getLogger(__name__)

hitl_events: dict[str, asyncio.Event] = {}
hitl_resolutions: dict[str, dict] = {}

# Per-agent log storage: agent_id -> list of log dicts
agent_logs: dict[str, list[dict]] = {}

# Lock for HITL dict access to prevent race conditions across concurrent workers
_hitl_lock = asyncio.Lock()


async def _broadcast_queen_commentary(
    agent_id: str, task: str, step_count: int, last_output: str, task_id: str = ""
) -> None:
    """Fire-and-forget Queen narration — never blocks the agent."""
    try:
        narration_prompt = (
            f"In one sentence, narrate what this agent is doing.\n"
            f"Task: {task[:200]}\n"
            f"Current step: {step_count}\n"
            f"Last action: {last_output[:200]}"
        )
        narration = await gemini_chat(
            [{"role": "user", "content": narration_prompt}],
            temperature=0.5,
            max_output_tokens=128,
        )
        if narration:
            await ws_manager.broadcast(events.queen_commentary(agent_id, narration.strip(), task_id))
    except Exception as e:
        logger.debug("Queen commentary failed (non-blocking): %s", e)


async def _query_queen(question: str, context: str, agent_id: str, task_id: str = "") -> str:
    """HTTP call to the Queen's query endpoint for worker guidance."""
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                "http://localhost:8080/api/v1/tasks/queen-query",
                json={
                    "question": question,
                    "context": context,
                    "agent_id": agent_id,
                    "task_id": task_id,
                },
                timeout=aiohttp.ClientTimeout(total=30),
            ) as resp:
                data = await resp.json()
                return data.get("answer", "")
    except Exception:
        return ""


async def run_worker(
    subtask: SubTask,
    subtask_index: int,
    tab_id: str = "",
    cdp_url: str = "",
    cdp_target_id: Optional[str] = None,
    task_id: str = "",
    global_index: int = 0,
) -> SubTaskResult:
    agent_id = f"worker-{subtask.subtask_id}"
    step_count = 0
    agent_logs[agent_id] = []

    # Resolve per-task memory; fall back to the global latest memory for compat
    memory = (get_memory(task_id) if task_id else None) or get_active_memory()

    # Get phone number for iMessage updates
    phone_number = await conversation_store.get_phone_number_for_task(task_id) if task_id else None

    await ws_manager.broadcast(
        events.agent_spawned(
            agent_id, subtask.description, subtask_index,
            tab_id=tab_id or None,
            task_id=task_id,
            global_index=global_index,
        )
    )
    await ws_manager.broadcast(events.agent_status(agent_id, AgentStatusEnum.PLANNING, task_id=task_id))

    try:
        audio = await elevenlabs_service.announce(f"Agent {subtask_index + 1} is now active.")
        if audio:
            await ws_manager.broadcast(events.voice_announcement(
                f"Agent {subtask_index + 1} is now active.", audio))
    except Exception:
        pass

    async def on_step(browser_state, agent_output, step):
        nonlocal step_count
        step_count += 1
        output_text = str(agent_output) if agent_output else ""
        current_url = ""

        try:
            if browser_state and hasattr(browser_state, "url"):
                current_url = browser_state.url
        except Exception:
            pass

        log_entry = {
            "message": output_text[:200],
            "url": current_url,
            "action": f"step-{step_count}",
            "step": step_count,
        }
        agent_logs.setdefault(agent_id, []).append(log_entry)

        await ws_manager.broadcast(events.agent_log(
            agent_id, output_text[:200], current_url, f"step-{step_count}", task_id=task_id))
        await ws_manager.broadcast(events.agent_status(
            agent_id, AgentStatusEnum.RUNNING, step_count, task_id=task_id))

        # Send iMessage status update
        if phone_number and (step_count == 1 or step_count % 3 == 0):
            try:
                status_text = f"Agent {agent_id} (step {step_count}): {output_text[:100]}"
                await imessage_sender.send_status_update(phone_number, status_text, task_id)
            except Exception as e:
                logger.warning(f"Failed to send iMessage status update from worker: {e}")

        # Queen narration: fire on step 1 and every 3 steps
        if step_count == 1 or step_count % 3 == 0:
            asyncio.create_task(_broadcast_queen_commentary(
                agent_id, subtask.description, step_count, output_text[:200], task_id,
            ))

        dom_text = ""
        is_sensitive, reason = detect(output_text, current_url, dom_text)

        if is_sensitive:
            hitl_id = str(uuid.uuid4())[:8]
            logger.warning(f"HITL triggered for {agent_id}: {reason}")

            action_type = reason.split(":", 1)[0].strip()
            action_summary = (
                f"{action_type}\n"
                f"URL: {current_url or 'unknown'}\n\n"
                f"Agent output (truncated):\n{output_text[:800]}"
            )

            await ws_manager.broadcast(events.agent_status(
                agent_id, AgentStatusEnum.WAITING_HITL, step_count, task_id=task_id))
            await ws_manager.broadcast(events.hitl_request(
                agent_id, hitl_id, action_type,
                action_summary, current_url))

            try:
                audio = await elevenlabs_service.announce(
                    f"Agent {subtask_index + 1} needs your approval.")
                if audio:
                    await ws_manager.broadcast(events.voice_announcement(
                        f"Agent {subtask_index + 1} needs your approval.", audio))
            except Exception:
                pass

            event = asyncio.Event()
            async with _hitl_lock:
                hitl_events[hitl_id] = event

            resolution = {}
            try:
                # Wait at most 5 minutes; auto-reject on timeout
                await asyncio.wait_for(event.wait(), timeout=300)
                async with _hitl_lock:
                    resolution = hitl_resolutions.get(hitl_id, {})
            except asyncio.TimeoutError:
                logger.warning(
                    "HITL timeout for %s (hitl_id=%s) — auto-rejecting", agent_id, hitl_id
                )
                resolution = {"resolution": "rejected"}
            finally:
                async with _hitl_lock:
                    hitl_events.pop(hitl_id, None)
                    hitl_resolutions.pop(hitl_id, None)

            await ws_manager.broadcast(events.hitl_resolved(
                agent_id, hitl_id, resolution.get("resolution", "approved")))

            if resolution.get("resolution") == "rejected":
                raise Exception("Action rejected by user")

            await ws_manager.broadcast(events.agent_status(
                agent_id, AgentStatusEnum.RUNNING, step_count, task_id=task_id))

    try:
        task_with_context = subtask.description
        if memory is not None:
            ctx = await memory.get_context_summary()
            if ctx:
                task_with_context += f"\n\nShared context:\n{ctx}"

        await ws_manager.broadcast(events.agent_status(
            agent_id, AgentStatusEnum.RUNNING, task_id=task_id))

        agent = await browser_manager.create_agent(
            agent_id=agent_id,
            task=task_with_context,
            on_step_callback=on_step,
            start_url=subtask.url,
            cdp_url=cdp_url or None,
            cdp_target_id=cdp_target_id,
        )

        result_text = await browser_manager.run_agent(agent_id)

        sub_result = SubTaskResult(
            subtask_id=subtask.subtask_id,
            agent_id=agent_id,
            result=result_text,
            steps_taken=step_count,
            success=True,
        )
        if memory is not None:
            await memory.add_result(sub_result)

        await ws_manager.broadcast(events.agent_completed(
            agent_id, result_text, step_count, task_id=task_id))
        await ws_manager.broadcast(events.agent_status(
            agent_id, AgentStatusEnum.COMPLETED, task_id=task_id))

        try:
            audio = await elevenlabs_service.announce(
                f"Agent {subtask_index + 1} has completed its task.")
            if audio:
                await ws_manager.broadcast(events.voice_announcement(
                    f"Agent {subtask_index + 1} has completed its task.", audio))
        except Exception:
            pass

        return sub_result

    except Exception as e:
        error_msg = str(e) or f"{type(e).__name__} (no message)"
        logger.error("Worker %s failed: %s", agent_id, error_msg, exc_info=True)
        import traceback
        traceback.print_exc()

        if memory is not None:
            await memory.add_error(f"{agent_id}: {error_msg}")

        # Ask the Queen for guidance on failure
        guidance = await _query_queen(
            question=f"My agent encountered: {error_msg}. What should I do next?",
            context=f"Task: {subtask.description}. Tab: {subtask.url or 'none'}",
            agent_id=agent_id,
            task_id=task_id,
        )
        if guidance:
            await ws_manager.broadcast(events.agent_log(
                agent_id, f"Queen guidance: {guidance[:200]}", task_id=task_id))

        await ws_manager.broadcast(events.agent_failed(agent_id, error_msg, task_id=task_id))
        await ws_manager.broadcast(events.agent_status(
            agent_id, AgentStatusEnum.ERROR, task_id=task_id))

        return SubTaskResult(
            subtask_id=subtask.subtask_id,
            agent_id=agent_id,
            result=f"Error: {error_msg}",
            steps_taken=step_count,
            success=False,
        )

    finally:
        await browser_manager.stop_agent(agent_id)
        if tab_id:
            try:
                from services.tab_manager import tab_manager as tm
                await tm.unassign_agent(tab_id)
            except Exception:
                pass
        # Schedule log cleanup after 60s to avoid unbounded memory growth
        async def _cleanup_logs(aid: str, delay: float = 60.0):
            await asyncio.sleep(delay)
            agent_logs.pop(aid, None)
        asyncio.create_task(_cleanup_logs(agent_id))
