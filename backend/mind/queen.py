import asyncio
import itertools
import uuid
import logging
from typing import Optional
from models.task import SubTask, TaskRequest, TaskResponse, TaskStatus
from models import events
from mind.memory import create_memory, get_memory, get_active_memory, SharedMindMemory
from mind.worker import run_worker
from services.mistral_client import queen_decompose, queen_chat
from services.browser_manager import browser_manager
from services.tab_manager import CDP_DEFAULT_URL
from services.websocket_manager import manager as ws_manager
from services import elevenlabs_service
from services import supermemory_service
from services import imessage_sender
from services import conversation_store

logger = logging.getLogger(__name__)

# Thread-safe global agent counter using itertools.count()
_global_agent_counter = itertools.count(1)


def _next_global_index() -> int:
    return next(_global_agent_counter)


def _url_domain(url: Optional[str]) -> Optional[str]:
    """Extract hostname (domain) from URL for matching. Returns None for blank/invalid."""
    if not url or url.strip() in ("", "about:blank"):
        return None
    try:
        from urllib.parse import urlparse
        parsed = urlparse(url if "://" in url else f"https://{url}")
        host = (parsed.netloc or parsed.path or "").strip().lower()
        if host and host != "about":
            return host.replace("www.", "", 1) if host.startswith("www.") else host
    except Exception:
        pass
    return None


async def answer_query(
    question: str,
    context: str,
    agent_id: str,
    memory: Optional[SharedMindMemory] = None,
    task_id: str = "",
) -> str:
    """Answer a question from a worker agent using the Queen's LLM and shared memory.

    Prefers looking up memory by task_id; falls back to the supplied memory object
    or the global active memory for backward compatibility.
    """
    try:
        # Prefer task-specific memory lookup
        if task_id:
            resolved_memory = get_memory(task_id) or memory or get_active_memory()
        else:
            resolved_memory = memory or get_active_memory()

        if resolved_memory is not None:
            mem_summary = await resolved_memory.get_context_summary()
        else:
            mem_summary = "No active task memory."

        prompt = f"""Current task memory:
{mem_summary}

Worker agent {agent_id} is asking for guidance:
Question: {question}

Agent context:
{context}

Provide a concise, actionable answer. Be direct."""

        return await queen_chat(
            user_message=prompt,
            system_prompt="You are the MIND orchestrator — master controller of a multi-agent browser automation system.",
            temperature=0.2,
            max_output_tokens=512,
        )
    except Exception as e:
        logger.error(f"Queen answer_query failed: {e}")
        return ""


async def _provision_tabs_for_subtasks(
    subtasks: list[SubTask],
    tab_hints: Optional[list[Optional[str]]] = None,
) -> list[tuple[SubTask, str, Optional[str], Optional[str]]]:
    """Assign Chrome tabs for each subtask using smart matching.
    Priority: (1) Queen's tab_hint match, (2) same-domain tab, (3) about:blank, (4) open new tab.
    Returns list of (subtask, tab_id, cdp_url, cdp_target_id)."""
    from services.tab_manager import tab_manager as tm

    if not tm.is_cdp_connected():
        return [(st, "", None, None) for st in subtasks]

    cdp_http = CDP_DEFAULT_URL
    all_tabs = await tm.get_all_tabs()
    free_tabs = [t for t in all_tabs if not t.assigned_agent_id]

    needed = max(0, len(subtasks) - len(free_tabs))
    if needed > 0:
        logger.info("Opening %s new Chrome tab(s) for agents", needed)
        new_tabs = await asyncio.gather(
            *[tm.open_tab("about:blank") for _ in range(needed)],
            return_exceptions=True,
        )
        for t in new_tabs:
            if not isinstance(t, Exception):
                free_tabs.append(t)

    hints = tab_hints or [None] * len(subtasks)
    result: list[tuple[SubTask, str, Optional[str], Optional[str]]] = []

    for idx, subtask in enumerate(subtasks):
        tab = None
        hint = hints[idx] if idx < len(hints) else None
        hint_domain = _url_domain(hint)
        want_domain = hint_domain or _url_domain(subtask.url)

        # 1. Match by Queen's tab_hint (exact URL match first)
        if hint:
            for i, t in enumerate(free_tabs):
                if t.url and t.url.strip() == hint.strip():
                    tab = free_tabs.pop(i)
                    logger.info("Tab matched by hint URL: %s", hint[:60])
                    break

        # 2. Match by domain
        if tab is None and want_domain:
            for i, t in enumerate(free_tabs):
                if _url_domain(t.url) == want_domain:
                    tab = free_tabs.pop(i)
                    logger.info("Tab matched by domain: %s", want_domain)
                    break

        # 3. Prefer about:blank over hijacking unrelated tabs
        if tab is None:
            blank_idx = next(
                (i for i, t in enumerate(free_tabs) if (t.url or "").strip() in ("", "about:blank")),
                None,
            )
            if blank_idx is not None:
                tab = free_tabs.pop(blank_idx)
            elif free_tabs:
                tab = free_tabs.pop(0)

        if tab:
            if subtask.url and subtask.url not in ("about:blank", ""):
                asyncio.create_task(tm.navigate_tab(tab.tab_id, subtask.url))
            agent_id = f"worker-{subtask.subtask_id}"
            await tm.assign_agent(tab.tab_id, agent_id)
            target_id = tm.get_cdp_target_id(tab.tab_id)
            result.append((subtask, tab.tab_id, cdp_http, target_id))
        else:
            result.append((subtask, "", cdp_http, None))

    try:
        from services.websocket_manager import manager as _ws
        from models.events import WSEvent, EventType
        tabs_data = [t.model_dump() for t in await tm.get_all_tabs()]
        await _ws.broadcast(WSEvent(
            type=EventType.TABS_UPDATE,
            data={"tabs": tabs_data, "cdp_connected": True},
        ))
    except Exception:
        pass

    return result


