"""
Unified input endpoint.

Single entry point for the web dashboard CommandBar.
Routes all input through the MiniMax orchestrator.
Returns SSE stream for real-time responses.
"""

import json
import logging
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from mind.orchestrator import process

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/input", tags=["input"])

# Shared conversation history for web dashboard sessions
_conversation_history: list[dict] = []


class InputMessage(BaseModel):
    message: str


@router.post("/")
async def unified_input(msg: InputMessage):
    """Unified SSE endpoint -- all web dashboard input goes here."""
    _conversation_history.append({"role": "user", "content": msg.message})

    async def generate():
        full_reply = ""
        try:
            async for event in process(
                text=msg.message,
                conversation_history=_conversation_history,
                source="web",
            ):
                if event["type"] == "text":
                    chunk = event["content"]
                    full_reply += chunk
                    yield f"data: {json.dumps({'type': 'text', 'text': chunk})}\n\n"

                elif event["type"] == "task_dispatched":
                    task_id = event["task_id"]
                    message = event["message"]
                    full_reply = message
                    yield f"data: {json.dumps({'type': 'task_dispatched', 'task_id': task_id, 'text': message})}\n\n"

                elif event["type"] == "done":
                    yield "data: [DONE]\n\n"

        except Exception as e:
            logger.error("Unified input stream error: %s", e)
            error_msg = f"Error: {str(e)}"
            full_reply = error_msg
            yield f"data: {json.dumps({'type': 'text', 'text': error_msg})}\n\n"
            yield "data: [DONE]\n\n"

        if full_reply:
            _conversation_history.append({"role": "assistant", "content": full_reply})

        # Save to supermemory
        try:
            from services import supermemory_service
            await supermemory_service.save_chat_exchange(msg.message, full_reply)
        except Exception:
            pass

    return StreamingResponse(generate(), media_type="text/event-stream")


@router.delete("/history")
async def clear_history():
    """Clear the web conversation history."""
    _conversation_history.clear()
    return {"status": "cleared"}
