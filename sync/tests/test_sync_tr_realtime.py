"""Unit tests for sync_tr_realtime.py's own control flow - reconnect-with-
backoff and the auth-error-vs-transient-error branch of listen_forever().

_run_one_session() itself (a real DB connection + a real TR websocket
session) is intentionally not covered here - same "test our own logic, not
a mocked broker" reasoning test_sync_tr.py's own module docstring already
states. Only listen_forever()'s reaction to what _run_one_session() raises
is tested, by faking that one direct dependency - the same shape as
test_sync_tr.py's own _FlakyApi retry tests fake pytr's client one level
lower.
"""

import asyncio

import sync_tr_realtime
from sync_tr import AuthRequiredError


def test_listen_forever_stops_without_retrying_on_auth_required(monkeypatch):
    calls = []

    async def fake_run_one_session():
        calls.append(1)
        raise AuthRequiredError("session expired")

    monkeypatch.setattr(sync_tr_realtime, "_run_one_session", fake_run_one_session)
    monkeypatch.setattr(sync_tr_realtime, "_mark_auth_required_realtime", lambda msg: None)

    asyncio.run(sync_tr_realtime.listen_forever())

    assert calls == [1]  # never retries after a real auth error


def test_listen_forever_reconnects_with_exponential_backoff(monkeypatch):
    calls = []
    sleeps = []

    async def fake_run_one_session():
        calls.append(1)
        if len(calls) < 3:
            raise ConnectionError("dropped")
        raise AuthRequiredError("stop the test deterministically")

    async def fake_sleep(seconds):
        sleeps.append(seconds)

    monkeypatch.setattr(sync_tr_realtime, "_run_one_session", fake_run_one_session)
    monkeypatch.setattr(sync_tr_realtime, "_mark_auth_required_realtime", lambda msg: None)
    monkeypatch.setattr(asyncio, "sleep", fake_sleep)
    monkeypatch.setattr(sync_tr_realtime, "INITIAL_BACKOFF_S", 5)
    monkeypatch.setattr(sync_tr_realtime, "MAX_BACKOFF_S", 300)

    asyncio.run(sync_tr_realtime.listen_forever())

    assert calls == [1, 1, 1]
    assert sleeps == [5, 10]  # doubles after each transient failure


def test_listen_forever_caps_backoff_at_max(monkeypatch):
    calls = []
    sleeps = []

    async def fake_run_one_session():
        calls.append(1)
        if len(calls) < 6:
            raise ConnectionError("dropped")
        raise AuthRequiredError("stop the test deterministically")

    async def fake_sleep(seconds):
        sleeps.append(seconds)

    monkeypatch.setattr(sync_tr_realtime, "_run_one_session", fake_run_one_session)
    monkeypatch.setattr(sync_tr_realtime, "_mark_auth_required_realtime", lambda msg: None)
    monkeypatch.setattr(asyncio, "sleep", fake_sleep)
    monkeypatch.setattr(sync_tr_realtime, "INITIAL_BACKOFF_S", 5)
    monkeypatch.setattr(sync_tr_realtime, "MAX_BACKOFF_S", 30)

    asyncio.run(sync_tr_realtime.listen_forever())

    assert sleeps == [5, 10, 20, 30, 30]  # 20*2=40 would exceed MAX_BACKOFF_S=30, so it caps


def test_listen_forever_propagates_cancellation(monkeypatch):
    async def fake_run_one_session():
        raise asyncio.CancelledError()

    monkeypatch.setattr(sync_tr_realtime, "_run_one_session", fake_run_one_session)

    try:
        asyncio.run(sync_tr_realtime.listen_forever())
        raise AssertionError("expected CancelledError to propagate, not be swallowed")
    except asyncio.CancelledError:
        pass
