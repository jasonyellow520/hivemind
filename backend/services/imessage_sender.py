import logging
import os
import json
from typing import Optional, List, Dict, Any
import aiohttp
from datetime import datetime

logger = logging.getLogger(__name__)


class iMessageSender:
    """
    Service for sending iMessages through the iMessage bridge.
    Handles HTTP communication with the Node.js iMessage bridge service.
    """
    
    def __init__(self):
        self.bridge_url = os.getenv("IMESSAGE_BRIDGE_URL", "http://localhost:3001")
        self.enabled = os.getenv("IMESSAGE_ENABLED", "true").lower() == "true"
        self.timeout = 30  # seconds
        self.session: Optional[aiohttp.ClientSession] = None
        
    async def __aenter__(self):
        await self.start()
        return self
        
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.close()
        
    async def start(self):
        """Initialize the HTTP session."""
        if not self.enabled:
            logger.warning("iMessage service is disabled")
            return
            
        connector = aiohttp.TCPConnector(limit=10, limit_per_host=5)
        timeout = aiohttp.ClientTimeout(total=self.timeout)
        self.session = aiohttp.ClientSession(
            connector=connector,
            timeout=timeout,
            headers={"Content-Type": "application/json"}
        )
        logger.info(f"iMessage sender initialized with bridge URL: {self.bridge_url}")
        
    async def close(self):
        """Close the HTTP session."""
        if self.session and not self.session.closed:
            await self.session.close()
            logger.info("iMessage sender session closed")
            
    async def send_imessage(
        self,
        to_phone: str,
        text: str,
        from_phone: Optional[str] = None,
        attachments: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """
        Send an iMessage through the bridge service.
        
        Args:
            to_phone: Recipient phone number (E.164 format)
            text: Message text content
            from_phone: Sender phone number (optional, uses bridge default)
            attachments: List of file paths or base64 encoded attachments
            
        Returns:
            Dict with success status and message details
        """
        if not self.enabled:
            return {
                "success": False,
                "error": "iMessage service is disabled"
            }
            
        if not self.session:
            await self.start()
            
        if not self.session:
            return {
                "success": False,
                "error": "Failed to initialize HTTP session"
            }
            
        try:
            payload = {
                "to": to_phone,
                "text": text,
                "timestamp": datetime.utcnow().isoformat()
            }
            
            if from_phone:
                payload["from"] = from_phone
                
            if attachments:
                payload["attachments"] = attachments
                
            logger.info(f"Sending iMessage to {to_phone}: {text[:50]}{'...' if len(text) > 50 else ''}")
            
            async with self.session.post(
                f"{self.bridge_url}/send",
                json=payload
            ) as response:
                response_data = await response.json()
                
                if response.status == 200 and response_data.get("success"):
                    logger.info(f"iMessage sent successfully to {to_phone}")
                    return {
                        "success": True,
                        "message_id": response_data.get("messageId"),
                        "timestamp": response_data.get("timestamp")
                    }
                else:
                    error_msg = response_data.get("error", f"HTTP {response.status}")
                    logger.error(f"Failed to send iMessage: {error_msg}")
                    return {
                        "success": False,
                        "error": error_msg
                    }
                    
        except aiohttp.ClientError as e:
            logger.error(f"Network error sending iMessage: {e}")
            return {
                "success": False,
                "error": f"Network error: {str(e)}"
            }
        except json.JSONDecodeError as e:
            logger.error(f"JSON error in iMessage response: {e}")
            return {
                "success": False,
                "error": "Invalid response from iMessage bridge"
            }
        except Exception as e:
            logger.error(f"Unexpected error sending iMessage: {e}")
            return {
                "success": False,
                "error": f"Unexpected error: {str(e)}"
            }
            
    async def send_status_update(
        self,
        to_phone: str,
        status_text: str,
        task_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Send a status update message during swarm execution.
        
        Args:
            to_phone: Recipient phone number
            status_text: Status message text
            task_id: Optional task ID for context
            
        Returns:
            Dict with success status
        """
        # Add task context if provided
        if task_id:
            status_text = f"[Task {task_id}] {status_text}"
            
        return await self.send_imessage(to_phone, status_text)
        
    async def send_screenshot(
        self,
        to_phone: str,
        screenshot_data: str,
        caption: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Send a screenshot as an iMessage attachment.
        
        Args:
            to_phone: Recipient phone number
            screenshot_data: Base64 encoded screenshot data or file path
            caption: Optional caption text
            
        Returns:
            Dict with success status
        """
        attachments = [screenshot_data]
        text = caption or "Screenshot from automation task"
        
        return await self.send_imessage(
            to_phone=to_phone,
            text=text,
            attachments=attachments
        )
        
    async def health_check(self) -> Dict[str, Any]:
        """
        Check the health of the iMessage bridge service.
        
        Returns:
            Dict with health status
        """
        if not self.enabled:
            return {
                "healthy": False,
                "status": "disabled",
                "message": "iMessage service is disabled"
            }
            
        if not self.session:
            await self.start()
            
        try:
            async with self.session.get(
                f"{self.bridge_url}/health",
                timeout=aiohttp.ClientTimeout(total=5)
            ) as response:
                if response.status == 200:
                    bridge_health = await response.json()
                    return {
                        "healthy": bridge_health.get("healthy", False),
                        "status": "connected",
                        "bridge_status": bridge_health
                    }
                else:
                    return {
                        "healthy": False,
                        "status": f"HTTP {response.status}",
                        "message": "Bridge health check failed"
                    }
                    
        except aiohttp.ClientError as e:
            logger.error(f"Health check failed - network error: {e}")
            return {
                "healthy": False,
                "status": "network_error",
                "message": f"Cannot connect to bridge: {str(e)}"
            }
        except Exception as e:
            logger.error(f"Health check failed - unexpected error: {e}")
            return {
                "healthy": False,
                "status": "error",
                "message": f"Unexpected error: {str(e)}"
            }


# Global instance
imessage_sender = iMessageSender()


async def send_imessage(
    to_phone: str,
    text: str,
    from_phone: Optional[str] = None,
    attachments: Optional[List[str]] = None
) -> Dict[str, Any]:
    """Convenience function to send an iMessage."""
    return await imessage_sender.send_imessage(to_phone, text, from_phone, attachments)


async def send_status_update(
    to_phone: str,
    status_text: str,
    task_id: Optional[str] = None
) -> Dict[str, Any]:
    """Convenience function to send a status update."""
    return await imessage_sender.send_status_update(to_phone, status_text, task_id)


async def send_screenshot(
    to_phone: str,
    screenshot_data: str,
    caption: Optional[str] = None
) -> Dict[str, Any]:
    """Convenience function to send a screenshot."""
    return await imessage_sender.send_screenshot(to_phone, screenshot_data, caption)


async def health_check() -> Dict[str, Any]:
    """Convenience function to check health."""
    return await imessage_sender.health_check()