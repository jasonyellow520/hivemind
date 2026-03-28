import logging
import uuid
from datetime import datetime
from typing import Optional, List
from fastapi import APIRouter, HTTPException, BackgroundTasks, Request
from pydantic import BaseModel, Field
from services.websocket_manager import manager as ws_manager
from services import conversation_store
from services import imessage_sender

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/imessage", tags=["imessage"])


class MessageRequest(BaseModel):
    text: str
    to_phone: str = Field(..., pattern=r"^\+?[1-9]\d{1,14}$")
    from_phone: Optional[str] = Field(None, pattern=r"^\+?[1-9]\d{1,14}$")
    attachments: Optional[List[str]] = Field(default_factory=list)


class MessageResponse(BaseModel):
    message_id: str
    status: str
    timestamp: str


class WebhookMessage(BaseModel):
    text: str
    from_phone: str = Field(..., pattern=r"^\+?[1-9]\d{1,14}$")
    to_phone: str = Field(..., pattern=r"^\+?[1-9]\d{1,14}$")
    message_id: str
    timestamp: str
    attachments: Optional[List[dict]] = Field(default_factory=list)


class ConversationResponse(BaseModel):
    phone_number: str
    last_message: str
    last_timestamp: str
    message_count: int
    status: str


class ConversationListResponse(BaseModel):
    conversations: List[ConversationResponse]
    total: int


@router.post("/webhook", response_model=dict)
async def receive_message(webhook_data: WebhookMessage, background_tasks: BackgroundTasks):
    """
    Receive iMessage webhook from iMessage bridge.
    This endpoint is called by the iMessage bridge when a new message arrives.
    """
    try:
        logger.info(f"Received iMessage webhook: Message ID={webhook_data.message_id}, From={webhook_data.from_phone}, Text=\"{webhook_data.text}\"")
        
        # Store the message in conversation history
        await conversation_store.add_message(
            message_id=webhook_data.message_id,
            from_phone=webhook_data.from_phone,
            to_phone=webhook_data.to_phone,
            text=webhook_data.text,
            timestamp=datetime.fromisoformat(webhook_data.timestamp),
            direction="inbound",
            attachments=webhook_data.attachments
        )
        
        # Broadcast to WebSocket clients
        from models import events as evt
        await ws_manager.broadcast(evt.imessage_received(
            message_id=webhook_data.message_id,
            from_phone=webhook_data.from_phone,
            text=webhook_data.text,
        ))
        
        # Process message in background (trigger swarm if needed)
        background_tasks.add_task(_process_incoming_message, webhook_data)
        
        return {"status": "received", "message_id": webhook_data.message_id}
        
    except Exception as e:
        logger.error(f"Error processing iMessage webhook: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to process message: {str(e)}")


async def _process_incoming_message(message: WebhookMessage):
    """Process incoming iMessage through the LangGraph Dispatcher."""
    try:
        from mind.graph import build_hivemind_graph
        from services import conversation_store

        # Load conversation history for context
        history = await conversation_store.get_messages_by_conversation(
            message.from_phone, limit=10
        )

        graph = build_hivemind_graph()
        initial_state = {
            "message_id": message.message_id,
            "from_phone": message.from_phone,
            "to_phone": message.to_phone,
            "message_text": message.text,
            "conversation_history": history,
            "intent": "",
            "intent_confidence": 0.0,
            "task_id": "",
            "master_task": "",
            "subtasks": [],
            "worker_results": {},
            "final_result": "",
            "reply_text": "",
            "reply_sent": False,
            "phase": "received",
            "errors": [],
            "retry_count": 0,
        }

        result = await graph.ainvoke(initial_state)
        logger.info("Dispatcher completed for message %s: intent=%s, phase=%s",
                    message.message_id, result.get("intent"), result.get("phase"))

    except Exception as e:
        logger.error(f"Dispatcher failed for message {message.message_id}: {e}")
        # Fallback: try to send an error reply
        try:
            from services import imessage_sender
            await imessage_sender.send_imessage(
                to_phone=message.from_phone,
                text="Sorry, I had trouble processing that. Please try again.",
            )
        except Exception:
            pass


