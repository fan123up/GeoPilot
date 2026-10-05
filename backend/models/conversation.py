"""Pydantic models for conversation persistence."""

from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ConversationCreate(BaseModel):
    """Payload for creating a conversation."""

    title: str = Field(default="New conversation", min_length=1, max_length=200)
    messages: List[Dict[str, Any]] = Field(default_factory=list)

    model_config = ConfigDict(extra="forbid")


class ConversationUpdate(BaseModel):
    """Payload for updating a conversation."""

    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    messages: Optional[List[Dict[str, Any]]] = None

    model_config = ConfigDict(extra="forbid")


class ConversationRead(BaseModel):
    """Conversation returned to the frontend."""

    id: UUID
    title: str
    messages: List[Dict[str, Any]]
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True, extra="forbid")
