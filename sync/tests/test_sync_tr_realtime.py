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

import pytest

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
    """Speaks the shape api.recv() really returns, enforces the one rule the
    real websocket enforces (no concurrent recv), and can refuse a topic the
    way Trade Republic refuses an unknown one."""

    def __init__(self, pushes, refuse=()):
        self._pushes = list(pushes)
        self._refuse = set(refuse)
        self.in_recv = False
        self.recv_calls = 0
        self.subscribed = []
        self._pending_answers = []

    async def subscribe(self, payload):
        self.subscribed.append(payload["type"])
        sub_id = f"sub-{len(self.subscribed)}"
        # Each subscription answers once; a refused one answers with an error,
        # asynchronously, exactly as TR does.
        self._pending_answers.append((sub_id, payload, payload["type"] in self._refuse))
        return sub_id

    async def recv(self):
        from pytr.api import TradeRepublicError

        if self.in_recv:
            raise RuntimeError("cannot call recv while another coroutine is already running recv")
        self.in_recv = True
        try:
            self.recv_calls += 1
            if self._pending_answers:
                sub_id, payload, refused = self._pending_answers.pop(0)
                if refused:
                    raise TradeRepublicError(sub_id, payload, {"errorCode": "BAD_SUBSCRIPTION_TYPE"})
                return sub_id, payload, {}
            if not self._pushes:
                raise _StopLoop
            return "sub-1", {"type": "cash"}, self._pushes.pop(0)
        finally:
            self.in_recv = False


class _StopLoop(Exception):
    """Ends the otherwise-infinite listen loop deterministically."""


def _drive(monkeypatch, pushes, has_crypto=True, refuse=(), no_throttle=True):
    """Run _run_one_session's real body against FakeApi, faking only the
    boundaries it cannot own here (credentials, database, the app callback)."""
    api = FakeApi(pushes, refuse=refuse)
    fetches = []
    # The 30s floor between fetch cycles is exercised by its own test below;
    # everywhere else it would just mask what is being asserted.
    if no_throttle:
        monkeypatch.setattr(sync_tr_realtime, "MIN_FETCH_INTERVAL_S", 0)

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
    monkeypatch.setattr(sync_tr_realtime, "_get_securities_accounts", lambda _a: ({"default": ["040575"]}, has_crypto))
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
    # The v1.17 bug: one receive task per topic is several concurrent reads on
    # one websocket. FakeApi raises exactly what websockets raises.
    api, _ = _drive(monkeypatch, pushes=["push"])
    assert api.recv_calls > 0


def test_a_push_triggers_a_fetch(monkeypatch):
    _, fetches = _drive(monkeypatch, pushes=["real-push"])
    assert len(fetches) == 1


def test_every_push_triggers_a_fetch(monkeypatch):
    _, fetches = _drive(monkeypatch, pushes=["p1", "p2", "p3"])
    assert len(fetches) == 3


def test_connecting_is_not_a_change(monkeypatch):
    # Each subscription answers once with its current state. Treating those as
    # changes meant a full Trade Republic fetch per topic on every reconnect,
    # and this reconnects with backoff.
    _, fetches = _drive(monkeypatch, pushes=[])
    assert fetches == []


def test_a_refused_topic_does_not_kill_the_session(monkeypatch):
    # The v2.4.2 bug, from production: TR answers an unknown topic with
    # BAD_SUBSCRIPTION_TYPE, asynchronously. That error used to propagate out
    # of the session and the listener reconnected forever.
    _, fetches = _drive(monkeypatch, pushes=["p1"], refuse=("compactPortfolioByType",))
    assert len(fetches) == 1, "the surviving topic must still drive the loop"


def test_every_topic_refused_is_a_real_failure(monkeypatch):
    # Losing one topic costs coverage; losing all of them means the listener
    # would sit there having subscribed to nothing, looking healthy.
    with pytest.raises(RuntimeError, match="accepted none"):
        _drive(monkeypatch, pushes=["p1"], refuse=("cash", "compactPortfolioByType"))


def test_a_chatty_topic_cannot_cause_a_fetch_storm(monkeypatch):
    # Nothing bounded the fetch rate before. A topic pushing on every price
    # tick would have meant a full fetch cycle per tick.
    _, fetches = _drive(monkeypatch, pushes=["p1", "p2", "p3", "p4"], no_throttle=False)
    assert len(fetches) == 1, "the 30s floor must collapse a burst into one fetch"
