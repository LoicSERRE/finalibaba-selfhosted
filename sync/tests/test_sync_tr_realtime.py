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

    async def fake_run_one_session(institution_id=None):
        calls.append(1)
        raise AuthRequiredError("session expired")

    monkeypatch.setattr(sync_tr_realtime, "_run_one_session", fake_run_one_session)
    monkeypatch.setattr(sync_tr_realtime, "_mark_auth_required_realtime", lambda source, msg: None)

    asyncio.run(sync_tr_realtime.listen_forever())

    assert calls == [1]  # never retries after a real auth error


def test_listen_forever_reconnects_with_exponential_backoff(monkeypatch):
    calls = []
    sleeps = []

    async def fake_run_one_session(institution_id=None):
        calls.append(1)
        if len(calls) < 3:
            raise ConnectionError("dropped")
        raise AuthRequiredError("stop the test deterministically")

    async def fake_sleep(seconds):
        sleeps.append(seconds)

    monkeypatch.setattr(sync_tr_realtime, "_run_one_session", fake_run_one_session)
    monkeypatch.setattr(sync_tr_realtime, "_mark_auth_required_realtime", lambda source, msg: None)
    monkeypatch.setattr(asyncio, "sleep", fake_sleep)
    monkeypatch.setattr(sync_tr_realtime, "INITIAL_BACKOFF_S", 5)
    monkeypatch.setattr(sync_tr_realtime, "MAX_BACKOFF_S", 300)

    asyncio.run(sync_tr_realtime.listen_forever())

    assert calls == [1, 1, 1]
    assert sleeps == [5, 10]  # doubles after each transient failure


def test_listen_forever_caps_backoff_at_max(monkeypatch):
    calls = []
    sleeps = []

    async def fake_run_one_session(institution_id=None):
        calls.append(1)
        if len(calls) < 6:
            raise ConnectionError("dropped")
        raise AuthRequiredError("stop the test deterministically")

    async def fake_sleep(seconds):
        sleeps.append(seconds)

    monkeypatch.setattr(sync_tr_realtime, "_run_one_session", fake_run_one_session)
    monkeypatch.setattr(sync_tr_realtime, "_mark_auth_required_realtime", lambda source, msg: None)
    monkeypatch.setattr(asyncio, "sleep", fake_sleep)
    monkeypatch.setattr(sync_tr_realtime, "INITIAL_BACKOFF_S", 5)
    monkeypatch.setattr(sync_tr_realtime, "MAX_BACKOFF_S", 30)

    asyncio.run(sync_tr_realtime.listen_forever())

    assert sleeps == [5, 10, 20, 30, 30]  # 20*2=40 would exceed MAX_BACKOFF_S=30, so it caps


def test_listen_forever_propagates_cancellation(monkeypatch):
    async def fake_run_one_session(institution_id=None):
        raise asyncio.CancelledError()

    monkeypatch.setattr(sync_tr_realtime, "_run_one_session", fake_run_one_session)

    try:
        asyncio.run(sync_tr_realtime.listen_forever())
        raise AssertionError("expected CancelledError to propagate, not be swallowed")
    except asyncio.CancelledError:
        pass


# ── Per-connection listeners (v2.3) ───────────────────────────────────────────
#
# The listener was hardcoded to the .env connection, and main.py only started
# it when TR_PHONE was set. A user who moved off .env to the per-user
# connections v2.1 introduced therefore lost real-time silently: no error, no
# log, just a portfolio that went back to updating every four hours.


def test_realtime_source_is_the_env_one_when_there_is_no_institution():
    assert sync_tr_realtime.realtime_source(None) == "trade_republic_realtime"


def test_realtime_source_is_per_institution_otherwise():
    assert sync_tr_realtime.realtime_source("inst-1") == "tr-realtime:inst-1"


def test_realtime_source_is_a_sibling_of_the_batch_source_not_a_child():
    # db.py's _sync_log_owner reads the segment after the prefix as an
    # institution id and refuses anything with a further colon, so a nested
    # "tr:<id>:realtime" would have filed every listener row under the instance
    # owner instead of the person whose connection it is.
    from db import _sync_log_owner

    source = sync_tr_realtime.realtime_source("inst-1")
    assert source != "tr:inst-1:realtime"

    seen = {}

    class FakeCur:
        def execute(self, sql, params):
            seen["institution_id"] = params[0]

        def fetchone(self):
            return {"userId": "user-member"}

    assert _sync_log_owner(FakeCur(), source) == "user-member"
    assert seen["institution_id"] == "inst-1"


def test_a_nested_realtime_source_would_have_been_attributed_to_the_owner():
    # The shape that was NOT chosen, kept as a test so the reason survives.
    from db import _sync_log_owner

    class ExplodingCur:
        def execute(self, *_):
            raise AssertionError("should not have looked up an institution")

    assert _sync_log_owner(ExplodingCur(), "tr:inst-1:realtime") is None


def test_listen_forever_passes_the_institution_through(monkeypatch):
    seen = []

    async def fake_run_one_session(institution_id=None):
        seen.append(institution_id)
        raise AuthRequiredError("stop")

    monkeypatch.setattr(sync_tr_realtime, "_run_one_session", fake_run_one_session)
    monkeypatch.setattr(sync_tr_realtime, "_mark_auth_required_realtime", lambda source, msg: None)

    asyncio.run(sync_tr_realtime.listen_forever("inst-1"))

    assert seen == ["inst-1"]
