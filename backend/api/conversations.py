"""CRUD endpoints for persisted chat conversations."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import get_current_user
from db.models.conversation import Conversation
from db.models.user import User
from db.session import get_session
from models.conversation import ConversationCreate, ConversationRead, ConversationUpdate

router = APIRouter(prefix="/conversations", tags=["conversations"])


async def _get_conversation_for_user(
    conversation_id: UUID,
    db: AsyncSession,
    current_user: User,
) -> Conversation:
    result = await db.execute(
        select(Conversation).where(
            Conversation.id == conversation_id,
            Conversation.owner_id == current_user.id,
        )
    )
    conversation = result.scalars().first()
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conversation


@router.get("/", response_model=list[ConversationRead])
async def list_conversations(
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> list[ConversationRead]:
    """List the current user's most recent conversations."""
    result = await db.execute(
        select(Conversation)
        .where(Conversation.owner_id == current_user.id)
        .order_by(Conversation.updated_at.desc())
        .limit(limit)
    )
    return [
        ConversationRead.model_validate(item)
        for item in result.scalars().all()
    ]


@router.post(
    "/",
    response_model=ConversationRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_conversation(
    payload: ConversationCreate,
    db: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> ConversationRead:
    """Create a conversation for the current user."""
    title = payload.title.strip() or "New conversation"
    conversation = Conversation(
        owner_id=current_user.id,
        title=title,
        messages=payload.messages,
    )
    db.add(conversation)
    await db.commit()
    await db.refresh(conversation)
    return ConversationRead.model_validate(conversation)


@router.patch("/{conversation_id}", response_model=ConversationRead)
async def update_conversation(
    conversation_id: UUID,
    payload: ConversationUpdate,
    db: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> ConversationRead:
    """Update the title or complete message list of a conversation."""
    conversation = await _get_conversation_for_user(
        conversation_id,
        db,
        current_user,
    )
    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No fields provided for update")

    if "title" in updates:
        updates["title"] = updates["title"].strip() or "New conversation"
    for key, value in updates.items():
        setattr(conversation, key, value)

    conversation.updated_at = func.now()
    await db.commit()
    await db.refresh(conversation)
    return ConversationRead.model_validate(conversation)


@router.delete("/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_conversation(
    conversation_id: UUID,
    db: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> Response:
    """Delete a conversation owned by the current user."""
    conversation = await _get_conversation_for_user(
        conversation_id,
        db,
        current_user,
    )
    await db.delete(conversation)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
