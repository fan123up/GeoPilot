"""Shared API dependencies."""

import logging
from uuid import UUID as UUIDType

from fastapi import Depends, HTTPException, Request, status
from jose import JWTError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import AUTH_ENABLED
from core.security import decode_access_token
from db.models.user import User
from db.session import get_session

logger = logging.getLogger(__name__)

ANONYMOUS_USER_ID = UUIDType("00000000-0000-0000-0000-000000000000")


async def _get_or_create_anonymous_user(db: AsyncSession) -> User:
    """Return the shared local user used when authentication is disabled."""
    result = await db.execute(select(User).where(User.id == ANONYMOUS_USER_ID))
    user = result.scalars().first()
    if user is not None:
        return user

    user = User(
        id=ANONYMOUS_USER_ID,
        email="anonymous@localhost",
        display_name="Anonymous",
    )
    db.add(user)
    try:
        await db.commit()
        await db.refresh(user)
        return user
    except IntegrityError:
        # Multiple startup requests may attempt to create the local user.
        await db.rollback()
        result = await db.execute(select(User).where(User.id == ANONYMOUS_USER_ID))
        user = result.scalars().first()
        if user is None:
            raise
        return user


async def get_current_user(
    request: Request,
    db: AsyncSession = Depends(get_session),
) -> User:
    """Return the current authenticated user based on session cookie.

    When ``AUTH_ENABLED`` is ``False`` a fixed local database user is used so
    maps, layers, and conversations can be persisted without requiring login.
    """
    if not AUTH_ENABLED:
        return await _get_or_create_anonymous_user(db)

    token = request.cookies.get("access_token")
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    try:
        payload = decode_access_token(token)
        user_id = payload.get("sub")
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    # Validate user_id is a valid UUID format before database query
    try:
        user_id_uuid = UUIDType(user_id)
    except (ValueError, TypeError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    result = await db.execute(select(User).where(User.id == user_id_uuid))
    user = result.scalars().first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return user
