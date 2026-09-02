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


# ── The receive loop itself (v2.4.2) ─────────────────────────────────────────
#
# _run_one_session was faked wholesale by every test above, so nothing ever
# exercised the loop inside it. That loop ran api._recv_subscription()
# concurrently per topic, which is several concurrent ws.recv() calls on one
# websocket - forbidden. It raised ConcurrencyError on the FIRST iteration
# every time, so the listener connected, logged "listening on [...]", died and
# reconnected forever without processing a single push. Shipped in v1.17,
# found in production four releases later.
#
# These drive the real loop against a fake api, which is the level the bug
# lived at.

class FakeApi:
    """Enforces the one rule the real websocket enforces: no concurrent recv."""

    def __init__(self, pushes):
        self._pushes = list(pushes)
        self.in_recv = False
        self.recv_calls = 0
        self.subscribed = []

    async def subscribe(self, payload):
        self.subscribed.append(payload["type"])
        return f"sub-{len(self.subscribed)}"

    async def recv(self):
        if self.in_recv:
            raise RuntimeError("cannot call recv while another coroutine is already running recv")
        self.in_recv = True
        try:
            self.recv_calls += 1
            if not self._pushes:
                raise _StopLoop
            return self._pushes.pop(0)
        finally:
            self.in_recv = False


class _StopLoop(Exception):
    """Ends the otherwise-infinite listen loop deterministically."""


def _drive(monkeypatch, pushes, has_crypto=True):
    """Run _run_one_session's real body against FakeApi, faking only the
    boundaries it cannot own here (credentials, database, the app callback)."""
    api = FakeApi(pushes)
    fetches = []

    class FakeCur:
        def execute(self, *_a, **_k): pass
        def fetchall(self): return []
        def fetchone(self): return None
        def close(self): pass

    class FakeConn:
        def cursor(self, **_k): return FakeCur()
        def commit(self): pass
        def close(self): pass

    monkeypatch.setattr(sync_tr_realtime, "_credentials", lambda _i: ("phone", "pin", "TR"))
    monkeypatch.setattr(sync_tr_realtime, "_get_api", lambda *a, **k: api)
    monkeypatch.setattr(sync_tr_realtime, "get_conn", lambda: FakeConn())
    monkeypatch.setattr(sync_tr_realtime, "_resolve_db_institution", lambda *_a: "inst-1")
    monkeypatch.setattr(sync_tr_realtime, "institution_owner_id", lambda *_a: "user-owner")
    monkeypatch.setattr(sync_tr_realtime, "_get_securities_accounts", lambda _a: ({"default": []}, has_crypto))
    monkeypatch.setattr(sync_tr_realtime, "upsert_account", lambda *a, **k: "acc-1")
    monkeypatch.setattr(sync_tr_realtime, "_notify_and_followup", lambda *_a: None)

    def fake_fetch(*_a, **kw):
        fetches.append(1)
        return ({"positions": 0, "cash_cents": 0}, kw.get("known_tx_ids", set()))

    monkeypatch.setattr(sync_tr_realtime, "_fetch_and_write_once", fake_fetch)
    api.save_websession = lambda: None

    try:
        asyncio.run(sync_tr_realtime._run_one_session("inst-1"))
    except _StopLoop:
        pass
    return api, fetches


def test_the_loop_does_not_call_recv_concurrently(monkeypatch):
    # The actual v1.17 bug. FakeApi raises exactly what websockets raises.
    api, _ = _drive(monkeypatch, pushes=["push"])
    assert api.recv_calls > 0


def test_a_push_triggers_exactly_one_fetch(monkeypatch):
    # Three subscriptions, so three initial answers to drain, then one real
    # push. Without draining this would fetch four times per connect.
    _, fetches = _drive(monkeypatch, pushes=["a1", "a2", "a3", "real-push"])
    assert len(fetches) == 1


def test_every_push_after_the_initial_answers_triggers_a_fetch(monkeypatch):
    _, fetches = _drive(monkeypatch, pushes=["a1", "a2", "a3", "p1", "p2", "p3"])
    assert len(fetches) == 3


def test_the_initial_answers_alone_trigger_nothing(monkeypatch):
    # Connecting is not a change; a reconnect loop must not hammer the API.
    _, fetches = _drive(monkeypatch, pushes=["a1", "a2", "a3"])
    assert fetches == []


def test_crypto_absent_means_one_fewer_subscription(monkeypatch):
    api, fetches = _drive(monkeypatch, pushes=["a1", "a2", "push"], has_crypto=False)
    assert api.subscribed == ["neonPortfolio", "cash"]
    assert len(fetches) == 1
