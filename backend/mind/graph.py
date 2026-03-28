import asyncio
import uuid
import logging
from langgraph.graph import StateGraph, END
from mind.state import MindState, HiveMindState
from mind.queen import execute_task
from models.task import TaskRequest

logger = logging.getLogger(__name__)

MAX_RETRIES = 1

# ──────────────────────────────────────────────
# Existing MindGraph nodes (web CommandBar flow)
# ──────────────────────────────────────────────


async def queen_plan(state: MindState) -> MindState:
    state["phase"] = "planning"
    logger.info(f"Queen planning: {state['master_task'][:60]}")
    return state


async def dispatch_workers(state: MindState) -> MindState:
    state["phase"] = "dispatching"
    request = TaskRequest(task=state["master_task"])
    result = await execute_task(request)

    state["subtasks"] = [st.model_dump() for st in result.subtasks]
    state["worker_results"] = {r.agent_id: r.result for r in result.results}
    state["final_result"] = result.final_result or ""
    state["errors"] = [r.result for r in result.results if not r.success]
    return state


async def monitor_workers(state: MindState) -> MindState:
    state["phase"] = "monitoring"
    has_errors = bool(state.get("errors"))
    has_results = bool(state.get("worker_results"))

    if has_results and not has_errors:
        state["phase"] = "all_complete"
    elif has_errors:
        state["phase"] = "has_failures"
    else:
        state["phase"] = "all_complete"

    return state


def should_continue(state: MindState) -> str:
    if state.get("phase") == "has_failures":
        return "handle_failure"
    return "aggregate"


async def aggregate(state: MindState) -> MindState:
    state["phase"] = "completed"
    logger.info("All workers completed, aggregating results")
    return state


def should_retry(state: MindState) -> str:
    retry_count = state.get("_retry_count", 0)
    if retry_count < MAX_RETRIES and state.get("errors"):
        return "retry"
    return "abort"


async def handle_failure(state: MindState) -> MindState:
    retry_count = state.get("_retry_count", 0)
    state["_retry_count"] = retry_count + 1
    state["phase"] = "handling_failure"
    logger.error(f"Task failed (attempt {retry_count + 1}): {state['errors']}")
    return state


def build_mind_graph():
    graph = StateGraph(MindState)

    graph.add_node("queen_plan", queen_plan)
    graph.add_node("dispatch_workers", dispatch_workers)
    graph.add_node("monitor_workers", monitor_workers)
    graph.add_node("aggregate", aggregate)
    graph.add_node("handle_failure", handle_failure)

    graph.set_entry_point("queen_plan")
    graph.add_edge("queen_plan", "dispatch_workers")
    graph.add_edge("dispatch_workers", "monitor_workers")

    graph.add_conditional_edges("monitor_workers", should_continue, {
        "aggregate": "aggregate",
        "handle_failure": "handle_failure",
    })

    graph.add_conditional_edges("handle_failure", should_retry, {
        "retry": "dispatch_workers",
        "abort": "aggregate",
    })

    graph.add_edge("aggregate", END)

    return graph.compile()


# ──────────────────────────────────────────────
# HiveMind Graph nodes (iMessage Dispatcher flow)
# ──────────────────────────────────────────────

async def receive_message(state: HiveMindState) -> HiveMindState:
    """Load conversation history and prepare message for processing."""
    state["phase"] = "received"
    logger.info("Dispatcher received message from %s: %s",
                state["from_phone"], state["message_text"][:60])
    return state


async def classify_intent(state: HiveMindState) -> HiveMindState:
    """Use MiniMax to classify the user's intent."""
    from services.minimax_client import classify_intent as _classify

    result = await _classify(
        state["message_text"],
        state.get("conversation_history", []),
    )
    state["intent"] = result["intent"]
    state["intent_confidence"] = result["confidence"]

    if result.get("extracted_task"):
        state["master_task"] = result["extracted_task"]

    state["phase"] = "classified"
    logger.info("Intent classified: %s (%.2f) for message: %s",
                state["intent"], state["intent_confidence"],
                state["message_text"][:60])
    return state


def route_intent(state: HiveMindState) -> str:
    """Route based on classified intent."""
    intent = state.get("intent", "unclear")
    if intent == "browser_task":
        return "dispatch_queen"
    elif intent == "status_query":
        return "query_status"
    elif intent == "chat":
        return "chat_respond"
    return "clarify"


async def chat_respond(state: HiveMindState) -> HiveMindState:
    """Generate a conversational reply, with swarm status if active."""
    from services.minimax_client import quick_answer, chat_with_context

    # Check if there's an active swarm
    swarm_status = ""
    try:
        from routers.tasks import _running_tasks
        if _running_tasks:
            active = [f"Task {tid}: {status}"
                      for tid, status in _running_tasks.items()]
            swarm_status = "\n".join(active)
    except Exception:
        pass

    if swarm_status:
        reply = await chat_with_context(
            state["message_text"],
            state.get("conversation_history", []),
            swarm_status,
        )
    else:
        reply = await quick_answer(
            state["message_text"],
            state.get("conversation_history", []),
        )

    state["reply_text"] = reply
    state["phase"] = "replied"
    return state