async def execute_task(request: TaskRequest, task_id: str | None = None) -> TaskResponse:
    task_id = task_id or str(uuid.uuid4())[:8]
    # Each task gets its own isolated memory — no global reset
    memory = create_memory(task_id, request.task, request.context or "")

    logger.info(f"Task {task_id}: Decomposing '{request.task[:60]}'")

    open_tabs: Optional[list[str]] = None
    try:
        from services.tab_manager import tab_manager as _tm
        if _tm.is_cdp_connected():
            open_tabs = [t.url for t in await _tm.get_all_tabs() if t.url and t.url.strip() not in ("", "about:blank")]
    except Exception:
        pass

    memory_context = ""
    try:
        memories = await supermemory_service.search_memory(request.task, limit=3)
        if memories:
            snippets = []
            for m in memories:
                text = m.get("summary") or m.get("content") or ""
                if text:
                    snippets.append(text[:300])
            if snippets:
                memory_context = "Relevant past memories:\n" + "\n---\n".join(snippets)
    except Exception as e:
        logger.debug("Supermemory search skipped: %s", e)

    combined_context = request.context or ""
    if memory_context:
        combined_context = f"{combined_context}\n\n{memory_context}" if combined_context else memory_context

    raw_subtasks = await queen_decompose(request.task, combined_context, open_tabs=open_tabs)

    logger.info("Queen returned %d subtask(s) for: %s", len(raw_subtasks), request.task[:80])
    for i, raw in enumerate(raw_subtasks):
        logger.info("  agent[%d]: %s | url=%s | tab_hint=%s",
                     i, raw.get("description", "")[:80], raw.get("url"), raw.get("tab_hint"))

    # Structural guardrail: collapse to 1 subtask if no parallel markers in the user's task
    if len(raw_subtasks) > 1:
        task_lower = request.task.lower()
        has_parallel = any(m in task_lower for m in [" and ", " & ", " also ", " plus ", " simultaneously", " in parallel", " at the same time", "compare", " both ", " each ", " multiple ", " different "])
        if not has_parallel:
            logger.warning("Collapsing %d subtasks to 1 (no parallel markers in task)", len(raw_subtasks))
            raw_subtasks = [raw_subtasks[0]]

    # Deduplicate: merge subtasks targeting the same domain into one agent
    if len(raw_subtasks) > 1:
        seen_domains: dict[str, int] = {}
        deduped: list[dict] = []
        for raw in raw_subtasks:
            domain = _url_domain(raw.get("url"))
            if domain and domain in seen_domains:
                existing_idx = seen_domains[domain]
                existing_desc = deduped[existing_idx].get("description", "")
                new_desc = raw.get("description", "")
                deduped[existing_idx]["description"] = f"{existing_desc}\nThen also: {new_desc}"
                logger.warning("Merged duplicate domain %s into agent %d", domain, existing_idx)
            else:
                if domain:
                    seen_domains[domain] = len(deduped)
                deduped.append(raw)
        if len(deduped) < len(raw_subtasks):
            logger.info("Deduped %d → %d subtasks (merged same-domain)", len(raw_subtasks), len(deduped))
            raw_subtasks = deduped

    subtasks = []
    tab_hints: list[Optional[str]] = []
    for raw in raw_subtasks:
        raw_deps = raw.get("depends_on", [])
        if not isinstance(raw_deps, list):
            raw_deps = []
        deps = [str(d) for d in raw_deps]

        desc = raw.get("description", "")
        if isinstance(desc, list):
            desc = "\n".join(str(s) for s in desc)

        st = SubTask(
            description=desc,
            url=raw.get("url"),
            depends_on=deps,
            priority=raw.get("priority", 1),
        )
        subtasks.append(st)
        tab_hints.append(raw.get("tab_hint"))

    agent_count = len(subtasks)
    await ws_manager.broadcast(events.task_accepted(task_id, agent_count))
    logger.info("Deploying %d agent(s) for task %s", agent_count, task_id)

    # Check if this task is associated with an iMessage conversation
    phone_number = await conversation_store.get_phone_number_for_task(task_id)
    if phone_number:
        try:
            await imessage_sender.send_status_update(
                to_phone=phone_number,
                status_text=f"🚀 Starting task with {agent_count} agent(s)...",
                task_id=task_id
            )
        except Exception as e:
            logger.warning(f"Failed to send iMessage status update: {e}")

    try:
        word = "agent" if agent_count == 1 else "agents"
        audio = await elevenlabs_service.announce(f"Mind activated. Deploying {agent_count} {word}.")
        if audio:
            await ws_manager.broadcast(events.voice_announcement(
                f"Mind activated. Deploying {agent_count} {word}.", audio))
    except Exception:
        pass

    # --- DAG-aware execution: launch tasks as their dependencies complete ---
    all_hints = {subtasks[i].subtask_id: tab_hints[i] for i in range(len(subtasks))}
    completed_ids: set[str] = set()
    all_results: list = []
    running: dict[str, asyncio.Task] = {}  # subtask_id -> asyncio.Task
    pending_ids = {st.subtask_id for st in subtasks}

    async def _launch_ready():
        """Find subtasks whose deps are satisfied and launch them."""
        ready = [
            st for st in subtasks
            if st.subtask_id in pending_ids
            and st.subtask_id not in running
            and all(d in completed_ids for d in st.depends_on)
        ]
        if not ready:
            return
        hints_for_ready = [all_hints.get(st.subtask_id) for st in ready]
        mappings = await _provision_tabs_for_subtasks(ready, tab_hints=hints_for_ready)
        for st, tab_id, cdp_url, cdp_target_id in mappings:
            gidx = _next_global_index()
            t = asyncio.create_task(
                run_worker(
                    st, subtasks.index(st), tab_id=tab_id, cdp_url=cdp_url or "",
                    cdp_target_id=cdp_target_id, task_id=task_id, global_index=gidx,
                )
            )
            browser_manager.register_task(f"worker-{st.subtask_id}", t)
            running[st.subtask_id] = t
            pending_ids.discard(st.subtask_id)

    await _launch_ready()

    while running:
        done, _ = await asyncio.wait(running.values(), return_when=asyncio.FIRST_COMPLETED)
        for task_obj in done:
            sid = next(k for k, v in running.items() if v is task_obj)
            del running[sid]
            completed_ids.add(sid)
            try:
                all_results.append(task_obj.result())
            except Exception as exc:
                all_results.append(exc)
        # Launch any newly unblocked tasks
        await _launch_ready()

    results = all_results

    successful = []
    failed = []
    for r in results:
        if isinstance(r, Exception):
            failed.append(str(r))
        elif r.success:
            successful.append(r)
        else:
            failed.append(r.result)

    status = TaskStatus.COMPLETED if successful else TaskStatus.FAILED

    if successful:
        agent_outputs = "\n\n".join([
            f"Agent {r.subtask_id} ({r.steps_taken} steps):\n{r.result}"
            for r in successful
        ])
        # Orchestrator synthesizes the agent results into a user-facing response
        final_result = await _synthesize_results(request.task, agent_outputs)
    else:
        final_result = "All agents failed: " + "; ".join(failed)

    agent_results_data = [
        {
            "agent_id": r.agent_id,
            "subtask_id": r.subtask_id,
            "result": r.result,
            "steps_taken": r.steps_taken,
        }
        for r in successful
    ]
    await ws_manager.broadcast(events.task_complete(
        task_id, final_result,
        agent_results=agent_results_data,
        master_task=request.task,
    ))

    try:
        await supermemory_service.save_task_execution(
            task=request.task,
            result=final_result,
            agent_count=agent_count,
            task_id=task_id,
        )
    except Exception as e:
        logger.warning("Supermemory save failed (non-blocking): %s", e)

    # Send final iMessage update if applicable
    if phone_number:
        try:
            summary = f"✅ Task complete: {final_result[:500]}"
            await imessage_sender.send_status_update(
                to_phone=phone_number,
                status_text=summary,
                task_id=task_id
            )
        except Exception as e:
            logger.warning(f"Failed to send final iMessage update: {e}")

    try:
        audio = await elevenlabs_service.announce("Task complete. Results are ready.")
        if audio:
            await ws_manager.broadcast(events.voice_announcement(
                "Task complete. Results are ready.", audio))
    except Exception:
        pass

    return TaskResponse(
        task_id=task_id,
        status=status,
        subtasks=subtasks,
        results=list(successful),
        final_result=final_result,
    )


