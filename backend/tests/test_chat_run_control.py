"""Unit tests for chat cancellation and total execution deadlines."""

import asyncio
import time

import pytest

from services.run_control import (
    ChatRunCancelled,
    ChatRunTimedOut,
    await_with_run_control,
    positive_float_env,
)


@pytest.mark.unit
def test_positive_float_env_uses_valid_value(monkeypatch):
    monkeypatch.setenv("TEST_CHAT_TIMEOUT", "12.5")

    assert positive_float_env("TEST_CHAT_TIMEOUT", 60.0) == 12.5


@pytest.mark.unit
@pytest.mark.parametrize("value", ["invalid", "0", "-1"])
def test_positive_float_env_rejects_invalid_values(monkeypatch, value):
    monkeypatch.setenv("TEST_CHAT_TIMEOUT", value)

    assert positive_float_env("TEST_CHAT_TIMEOUT", 60.0) == 60.0


@pytest.mark.unit
def test_run_control_returns_completed_result():
    async def scenario():
        async def not_cancelled():
            return False

        async def complete_immediately():
            return "complete"

        return await await_with_run_control(
            complete_immediately(),
            deadline=time.monotonic() + 1.0,
            is_cancelled=not_cancelled,
            poll_interval=0.01,
        )

    assert asyncio.run(scenario()) == "complete"


@pytest.mark.unit
def test_run_control_cancels_silent_work_after_user_request():
    async def scenario():
        cancel_state = {"requested": False}
        worker_stopped = asyncio.Event()

        async def is_cancelled():
            return cancel_state["requested"]

        async def silent_work():
            try:
                await asyncio.Event().wait()
            finally:
                worker_stopped.set()

        controlled_work = asyncio.create_task(
            await_with_run_control(
                silent_work(),
                deadline=time.monotonic() + 5.0,
                is_cancelled=is_cancelled,
                poll_interval=0.01,
            )
        )

        await asyncio.sleep(0.02)
        cancel_state["requested"] = True

        with pytest.raises(ChatRunCancelled):
            await asyncio.wait_for(controlled_work, timeout=0.5)

        await asyncio.wait_for(worker_stopped.wait(), timeout=0.5)

    asyncio.run(scenario())


@pytest.mark.unit
def test_run_control_times_out_and_stops_silent_work():
    async def scenario():
        worker_stopped = asyncio.Event()

        async def not_cancelled():
            return False

        async def silent_work():
            try:
                await asyncio.Event().wait()
            finally:
                worker_stopped.set()

        with pytest.raises(ChatRunTimedOut):
            await await_with_run_control(
                silent_work(),
                deadline=time.monotonic() + 0.03,
                is_cancelled=not_cancelled,
                poll_interval=0.005,
            )

        await asyncio.wait_for(worker_stopped.wait(), timeout=0.5)

    asyncio.run(scenario())