async def dispatch_queen_node(state: HiveMindState) -> HiveMindState:
    """Dispatch the browser task to the Queen for decomposition and execution."""
    task_text = state.get("master_task") or state["message_text"]
    task_id = state.get("task_id") or str(uuid.uuid4())[:8]
    state["task_id"] = task_id

    # Associate task with phone number for status updates
    try:
        from services import conversation_store
        await conversation_store.associate_task_with_conversation(
            task_id, state["from_phone"]
        )
    except Exception as e:
        logger.warning("Failed to associate task with conversation: %s", e)

    # Send "starting" message
    try:
        from services import imessage_sender
        await imessage_sender.send_status_update(
            to_phone=state["from_phone"],
            status_text=f"Got it! Working on: {task_text[:100]}",
            task_id=task_id,
        )
    except Exception:
        pass

    # Execute via Queen
    request = TaskRequest(task=task_text, context=f"Request from iMessage user {state['from_phone']}")
    result = await execute_task(request, task_id=task_id)

    state["subtasks"] = [st.model_dump() for st in result.subtasks]
    state["worker_results"] = {r.agent_id: r.result for r in result.results}
    state["final_result"] = result.final_result or ""
    state["errors"] = [r.result for r in result.results if not r.success]

    # Synthesize results for iMessage
    if result.final_result:
        try:
            from services.minimax_client import synthesize_results
            state["reply_text"] = await synthesize_results(task_text, result.final_result)
        except Exception:
            state["reply_text"] = result.final_result
    else:
        state["reply_text"] = "Sorry, the task didn't produce results. " + "; ".join(state["errors"][:2])

    state["phase"] = "task_complete"
    return state


async def query_status(state: HiveMindState) -> HiveMindState:
    """Look up active/completed tasks and format a status reply."""
    status_parts = []

    try:
        from routers.tasks import _running_tasks, active_tasks
        if _running_tasks:
            for tid, status in _running_tasks.items():
                status_parts.append(f"Task {tid}: {status}")

        if active_tasks:
            completed = [(tid, resp) for tid, resp in active_tasks.items()
                        if resp.status == "completed"]
            for tid, resp in completed[-3:]:
                result = (resp.final_result or "")[:100]
                status_parts.append(f"Completed {tid}: {result}")
    except Exception:
        pass

    if status_parts:
        state["reply_text"] = "Here's what's happening:\n" + "\n".join(status_parts)
    else:
        state["reply_text"] = "No active tasks right now. Send me something to work on!"

    state["phase"] = "status_replied"
    return state


async def clarify(state: HiveMindState) -> HiveMindState:
    """Ask the user for clarification."""
    state["reply_text"] = (
        "I'm not sure what you'd like me to do. I can:\n"
        "- Search the web or compare prices\n"
        "- Fill out forms or book things\n"
        "- Check on running tasks\n"
        "What would you like?"
    )
    state["phase"] = "clarification"
    return state


async def send_reply(state: HiveMindState) -> HiveMindState:
    """Send the reply back via iMessage."""
    reply_text = state.get("reply_text", "")
    if not reply_text:
        return state

    try:
        from services import imessage_sender
        await imessage_sender.send_imessage(
            to_phone=state["from_phone"],
            text=reply_text,
        )
        state["reply_sent"] = True
        logger.info("Reply sent to %s: %s", state["from_phone"], reply_text[:60])
    except Exception as e:
        logger.error("Failed to send iMessage reply: %s", e)
        state["reply_sent"] = False

    # Store outbound message
    try:
        from services import conversation_store
        from datetime import datetime
        await conversation_store.add_message(
            message_id=f"reply-{state.get('message_id', 'unknown')}",
            from_phone="system",
            to_phone=state["from_phone"],
            text=reply_text,
            timestamp=datetime.utcnow(),
            direction="outbound",
        )
    except Exception:
        pass

    return state


def build_hivemind_graph():
    """Build the iMessage Dispatcher graph: classify -> route -> respond."""
    graph = StateGraph(HiveMindState)

    graph.add_node("receive_message", receive_message)
    graph.add_node("classify_intent", classify_intent)
    graph.add_node("chat_respond", chat_respond)
    graph.add_node("dispatch_queen", dispatch_queen_node)
    graph.add_node("query_status", query_status)
    graph.add_node("clarify", clarify)
    graph.add_node("send_reply", send_reply)

    graph.set_entry_point("receive_message")
    graph.add_edge("receive_message", "classify_intent")

    graph.add_conditional_edges("classify_intent", route_intent, {
        "chat_respond": "chat_respond",
        "dispatch_queen": "dispatch_queen",
        "query_status": "query_status",
        "clarify": "clarify",
    })

    graph.add_edge("chat_respond", "send_reply")
    graph.add_edge("dispatch_queen", "send_reply")
    graph.add_edge("query_status", "send_reply")
    graph.add_edge("clarify", "send_reply")
    graph.add_edge("send_reply", END)

    return graph.compile()