@router.post("/send", response_model=MessageResponse)
async def send_message(message_request: MessageRequest):
    """
    Send an iMessage through the iMessage bridge.
    """
    try:
        message_id = str(uuid.uuid4())
        
        # Send message through iMessage bridge
        result = await imessage_sender.send_imessage(
            to_phone=message_request.to_phone,
            text=message_request.text,
            from_phone=message_request.from_phone,
            attachments=message_request.attachments
        )
        
        if result.get("success"):
            # Store outbound message in conversation history
            await conversation_store.add_message(
                message_id=message_id,
                from_phone=message_request.from_phone or "system",
                to_phone=message_request.to_phone,
                text=message_request.text,
                timestamp=datetime.utcnow(),
                direction="outbound",
                attachments=message_request.attachments
            )
            
            # Broadcast send status
            from models import events as evt
            await ws_manager.broadcast(evt.imessage_sent(
                message_id=message_id,
                to_phone=message_request.to_phone,
                text=message_request.text,
            ))
            
            return MessageResponse(
                message_id=message_id,
                status="sent",
                timestamp=datetime.utcnow().isoformat()
            )
        else:
            raise HTTPException(status_code=500, detail=f"Failed to send message: {result.get('error', 'Unknown error')}")
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error sending iMessage: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to send message: {str(e)}")


@router.get("/conversations", response_model=ConversationListResponse)
async def get_conversations(limit: int = 50, offset: int = 0):
    """
    Get list of conversations with recent messages.
    """
    try:
        conversations = await conversation_store.get_conversations(limit=limit, offset=offset)
        
        return ConversationListResponse(
            conversations=[
                ConversationResponse(
                    phone_number=conv["phone_number"],
                    last_message=conv["last_message"],
                    last_timestamp=conv["last_timestamp"].isoformat(),
                    message_count=conv["message_count"],
                    status=conv["status"]
                )
                for conv in conversations
            ],
            total=len(conversations)
        )
        
    except Exception as e:
        logger.error(f"Error retrieving conversations: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to retrieve conversations: {str(e)}")


@router.get("/conversations/{phone_number}/messages")
async def get_conversation_messages(phone_number: str, limit: int = 100, before_timestamp: Optional[str] = None):
    """
    Get messages for a specific conversation.
    """
    try:
        before_dt = None
        if before_timestamp:
            before_dt = datetime.fromisoformat(before_timestamp)
            
        messages = await conversation_store.get_messages_by_conversation(
            phone_number=phone_number,
            limit=limit,
            before_timestamp=before_dt
        )
        
        return {
            "phone_number": phone_number,
            "messages": [
                {
                    "message_id": msg["message_id"],
                    "text": msg["text"],
                    "direction": msg["direction"],
                    "timestamp": msg["timestamp"].isoformat(),
                    "attachments": msg.get("attachments", [])
                }
                for msg in messages
            ],
            "total": len(messages)
        }
        
    except Exception as e:
        logger.error(f"Error retrieving conversation messages: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to retrieve messages: {str(e)}")


@router.post("/conversations/{phone_number}/status")
async def update_conversation_status(phone_number: str, status: dict):
    """
    Update conversation status (for internal use by other services).
    """
    try:
        await conversation_store.update_conversation_status(phone_number, status.get("status", "active"))
        return {"status": "updated", "phone_number": phone_number}
        
    except Exception as e:
        logger.error(f"Error updating conversation status: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to update status: {str(e)}")


class ScreenshotRequest(BaseModel):
    to_phone: str = Field(..., pattern=r"^\+?[1-9]\d{1,14}$")
    screenshot_data: str  # Base64 encoded or file path
    caption: Optional[str] = None


@router.post("/send_screenshot", response_model=MessageResponse)
async def send_screenshot(request: ScreenshotRequest):
    """
    Send a screenshot as an iMessage attachment.
    """
    try:
        result = await imessage_sender.send_screenshot(
            to_phone=request.to_phone,
            screenshot_data=request.screenshot_data,
            caption=request.caption
        )
        
        if result.get("success"):
            return MessageResponse(
                message_id=result.get("message_id", ""),
                status="sent",
                timestamp=result.get("timestamp", datetime.utcnow().isoformat())
            )
        else:
            raise HTTPException(status_code=500, detail=f"Failed to send screenshot: {result.get('error', 'Unknown error')}")
            
    except Exception as e:
        logger.error(f"Error sending screenshot: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/health")
async def health_check():
    """Health check endpoint for iMessage service."""
    try:
        # Check if conversation store is accessible
        await conversation_store.health_check()
        
        # Check if iMessage sender service is available
        sender_status = await imessage_sender.health_check()
        
        return {
            "status": "healthy" if sender_status.get("healthy") else "degraded",
            "conversation_store": "connected",
            "imessage_bridge": sender_status.get("status", "unknown"),
            "timestamp": datetime.utcnow().isoformat()
        }
        
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        return {
            "status": "unhealthy",
            "error": str(e),
            "timestamp": datetime.utcnow().isoformat()
        }