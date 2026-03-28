import pytest
from unittest.mock import AsyncMock, patch
from backend.services.minimax_client import get_minimax_completion, classify_intent
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
            model="MiniMax-M1", # Assuming MINIMAX_MODEL is "MiniMax-M1" from config.py
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
