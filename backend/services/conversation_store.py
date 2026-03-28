import logging
import json
import os
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
from dataclasses import dataclass, asdict
from pathlib import Path
import asyncio
import aiofiles

logger = logging.getLogger(__name__)


@dataclass
class Message:
    message_id: str
    from_phone: str
    to_phone: str
    text: str
    timestamp: datetime
    direction: str  # "inbound" or "outbound"
    attachments: Optional[List[Dict[str, Any]]] = None
    metadata: Optional[Dict[str, Any]] = None


@dataclass
class Conversation:
    phone_number: str
    last_message: str
    last_timestamp: datetime
    message_count: int
    status: str  # "active", "archived", "blocked"
    created_at: datetime
    updated_at: datetime


class ConversationStore:
    """
    In-memory conversation store with optional persistence.
    Stores iMessage conversations and provides efficient querying.
    """
    
    def __init__(self, persist_file: Optional[str] = None):
        self.persist_file = persist_file or os.getenv("CONVERSATION_STORE_FILE", "conversations.json")
        self.messages: Dict[str, Message] = {}  # message_id -> Message
        self.conversations: Dict[str, Conversation] = {}  # phone_number -> Conversation
        self.conversation_messages: Dict[str, List[str]] = {}  # phone_number -> [message_id, ...]
        self.task_to_phone: Dict[str, str] = {} # task_id -> phone_number
        self._lock = asyncio.Lock()
        self._persistence_enabled = os.getenv("CONVERSATION_PERSISTENCE", "true").lower() == "true"
        
    async def start(self):
        """Initialize the store and load existing data if available."""
        if self._persistence_enabled:
            await self._load_from_disk()
            self._save_task = asyncio.create_task(self._periodic_save_loop())
        logger.info(f"Conversation store initialized with {len(self.messages)} messages across {len(self.conversations)} conversations")
        
    async def stop(self):
        """Stop the store and persist data if enabled."""
        if hasattr(self, '_save_task') and self._save_task:
            self._save_task.cancel()
            try:
                await self._save_task
            except asyncio.CancelledError:
                pass
        if self._persistence_enabled:
            await self._save_to_disk()
        logger.info("Conversation store stopped")

    async def _periodic_save_loop(self, interval: float = 300.0):
        """Save conversation data to disk periodically."""
        while True:
            await asyncio.sleep(interval)
            try:
                await self._save_to_disk()
            except Exception as e:
                logger.error(f"Periodic save failed: {e}")
        
    async def add_message(
        self,
        message_id: str,
        from_phone: str,
        to_phone: str,
        text: str,
        timestamp: datetime,
        direction: str,
        attachments: Optional[List[Dict[str, Any]]] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> bool:
        """
        Add a new message to the store.
        
        Args:
            message_id: Unique message identifier
            from_phone: Sender phone number
            to_phone: Recipient phone number
            text: Message text content
            timestamp: Message timestamp
            direction: "inbound" or "outbound"
            attachments: Optional list of attachments
            metadata: Optional metadata
            
        Returns:
            True if message was added successfully
        """
        async with self._lock:
            try:
                # Create message object
                message = Message(
                    message_id=message_id,
                    from_phone=from_phone,
                    to_phone=to_phone,
                    text=text,
                    timestamp=timestamp,
                    direction=direction,
                    attachments=attachments or [],
                    metadata=metadata or {}
                )
                
                # Store message
                self.messages[message_id] = message
                
                # Determine conversation phone number (the other party)
                conversation_phone = to_phone if direction == "outbound" else from_phone
                
                # Update conversation index
                if conversation_phone not in self.conversation_messages:
                    self.conversation_messages[conversation_phone] = []
                self.conversation_messages[conversation_phone].append(message_id)
                
                # Update or create conversation
                if conversation_phone not in self.conversations:
                    self.conversations[conversation_phone] = Conversation(
                        phone_number=conversation_phone,
                        last_message=text,
                        last_timestamp=timestamp,
                        message_count=1,
                        status="active",
                        created_at=timestamp,
                        updated_at=timestamp
                    )
                else:
                    conversation = self.conversations[conversation_phone]
                    conversation.last_message = text
                    conversation.last_timestamp = timestamp
                    conversation.message_count += 1
                    conversation.updated_at = timestamp
                    
                logger.debug(f"Added message {message_id} to conversation {conversation_phone}")
                return True
                
            except Exception as e:
                logger.error(f"Error adding message to store: {e}")
                return False
                
    async def get_messages_by_conversation(
        self,
        phone_number: str,
        limit: int = 100,
        before_timestamp: Optional[datetime] = None
    ) -> List[Dict[str, Any]]:
        """
        Get messages for a specific conversation.
        
        Args:
            phone_number: The conversation phone number
            limit: Maximum number of messages to return
            before_timestamp: Only return messages before this timestamp
            
        Returns:
            List of message dictionaries
        """
        async with self._lock:
            try:
                if phone_number not in self.conversation_messages:
                    return []
                    
                message_ids = self.conversation_messages[phone_number]
                messages = []
                
                # Get messages in reverse chronological order
                for message_id in reversed(message_ids):
                    if message_id in self.messages:
                        message = self.messages[message_id]
                        
                        # Filter by timestamp if specified
                        if before_timestamp and message.timestamp >= before_timestamp:
                            continue
                            
                        messages.append({
                            "message_id": message.message_id,
                            "from_phone": message.from_phone,
                            "to_phone": message.to_phone,
                            "text": message.text,
                            "timestamp": message.timestamp,
                            "direction": message.direction,
                            "attachments": message.attachments,
                            "metadata": message.metadata
                        })
                        
                        if len(messages) >= limit:
                            break
                            
                return messages
                
            except Exception as e:
                logger.error(f"Error retrieving messages for conversation {phone_number}: {e}")
                return []
                
    async def get_conversations(
        self,
        limit: int = 50,
        offset: int = 0,
        status_filter: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """
        Get list of conversations.
        
        Args:
            limit: Maximum number of conversations to return
            offset: Number of conversations to skip
            status_filter: Optional status filter ("active", "archived", "blocked")
            
        Returns:
            List of conversation dictionaries
        """
        async with self._lock:
            try:
                conversations = []
                
                # Sort conversations by last timestamp (most recent first)
                sorted_conversations = sorted(
                    self.conversations.values(),
                    key=lambda x: x.last_timestamp,
                    reverse=True
                )
                
                # Apply status filter if specified
                if status_filter:
                    sorted_conversations = [
                        conv for conv in sorted_conversations
                        if conv.status == status_filter
                    ]
                    
                # Apply pagination
                paginated_conversations = sorted_conversations[offset:offset + limit]
                
                for conversation in paginated_conversations:
                    conversations.append({
                        "phone_number": conversation.phone_number,
                        "last_message": conversation.last_message,
                        "last_timestamp": conversation.last_timestamp,
                        "message_count": conversation.message_count,
                        "status": conversation.status,
                        "created_at": conversation.created_at,
                        "updated_at": conversation.updated_at
                    })
                    
                return conversations
                
            except Exception as e:
                logger.error(f"Error retrieving conversations: {e}")
                return []
                
    async def update_conversation_status(
        self,
        phone_number: str,
        status: str
    ) -> bool:
        """
        Update the status of a conversation.
        
        Args:
            phone_number: The conversation phone number
            status: New status ("active", "archived", "blocked")
            
        Returns:
            True if status was updated successfully
        """
        async with self._lock:
            try:
                if phone_number not in self.conversations:
                    logger.warning(f"Conversation {phone_number} not found")
                    return False
                    
                if status not in ["active", "archived", "blocked"]:
                    logger.warning(f"Invalid conversation status: {status}")
                    return False
                    
                self.conversations[phone_number].status = status
                self.conversations[phone_number].updated_at = datetime.utcnow()
                
                logger.info(f"Updated conversation {phone_number} status to {status}")
                return True
                
            except Exception as e:
                logger.error(f"Error updating conversation {phone_number} status: {e}")
                return False
                
    async def get_message(self, message_id: str) -> Optional[Dict[str, Any]]:
        """
        Get a specific message by ID.
        
        Args:
            message_id: The message ID
            
        Returns:
            Message dictionary or None if not found
        """
        async with self._lock:
            try:
                if message_id not in self.messages:
                    return None
                    
                message = self.messages[message_id]
                return {
                    "message_id": message.message_id,
                    "from_phone": message.from_phone,
                    "to_phone": message.to_phone,
                    "text": message.text,
                    "timestamp": message.timestamp,
                    "direction": message.direction,
                    "attachments": message.attachments,
                    "metadata": message.metadata
                }
                
            except Exception as e:
                logger.error(f"Error retrieving message {message_id}: {e}")
                return None
                
    async def delete_conversation(self, phone_number: str) -> bool:
        """
        Delete a conversation and all its messages.
        
        Args:
            phone_number: The conversation phone number
            
        Returns:
            True if conversation was deleted successfully
        """
        async with self._lock:
            try:
                if phone_number not in self.conversations:
                    return False
                    
                # Delete all messages in the conversation
                if phone_number in self.conversation_messages:
                    message_ids = self.conversation_messages[phone_number]
                    for message_id in message_ids:
                        if message_id in self.messages:
                            del self.messages[message_id]
                    del self.conversation_messages[phone_number]
                    
                # Delete the conversation
                del self.conversations[phone_number]
                
                logger.info(f"Deleted conversation {phone_number}")
                return True
                
            except Exception as e:
                logger.error(f"Error deleting conversation {phone_number}: {e}")
                return False
                
    async def search_messages(
        self,
        query: str,
        phone_number: Optional[str] = None,
        limit: int = 50
    ) -> List[Dict[str, Any]]:
        """
        Search messages by text content.
        
        Args:
            query: Search query string
            phone_number: Optional phone number filter
            limit: Maximum number of results
            
        Returns:
            List of matching message dictionaries
        """
        async with self._lock:
            try:
                results = []
                query_lower = query.lower()
                
                # Determine which messages to search
                if phone_number:
                    message_ids = self.conversation_messages.get(phone_number, [])
                else:
                    message_ids = list(self.messages.keys())
                    
                for message_id in message_ids:
                    if message_id in self.messages:
                        message = self.messages[message_id]
                        if query_lower in message.text.lower():
                            results.append({
                                "message_id": message.message_id,
                                "from_phone": message.from_phone,
                                "to_phone": message.to_phone,
                                "text": message.text,
                                "timestamp": message.timestamp,
                                "direction": message.direction,
                                "attachments": message.attachments,
                                "metadata": message.metadata
                            })
                            
                            if len(results) >= limit:
                                break
                                
                return results
                
            except Exception as e:
                logger.error(f"Error searching messages: {e}")
                return []
                
    async def health_check(self) -> Dict[str, Any]:
        """
        Check the health of the conversation store.
        
        Returns:
            Dict with health status
        """
        try:
            async with self._lock:
                return {
                    "healthy": True,
                    "status": "operational",
                    "messages_count": len(self.messages),
                    "conversations_count": len(self.conversations),
                    "persistence_enabled": self._persistence_enabled,
                    "persist_file": self.persist_file,
                    "task_associations": len(self.task_to_phone)
                }
        except Exception as e:
            logger.error(f"Health check failed: {e}")
            return {
                "healthy": False,
                "status": "error",
                "error": str(e)
            }

    async def associate_task_with_conversation(self, task_id: str, phone_number: str) -> bool:
        """
        Associate a task ID with a phone number for status updates.
        
        Args:
            task_id: The task identifier
            phone_number: The phone number to associate with the task
            
        Returns:
            True if association was successful
        """
        async with self._lock:
            try:
                self.task_to_phone[task_id] = phone_number
                logger.info(f"Associated task {task_id} with phone {phone_number}")
                return True
            except Exception as e:
                logger.error(f"Error associating task {task_id} with phone {phone_number}: {e}")
                return False

    async def get_phone_number_for_task(self, task_id: str) -> Optional[str]:
        """
        Get the phone number associated with a task.
        
        Args:
            task_id: The task identifier
            
        Returns:
            Phone number or None if not found
        """
        async with self._lock:
            return self.task_to_phone.get(task_id)
            
    async def _load_from_disk(self):
        """Load conversation data from disk."""
        try:
            if not os.path.exists(self.persist_file):
                logger.info(f"Persistence file {self.persist_file} not found, starting fresh")
                return
                
            async with aiofiles.open(self.persist_file, 'r') as f:
                data = json.loads(await f.read())
                
            # Load messages
            for msg_data in data.get("messages", []):
                message = Message(
                    message_id=msg_data["message_id"],
                    from_phone=msg_data["from_phone"],
                    to_phone=msg_data["to_phone"],
                    text=msg_data["text"],
                    timestamp=datetime.fromisoformat(msg_data["timestamp"]),
                    direction=msg_data["direction"],
                    attachments=msg_data.get("attachments", []),
                    metadata=msg_data.get("metadata", {})
                )
                self.messages[message.message_id] = message
                
            # Load conversations
            for conv_data in data.get("conversations", []):
                conversation = Conversation(
                    phone_number=conv_data["phone_number"],
                    last_message=conv_data["last_message"],
                    last_timestamp=datetime.fromisoformat(conv_data["last_timestamp"]),
                    message_count=conv_data["message_count"],
                    status=conv_data["status"],
                    created_at=datetime.fromisoformat(conv_data["created_at"]),
                    updated_at=datetime.fromisoformat(conv_data["updated_at"])
                )
                self.conversations[conversation.phone_number] = conversation
                
            # Load conversation message index
            self.conversation_messages = data.get("conversation_messages", {})
            
            # Load task to phone associations
            self.task_to_phone = data.get("task_to_phone", {})
            
            logger.info(f"Loaded {len(self.messages)} messages and {len(self.conversations)} conversations from disk")
            
        except Exception as e:
            logger.error(f"Error loading conversation data from disk: {e}")
            # Continue with empty store if load fails
            
    async def _save_to_disk(self):
        """Save conversation data to disk."""
        try:
            # Ensure directory exists
            Path(self.persist_file).parent.mkdir(parents=True, exist_ok=True)
            
            # Prepare data for serialization
            data = {
                "messages": [],
                "conversations": [],
                "conversation_messages": self.conversation_messages,
                "task_to_phone": self.task_to_phone,
                "last_saved": datetime.utcnow().isoformat()
            }
            
            # Serialize messages
            for message in self.messages.values():
                data["messages"].append({
                    "message_id": message.message_id,
                    "from_phone": message.from_phone,
                    "to_phone": message.to_phone,
                    "text": message.text,
                    "timestamp": message.timestamp.isoformat(),
                    "direction": message.direction,
                    "attachments": message.attachments,
                    "metadata": message.metadata
                })
                
            # Serialize conversations
            for conversation in self.conversations.values():
                data["conversations"].append({
                    "phone_number": conversation.phone_number,
                    "last_message": conversation.last_message,
                    "last_timestamp": conversation.last_timestamp.isoformat(),
                    "message_count": conversation.message_count,
                    "status": conversation.status,
                    "created_at": conversation.created_at.isoformat(),
                    "updated_at": conversation.updated_at.isoformat()
                })
                
            # Write to file
            async with aiofiles.open(self.persist_file, 'w') as f:
                await f.write(json.dumps(data, indent=2))
                
            logger.debug(f"Saved {len(self.messages)} messages and {len(self.conversations)} conversations to disk")
            
        except Exception as e:
            logger.error(f"Error saving conversation data to disk: {e}")


# Global instance
conversation_store = ConversationStore()


# Convenience functions
async def add_message(
    message_id: str,
    from_phone: str,
    to_phone: str,
    text: str,
    timestamp: datetime,
    direction: str,
    attachments: Optional[List[Dict[str, Any]]] = None,
    metadata: Optional[Dict[str, Any]] = None
) -> bool:
    """Add a message to the conversation store."""
    return await conversation_store.add_message(
        message_id, from_phone, to_phone, text, timestamp, direction, attachments, metadata
    )


async def get_messages_by_conversation(
    phone_number: str,
    limit: int = 100,
    before_timestamp: Optional[datetime] = None
) -> List[Dict[str, Any]]:
    """Get messages for a conversation."""
    return await conversation_store.get_messages_by_conversation(phone_number, limit, before_timestamp)


async def get_conversations(
    limit: int = 50,
    offset: int = 0,
    status_filter: Optional[str] = None
) -> List[Dict[str, Any]]:
    """Get list of conversations."""
    return await conversation_store.get_conversations(limit, offset, status_filter)


async def update_conversation_status(phone_number: str, status: str) -> bool:
    """Update conversation status."""
    return await conversation_store.update_conversation_status(phone_number, status)


async def health_check() -> Dict[str, Any]:
    """Check store health."""
    return await conversation_store.health_check()

async def associate_task_with_conversation(task_id: str, phone_number: str):
    await conversation_store.associate_task_with_conversation(task_id, phone_number)

async def get_phone_number_for_task(task_id: str) -> Optional[str]:
    return await conversation_store.get_phone_number_for_task(task_id)