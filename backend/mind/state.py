from typing import TypedDict, Optional
from models.task import SubTask, SubTaskResult


class WorkerState(TypedDict):
    agent_id: str
    subtask_id: str
    task_description: str
    status: str
    current_url: str
    actions_taken: list[dict]
    pending_hitl: Optional[dict]
    hitl_history: list[dict]
    steps_completed: int
    last_error: str
    result: str


class MindState(TypedDict):
    task_id: str
    master_task: str
    decomposition_reasoning: str
    subtasks: list[dict]
    assignment_map: dict[str, str]
    worker_results: dict[str, str]
    final_result: str
    phase: str
    errors: list[str]


class HiveMindState(TypedDict):
    """State for the iMessage → Dispatcher → Queen LangGraph flow."""
    # Message context
    message_id: str
    from_phone: str
    to_phone: str
    message_text: str
    conversation_history: list[dict]

    # Intent classification
    intent: str  # "chat" | "browser_task" | "status_query" | "unclear"
    intent_confidence: float

    # Task execution (populated only for browser_task)
    task_id: str
    master_task: str
    subtasks: list[dict]
    worker_results: dict[str, str]
    final_result: str

    # Response
    reply_text: str
    reply_sent: bool

    # Control flow
    phase: str
    errors: list[str]
    retry_count: int
