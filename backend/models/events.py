from pydantic import BaseModel, Field
from typing import Optional, Any
from enum import Enum
from datetime import datetime


class EventType(str, Enum):
    TASK_ACCEPTED = "TASK_ACCEPTED"
    TASK_FAILED = "TASK_FAILED"
    AGENT_SPAWNED = "AGENT_SPAWNED"
    AGENT_STATUS = "AGENT_STATUS"
    AGENT_LOG = "AGENT_LOG"
    AGENT_COMPLETED = "AGENT_COMPLETED"
    AGENT_FAILED = "AGENT_FAILED"
    HITL_REQUEST = "HITL_REQUEST"
    HITL_RESOLVED = "HITL_RESOLVED"
    TABS_UPDATE = "TABS_UPDATE"
    TASK_COMPLETE = "TASK_COMPLETE"
    VOICE_ANNOUNCEMENT = "VOICE_ANNOUNCEMENT"
    QUEEN_COMMENTARY = "QUEEN_COMMENTARY"
    IMESSAGE_RECEIVED = "IMESSAGE_RECEIVED"
    IMESSAGE_SENT = "IMESSAGE_SENT"
    IMESSAGE_STATUS_UPDATE = "IMESSAGE_STATUS_UPDATE"
    PING = "PING"


class WSEvent(BaseModel):
    type: EventType
    data: dict[str, Any]
    timestamp: str = Field(default_factory=lambda: datetime.utcnow().isoformat())


def task_accepted(task_id: str, subtask_count: int) -> WSEvent:
    return WSEvent(type=EventType.TASK_ACCEPTED, data={"task_id": task_id, "subtask_count": subtask_count})


def task_failed(task_id: str, error: str, master_task: str = "") -> WSEvent:
    return WSEvent(type=EventType.TASK_FAILED, data={
        "task_id": task_id,
        "error": error,
        "master_task": master_task,
    })


def agent_spawned(
    agent_id: str,
    task_description: str,
    subtask_index: int,
    tab_id: Optional[str] = None,
    task_id: str = "",
    global_index: int = 0,
) -> WSEvent:
    return WSEvent(type=EventType.AGENT_SPAWNED, data={
        "agent_id": agent_id,
        "task_description": task_description,
        "subtask_index": subtask_index,
        "tab_id": tab_id,
        "task_id": task_id,
        "global_index": global_index,
    })


def agent_status(agent_id: str, status: str, step: int = 0, task_id: str = "") -> WSEvent:
    return WSEvent(type=EventType.AGENT_STATUS, data={
        "agent_id": agent_id,
        "status": status,
        "step": step,
        "task_id": task_id,
    })


def agent_log(
    agent_id: str,
    message: str,
    url: str = "",
    action: str = "",
    task_id: str = "",
) -> WSEvent:
    return WSEvent(type=EventType.AGENT_LOG, data={
        "agent_id": agent_id,
        "message": message,
        "url": url,
        "action": action,
        "task_id": task_id,
    })


def agent_completed(agent_id: str, result: str, steps_taken: int, task_id: str = "") -> WSEvent:
    return WSEvent(type=EventType.AGENT_COMPLETED, data={
        "agent_id": agent_id,
        "result": result,
        "steps_taken": steps_taken,
        "task_id": task_id,
    })


def agent_failed(agent_id: str, error: str, task_id: str = "") -> WSEvent:
    return WSEvent(type=EventType.AGENT_FAILED, data={
        "agent_id": agent_id,
        "error": error,
        "task_id": task_id,
    })


def hitl_request(agent_id: str, hitl_id: str, action_type: str,
                 action_description: str, url: str = "", preview_html: str = "") -> WSEvent:
    return WSEvent(type=EventType.HITL_REQUEST, data={
        "agent_id": agent_id, "hitl_id": hitl_id, "action_type": action_type,
        "action_description": action_description, "url": url, "preview_html": preview_html
    })


def hitl_resolved(agent_id: str, hitl_id: str, resolution: str) -> WSEvent:
    return WSEvent(type=EventType.HITL_RESOLVED, data={
        "agent_id": agent_id, "hitl_id": hitl_id, "resolution": resolution
    })


def task_complete(
    task_id: str,
    final_result: str,
    agent_results: Optional[list[dict]] = None,
    master_task: str = "",
) -> WSEvent:
    return WSEvent(type=EventType.TASK_COMPLETE, data={
        "task_id": task_id,
        "final_result": final_result,
        "agent_results": agent_results or [],
        "master_task": master_task,
    })


def voice_announcement(text: str, audio_b64: str) -> WSEvent:
    return WSEvent(type=EventType.VOICE_ANNOUNCEMENT, data={"text": text, "audio_b64": audio_b64})


def queen_commentary(agent_id: str, message: str, task_id: str = "") -> WSEvent:
    return WSEvent(type=EventType.QUEEN_COMMENTARY, data={
        "agent_id": agent_id, "message": message, "task_id": task_id,
    })


def ping(server_time: str) -> WSEvent:
    return WSEvent(type=EventType.PING, data={"server_time": server_time})

def imessage_received(message_id: str, from_phone: str, text: str) -> WSEvent:
    return WSEvent(type=EventType.IMESSAGE_RECEIVED, data={
        "message_id": message_id,
        "from_phone": from_phone,
        "text": text,
    })

def imessage_sent(message_id: str, to_phone: str, text: str) -> WSEvent:
    return WSEvent(type=EventType.IMESSAGE_SENT, data={
        "message_id": message_id,
        "to_phone": to_phone,
        "text": text,
    })

def imessage_status_update(phone_number: str, status: str, task_id: str = "") -> WSEvent:
    return WSEvent(type=EventType.IMESSAGE_STATUS_UPDATE, data={
        "phone_number": phone_number,
        "status": status,
        "task_id": task_id,
    })
