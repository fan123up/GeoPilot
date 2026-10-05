"""ORM model for persisted chat conversations."""

from sqlalchemy import Column, ForeignKey, Index, text
from sqlalchemy.dialects.postgresql import JSONB, TEXT, TIMESTAMP, UUID

from db.base import Base


class Conversation(Base):
    """A user's chat history stored as one JSON message list."""

    __tablename__ = "conversations"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    owner_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    title = Column(TEXT, nullable=False)
    messages = Column(
        JSONB,
        nullable=False,
        server_default=text("'[]'::jsonb"),
    )
    created_at = Column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )
    updated_at = Column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )

    __table_args__ = (
        Index("ix_conversations_owner_updated", "owner_id", "updated_at"),
    )
