import logging
from typing import List, Dict
from services import minimax_client
from services.mistral_client import gemini_chat

logger = logging.getLogger(__name__)


async def minimax_gemini_fallback(
    messages: List[Dict[str, str]],
    **kwargs
) -> str:
    """
    Wrapper to try MiniMax and fall back to Gemini on failure.
    """
    try:
        if minimax_client.client:
            logger.info("Attempting to use MiniMax model")
            return await minimax_client.get_minimax_completion(messages, **kwargs)
        else:
            logger.warning("MiniMax client not available, falling back to Gemini.")
            return await gemini_chat(messages, **kwargs)
    except Exception as e:
        logger.error(f"MiniMax failed: {e}. Falling back to Gemini.")
        return await gemini_chat(messages, **kwargs)
