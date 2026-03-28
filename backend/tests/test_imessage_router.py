import pytest
from fastapi.testclient import TestClient
from main import app
from unittest.mock import patch, AsyncMock

client = TestClient(app)


@patch("routers.imessage.imessage_sender.health_check", new_callable=AsyncMock)
def test_health_check(mock_health_check):
    mock_health_check.return_value = {"healthy": True, "status": "connected"}
    response = client.get("/api/v1/imessage/health")
    assert response.status_code == 200
    assert response.json()["status"] == "healthy"


@patch("routers.imessage.imessage_sender.send_imessage", new_callable=AsyncMock)
def test_send_message(mock_send_imessage):
    mock_send_imessage.return_value = {"success": True}
    response = client.post(
        "/api/v1/imessage/send",
        json={"text": "test message", "to_phone": "+11234567890"},
    )
    assert response.status_code == 200
    assert response.json()["status"] == "sent"


def test_webhook():
    response = client.post(
        "/api/v1/imessage/webhook",
        json={
            "text": "test webhook",
            "from_phone": "+11234567890",
            "to_phone": "+10987654321",
            "message_id": "test_webhook_123",
            "timestamp": "2024-01-01T12:00:00Z",
        },
    )
    assert response.status_code == 200
    assert response.json()["status"] == "received"
