import logging
from typing import List, Dict, Any, Optional
import openai
import re

from config import MINIMAX_API_KEY, MINIMAX_MODEL

logger = logging.getLogger(__name__)

if not MINIMAX_API_KEY:
    logger.warning("MINIMAX_API_KEY not set. MiniMax client will not be available.")

client = openai.AsyncOpenAI(
    api_key=MINIMAX_API_KEY,
    base_url="https://api.minimax.io/v1",
) if MINIMAX_API_KEY else None


async def get_minimax_completion(messages: List[Dict[str, str]], **kwargs) -> str:
    if not client:
        raise RuntimeError("MiniMax client not initialized. Check MINIMAX_API_KEY.")

    try:
        # Add a default timeout of 30 seconds, can be overridden by kwargs
        timeout = kwargs.pop("timeout", 30.0)
        completion = await client.chat.completions.create(
            model=MINIMAX_MODEL,
            messages=messages,
            timeout=timeout,  # Added timeout parameter
            **kwargs
        )
        content = completion.choices[0].message.content
        # Remove <think>...</think> tags and their content
        cleaned_content = re.sub(r'<think>.*?</think>', '', content, flags=re.DOTALL)
        return cleaned_content
    except Exception as e:
        logger.error(f"MiniMax API call failed: {e}")
        raise


async def classify_intent(
    message_text: str,
    conversation_history: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """Classify user intent from an iMessage.

    Returns {"intent": str, "confidence": float, "extracted_task": str|None}
    """
    history_str = ""
    if conversation_history:
        recent = conversation_history[-5:]
        history_str = "\n".join(
            f"{'User' if m.get('direction') == 'inbound' else 'Assistant'}: {m.get('text', '')}"
            for m in recent
        )

    messages = [
        {
            "role": "system",
            "content": (
                "You are an intent classifier for HIVEMIND, an AI browser swarm system. "
                "Classify the user's message into exactly one category:\n"
                "- browser_task: User wants you to DO something in a browser (search, buy, navigate, fill forms, compare prices, book, etc.)\n"
                "- chat: User is making conversation, asking a knowledge question, or saying something casual\n"
                "- status_query: User is asking about the status of a running or completed task\n"
                "- unclear: Message is ambiguous and you need clarification\n\n"
                "Respond with ONLY a JSON object: {\"intent\": \"...\", \"confidence\": 0.0-1.0, \"extracted_task\": \"...or null\"}\n"
                "extracted_task should contain the browser task description if intent is browser_task, otherwise null."
            ),
        },
    ]
    if history_str:
        messages.append({"role": "user", "content": f"Conversation so far:\n{history_str}"})
    messages.append({"role": "user", "content": f"New message: {message_text}"})

    try:
        raw = await get_minimax_completion(messages, temperature=0.1, max_tokens=256)
        import json
        cleaned = raw.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
        result = json.loads(cleaned)
        return {
            "intent": result.get("intent", "unclear"),
            "confidence": float(result.get("confidence", 0.5)),
            "extracted_task": result.get("extracted_task"),
        }
    except Exception as e:
        logger.error(f"Intent classification failed: {e}")
        return {"intent": "unclear", "confidence": 0.0, "extracted_task": None}


async def quick_answer(
    message_text: str,
    conversation_history: Optional[List[Dict[str, Any]]] = None,
) -> str:
    """Generate a conversational reply for chat/info queries."""
    messages = [
        {
            "role": "system",
            "content": (
                "You are HIVEMIND, a helpful AI assistant that also controls a browser swarm. "
                "Answer the user's question directly and concisely. "
                "If they ask about capabilities, mention you can search the web, compare prices, "
                "fill forms, and more via your browser agents."
            ),
        },
    ]
    if conversation_history:
        for m in conversation_history[-8:]:
            role = "user" if m.get("direction") == "inbound" else "assistant"
            messages.append({"role": role, "content": m.get("text", "")})
    messages.append({"role": "user", "content": message_text})

    try:
        return await get_minimax_completion(messages, temperature=0.7, max_tokens=512)
    except Exception as e:
        logger.error(f"Quick answer failed: {e}")
        return "Sorry, I couldn't process that right now. Try again?"


async def chat_with_context(
    message_text: str,
    conversation_history: Optional[List[Dict[str, Any]]] = None,
    swarm_status: str = "",
) -> str:
    """Chat while a swarm is running — inject live status context."""
    messages = [
        {
            "role": "system",
            "content": (
                "You are HIVEMIND. You're currently running browser agents on a task. "
                "The user is chatting with you while the swarm works. "
                "Be helpful and conversational. If they ask about task progress, use the status below.\n\n"
                f"Current swarm status:\n{swarm_status or 'No active tasks.'}"
            ),
        },
    ]
    if conversation_history:
        for m in conversation_history[-6:]:
            role = "user" if m.get("direction") == "inbound" else "assistant"
            messages.append({"role": role, "content": m.get("text", "")})
    messages.append({"role": "user", "content": message_text})

    try:
        return await get_minimax_completion(messages, temperature=0.7, max_tokens=512)
    except Exception as e:
        logger.error(f"Chat with context failed: {e}")
        return "I'm working on your task — hang tight!"


async def answer_with_context(
    question: str,
    rag_context: str,
    conversation_history: list[dict] | None = None,
) -> str:
    """Answer a question using RAG context from supermemory."""
    messages = [
        {
            "role": "system",
            "content": (
                "You are HIVEMIND, an AI assistant backed by a browser automation swarm. "
                "Answer the user's question using ONLY the context provided below. "
                "If the context doesn't fully answer the question, say what you know "
                "and mention that the information may be outdated.\n\n"
                f"Context from memory:\n{rag_context}"
            ),
        },
    ]
    if conversation_history:
        for m in conversation_history[-8:]:
            role = "user" if m.get("direction") == "inbound" else "assistant"
            text = m.get("text") or m.get("content") or ""
            if text:
                messages.append({"role": role, "content": text})
    messages.append({"role": "user", "content": question})

    try:
        return await get_minimax_completion(messages, temperature=0.3, max_tokens=1024)
    except Exception as e:
        logger.error(f"answer_with_context failed: {e}")
        raise


async def format_status_reply(
    question: str,
    status_data: str,
) -> str:
    """Format a status query response using MiniMax."""
    messages = [
        {
            "role": "system",
            "content": (
                "You are HIVEMIND. The user is asking about the status of running tasks. "
                "Format the status data below into a clear, concise reply.\n\n"
                f"Current status:\n{status_data}"
            ),
        },
        {"role": "user", "content": question},
    ]
    try:
        return await get_minimax_completion(messages, temperature=0.3, max_tokens=512)
    except Exception as e:
        logger.error(f"format_status_reply failed: {e}")
        return status_data


async def synthesize_results(original_task: str, agent_outputs: str) -> str:
    """Summarize agent results into a user-friendly iMessage reply."""
    messages = [
        {
            "role": "system",
            "content": (
                "You are HIVEMIND. Your browser agents just completed a task. "
                "Summarize the results clearly and concisely for an iMessage reply. "
                "Use short paragraphs, no markdown. Keep it under 500 characters if possible."
            ),
        },
        {
            "role": "user",
            "content": f"Original request: {original_task}\n\nAgent results:\n{agent_outputs}",
        },
    ]
    try:
        return await get_minimax_completion(messages, temperature=0.3, max_tokens=1024)
    except Exception as e:
        logger.error(f"Result synthesis failed: {e}")
        return agent_outputs[:500]
