import logging
from fastapi import APIRouter
from services.browser_manager import browser_manager
from services.websocket_manager import manager as ws_manager
from mind.worker import agent_logs
from models.events import agent_failed

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/agents", tags=["agents"])


@router.get("/")
async def list_agents():
    agents = []
    for agent_id in browser_manager.agents:
        agents.append({
            "agent_id": agent_id,
            "active": True,
        })
    return {"agents": agents}


@router.get("/{agent_id}/logs")
async def get_agent_logs(agent_id: str):
    logs = agent_logs.get(agent_id, [])
    return {"agent_id": agent_id, "logs": logs}


@router.delete("/{agent_id}")
async def kill_agent(agent_id: str):
    """Kill a running agent and broadcast failure event."""
    ok = await browser_manager.kill_agent(agent_id)
    # Broadcast so frontend removes agent from store
    await ws_manager.broadcast(agent_failed(agent_id, "Killed by user"))
    # Unassign from any tab
    from services.tab_manager import tab_manager
    for tab in await tab_manager.get_all_tabs():
        if tab.assigned_agent_id == agent_id:
            await tab_manager.unassign_agent(tab.tab_id)
    return {"ok": ok}
