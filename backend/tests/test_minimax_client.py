import pytest
from unittest.mock import AsyncMock, patch
from backend.services.minimax_client import get_minimax_completion, classify_intent, quick_answer, chat_with_context, synthesize_results
import json

@pytest.mark.asyncio
async def test_get_minimax_completion_success():
    messages = [{"role": "user", "content": "Hello"}]
    mock_completion_response = AsyncMock()
    mock_completion_response.choices[0].message.content = "Mocked MiniMax response"

    with patch('backend.services.minimax_client.client', new_callable=AsyncMock) as mock_client:
        mock_client.chat.completions.create.return_value = mock_completion_response
        result = await get_minimax_completion(messages)
        assert result == "Mocked MiniMax response"
        mock_client.chat.completions.create.assert_called_once_with(
            model="MiniMax-M2.7", # Updated to M2.7
            messages=messages
        )

@pytest.mark.asyncio
async def test_get_minimax_completion_failure():
    messages = [{"role": "user", "content": "Hello"}]
    with patch('backend.services.minimax_client.client', new_callable=AsyncMock) as mock_client:
        mock_client.chat.completions.create.side_effect = Exception("API Error")
        with pytest.raises(Exception, match="API Error"):
            await get_minimax_completion(messages)

@pytest.mark.asyncio
async def test_classify_intent_success():
    message_text = "Find me a good restaurant"
    mock_minimax_response = {
        "intent": "browser_task",
        "confidence": 0.9,
        "extracted_task": "Find a good restaurant"
    }
    mock_completion_content = json.dumps(mock_minimax_response)

    with patch('backend.services.minimax_client.get_minimax_completion', new_callable=AsyncMock) as mock_get_completion:
        mock_get_completion.return_value = mock_completion_content
        result = await classify_intent(message_text)
        assert result == mock_minimax_response
        mock_get_completion.assert_called_once()


@pytest.mark.asyncio
async def test_classify_intent_failure():
    with patch('backend.services.minimax_client.get_minimax_completion', new_callable=AsyncMock) as mock_get_completion:
        mock_get_completion.side_effect = Exception("Completion Error")
        result = await classify_intent("test message")
        assert result == {"intent": "unclear", "confidence": 0.0, "extracted_task": None}

@pytest.mark.asyncio
async def test_quick_answer_success():
    message_text = "How are you?"
    expected_response = "I am doing well, thank you for asking!"
    with patch('backend.services.minimax_client.get_minimax_completion', new_callable=AsyncMock) as mock_get_completion:
        mock_get_completion.return_value = expected_response
        result = await quick_answer(message_text)
        assert result == expected_response
        mock_get_completion.assert_called_once()

@pytest.mark.asyncio
async def test_quick_answer_failure():
    message_text = "How are you?"
    with patch('backend.services.minimax_client.get_minimax_completion', new_callable=AsyncMock) as mock_get_completion:
        mock_get_completion.side_effect = Exception("Quick answer failed")
        result = await quick_answer(message_text)
        assert result == "Sorry, I couldn't process that right now. Try again?"
        mock_get_completion.assert_called_once()

@pytest.mark.asyncio
async def test_chat_with_context_success():
    message_text = "What's up?"
    swarm_status = "Task X is 50% complete."
    expected_response = "I'm currently working on Task X, which is 50% complete. How can I help?"
    with patch('backend.services.minimax_client.get_minimax_completion', new_callable=AsyncMock) as mock_get_completion:
        mock_get_completion.return_value = expected_response
        result = await chat_with_context(message_text, swarm_status=swarm_status)
        assert result == expected_response
        mock_get_completion.assert_called_once()

@pytest.mark.asyncio
async def test_chat_with_context_failure():
    message_text = "What's up?"
    swarm_status = "Task Y is pending."
    with patch('backend.services.minimax_client.get_minimax_completion', new_callable=AsyncMock) as mock_get_completion:
        mock_get_completion.side_effect = Exception("Chat with context failed")
        result = await chat_with_context(message_text, swarm_status=swarm_status)
        assert result == "I'm working on your task — hang tight!"
        mock_get_completion.assert_called_once()

@pytest.mark.asyncio
async def test_synthesize_results_success():
    original_task = "Find the best deals on laptops."
    agent_outputs = "Agent 1 found deals on Dell. Agent 2 found deals on HP."
    expected_summary = "Laptops deals found: Dell and HP."
    with patch('backend.services.minimax_client.get_minimax_completion', new_callable=AsyncMock) as mock_get_completion:
        mock_get_completion.return_value = expected_summary
        result = await synthesize_results(original_task, agent_outputs)
        assert result == expected_summary
        mock_get_completion.assert_called_once()

@pytest.mark.asyncio
async def test_synthesize_results_failure():
    original_task = "Summarize news."
    agent_outputs = "News content here."
    with patch('backend.services.minimax_client.get_minimax_completion', new_callable=AsyncMock) as mock_get_completion:
        mock_get_completion.side_effect = Exception("Synthesis failed")
        result = await synthesize_results(original_task, agent_outputs)
        assert result == agent_outputs[:500]
        mock_get_completion.assert_called_once()
