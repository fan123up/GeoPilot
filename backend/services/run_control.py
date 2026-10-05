"""Cancellation and timeout controls for long-running agent work."""

import asyncio
import logging
import os
import time
from typing import Awaitable, Callable, Optional, TypeVar

logger = logging.getLogger(__name__)

DEFAULT_CHAT_RUN_TIMEOUT_SECONDS = 600.0
DEFAULT_CANCELLATION_POLL_SECONDS = 0.5
DEFAULT_SSE_KEEPALIVE_SECONDS = 30.0

T = TypeVar("T")
AsyncCheck = Callable[[], Awaitable[bool]]


class ChatRunCancelled(Exception):
    """Raised when a user cancels a running chat request."""


class ChatRunTimedOut(Exception):
    """Raised when a chat request exceeds its total execution deadline."""


def positive_float_env(name: str, default: float) -> float:
    """Read a positive float from the environment with a safe fallback."""
    raw_value = os.getenv(name)
    if raw_value is None:
        return default

    try:
        value = float(raw_value)
    except (TypeError, ValueError):
        logger.warning(
            "Invalid %s=%r; using %.1f seconds",
            name,
            raw_value,
            default,
        )
        return default

    if value <= 0:
        logger.warning(
            "%s must be positive; using %.1f seconds",
            name,
            default,
        )
        return default
    return value


def consume_task_result(task: asyncio.Future) -> None:
    """Retrieve a task exception so cancellation cannot leak warnings."""
    if task.cancelled():
        return
    try:
        task.exception()
    except (asyncio.CancelledError, Exception):
        pass


def stop_task(task: Optional[asyncio.Future]) -> None:
    """Request cancellation without blocking stream cleanup."""
    if task is None or task.done():
        return
    task.cancel()
    task.add_done_callback(consume_task_result)


async def await_with_run_control(
    awaitable: Awaitable[T],
    *,
    deadline: float,
    is_cancelled: AsyncCheck,
    is_disconnected: Optional[AsyncCheck] = None,
    poll_interval: float = DEFAULT_CANCELLATION_POLL_SECONDS,
) -> T:
    """Await work with cancellation, disconnect, and total timeout controls."""
    task = asyncio.ensure_future(awaitable)
    try:
        while True:
            if await is_cancelled():
                raise ChatRunCancelled("Request cancelled by user")
            if is_disconnected is not None and await is_disconnected():
                raise ChatRunCancelled("Client disconnected")

            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise ChatRunTimedOut(
                    "Chat run exceeded its execution deadline"
                )

            done, _ = await asyncio.wait(
                {task},
                timeout=min(poll_interval, remaining),
                return_when=asyncio.FIRST_COMPLETED,
            )
            if task in done:
                return task.result()
    finally:
        stop_task(task)