async def _synthesize_results(original_task: str, agent_outputs: str) -> str:
    """Queen synthesizes raw agent outputs into a clean response for the user."""
    try:
        result = await queen_chat(
            user_message=f"Original request: {original_task}\n\nAgent results:\n{agent_outputs}",
            system_prompt=(
                "You are the Mind orchestrator. Your agents have completed their browser tasks. "
                "Synthesize the raw agent outputs into a clear, well-formatted response that directly "
                "answers the user's original request. Be concise. Use markdown formatting."
            ),
            temperature=0.3,
            max_output_tokens=2048,
        )
        return result or agent_outputs
    except Exception as e:
        logger.error("Failed to synthesize results: %s", e)
        return agent_outputs


async def execute_tab_tasks(tabs_with_instructions: list, global_task: str = ""):
    """Execute per-tab instructions in parallel. Each tab gets its own worker."""
    from services.tab_manager import tab_manager as tm

    task_id = str(uuid.uuid4())[:8]
    tab_count = len(tabs_with_instructions)

    # Use create_memory instead of global reset for task isolation
    create_memory(task_id, global_task or "Tab-based parallel execution")

    await ws_manager.broadcast(events.task_accepted(task_id, tab_count))

    try:
        audio = await elevenlabs_service.announce(
            f"Mind activated. Executing on {tab_count} tabs in parallel.")
        if audio:
            await ws_manager.broadcast(events.voice_announcement(
                f"Mind activated. Executing on {tab_count} tabs in parallel.", audio))
    except Exception:
        pass

    subtasks = []
    for tab in tabs_with_instructions:
        url = tab.url if hasattr(tab, "url") else ""
        instruction = tab.instruction if hasattr(tab, "instruction") else str(tab)
        tab_id = tab.tab_id if hasattr(tab, "tab_id") else ""

        task_desc = instruction
        if url and url != "about:blank":
            task_desc = f"On the page at {url}: {instruction}"

        st = SubTask(
            description=task_desc,
            url=url if url != "about:blank" else None,
        )
        cdp_url = CDP_DEFAULT_URL if tm.is_cdp_connected() else None
        cdp_target_id = tm.get_cdp_target_id(tab_id) if tab_id else None
        logger.info("Tab task: tab_id=%s cdp_url=%s cdp_target_id=%s task=%s",
                     tab_id, cdp_url, cdp_target_id, task_desc[:80])
        subtasks.append((st, tab_id, cdp_url, cdp_target_id))

    worker_tasks = []
    for i, (st, tab_id, cdp_url, cdp_target_id) in enumerate(subtasks):
        worker_tasks.append(
            run_worker(st, i, tab_id=tab_id, cdp_url=cdp_url, cdp_target_id=cdp_target_id, task_id=task_id)
        )

    results = await asyncio.gather(*worker_tasks, return_exceptions=True)

    successful = []
    failed_list = []
    for r in results:
        if isinstance(r, Exception):
            failed_list.append(str(r))
        elif r.success:
            successful.append(r)
        else:
            failed_list.append(r.result)

    if successful:
        final_result = "\n\n".join([
            f"**Tab agent {r.subtask_id}** ({r.steps_taken} steps):\n{r.result}"
            for r in successful
        ])
    else:
        final_result = "All tab agents failed: " + "; ".join(failed_list)

    await ws_manager.broadcast(events.task_complete(task_id, final_result))

    try:
        audio = await elevenlabs_service.announce("All tab tasks complete. Results are ready.")
        if audio:
            await ws_manager.broadcast(events.voice_announcement(
                "All tab tasks complete. Results are ready.", audio))
    except Exception:
        pass
