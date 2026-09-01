"""Unit tests for main.py's real-time listener supervision.

The listener itself was one task, started once at boot, hardcoded to the .env
connection. v2.3 turned it into a set that changes while the process runs -
someone configures Trade Republic from Settings, someone reconnects an expired
session, someone deletes an institution - so the interesting logic moved from
"start a task" to "reconcile a set", which is what is tested here.

No database and no Trade Republic: _wanted_realtime_connections() (the one
function that touches either) is faked, and listen_forever is replaced with a
task that simply parks. What is under test is the bookkeeping around them.
"""

import asyncio

import pytest

import main


@pytest.fixture(autouse=True)
def clean_supervisor_state():
    main._realtime_tasks.clear()
    main._realtime_stopped.clear()
    main._realtime_wanted.clear()
    yield
    for task in main._realtime_tasks.values():
        task.cancel()
    main._realtime_tasks.clear()
    main._realtime_stopped.clear()
    main._realtime_wanted.clear()


def _park_forever(monkeypatch):
    """Replace the real listener with one that never finishes on its own."""
    started = []

    async def fake_listen_forever(institution_id=None):
        started.append(institution_id)
        await asyncio.Event().wait()

    import sync_tr_realtime
    monkeypatch.setattr(sync_tr_realtime, "listen_forever", fake_listen_forever)
    return started


def _wanted(monkeypatch, connections):
    monkeypatch.setattr(main, "_wanted_realtime_connections", lambda: set(connections))


def test_starts_one_listener_per_configured_connection(monkeypatch):
    started = _park_forever(monkeypatch)
    _wanted(monkeypatch, {None, "inst-a", "inst-b"})

    asyncio.run(main._reconcile_realtime_listeners())

    assert sorted(x or ".env" for x in started) == [".env", "inst-a", "inst-b"]


def test_a_per_user_connection_gets_a_listener_without_any_env_credentials(monkeypatch):
    # The regression this whole change exists for: main.py used to start the
    # listener only when TR_PHONE was set, so moving off .env - exactly what
    # v2.1 invited users to do - ended real-time updates with no signal at all.
    started = _park_forever(monkeypatch)
    _wanted(monkeypatch, {"inst-a"})

    asyncio.run(main._reconcile_realtime_listeners())

    assert started == ["inst-a"]


def test_does_not_start_a_second_listener_for_a_connection_already_running(monkeypatch):
    started = _park_forever(monkeypatch)
    _wanted(monkeypatch, {"inst-a"})

    async def twice():
        await main._reconcile_realtime_listeners()
        await main._reconcile_realtime_listeners()

    asyncio.run(twice())

    assert started == ["inst-a"]


def test_stops_the_listener_of_a_connection_that_disappeared(monkeypatch):
    _park_forever(monkeypatch)

    # Asserted inside the running loop on purpose: asyncio.run() cancels every
    # pending task on its way out, so a `task.cancelled()` check afterwards
    # passes whether or not the reconcile did anything at all.
    async def scenario():
        _wanted(monkeypatch, {"inst-a"})
        await main._reconcile_realtime_listeners()
        task = main._realtime_tasks["inst-a"]
        assert not task.done()

        _wanted(monkeypatch, set())
        await main._reconcile_realtime_listeners()
        await asyncio.sleep(0)  # let the cancellation land

        assert "inst-a" not in main._realtime_tasks
        assert task.cancelled()

    asyncio.run(scenario())


def test_a_listener_that_stopped_is_not_restarted_on_the_next_pass(monkeypatch):
    # listen_forever() returns only after an authentication failure, which no
    # amount of retrying fixes. Restarting on the timer would reconnect to
    # Trade Republic every minute forever against a dead session - the exact
    # traffic pattern that gets an account flagged.
    starts = []

    async def fake_listen_forever(institution_id=None):
        starts.append(institution_id)

    import sync_tr_realtime
    monkeypatch.setattr(sync_tr_realtime, "listen_forever", fake_listen_forever)
    _wanted(monkeypatch, {"inst-a"})

    async def scenario():
        await main._reconcile_realtime_listeners()
        await asyncio.sleep(0)  # let the task finish
        await main._reconcile_realtime_listeners()
        await main._reconcile_realtime_listeners()

    asyncio.run(scenario())

    assert starts == ["inst-a"]
    assert "inst-a" in main._realtime_stopped


def test_resume_lets_a_stopped_listener_start_again(monkeypatch):
    # Reconnecting from Settings is the single moment a dead session becomes
    # live again, and the only signal this process gets that retrying is worth
    # anything.
    starts = []
    finish = False

    async def fake_listen_forever(institution_id=None):
        starts.append(institution_id)
        if finish:
            await asyncio.Event().wait()

    import sync_tr_realtime
    monkeypatch.setattr(sync_tr_realtime, "listen_forever", fake_listen_forever)
    _wanted(monkeypatch, {"inst-a"})

    async def scenario():
        nonlocal finish
        await main._reconcile_realtime_listeners()
        await asyncio.sleep(0)
        await main._reconcile_realtime_listeners()
        assert starts == ["inst-a"]

        finish = True
        main.resume_realtime("inst-a")
        await main._reconcile_realtime_listeners()

    asyncio.run(scenario())

    assert starts == ["inst-a", "inst-a"]


def test_a_connection_that_comes_back_forgets_it_was_stopped(monkeypatch):
    # Otherwise deleting and re-adding an institution would produce one that is
    # configured, looks fine in Settings, and never listens again.
    starts = []
    park = False

    async def fake_listen_forever(institution_id=None):
        starts.append(institution_id)
        if park:
            await asyncio.Event().wait()

    import sync_tr_realtime
    monkeypatch.setattr(sync_tr_realtime, "listen_forever", fake_listen_forever)

    async def scenario():
        nonlocal park
        _wanted(monkeypatch, {"inst-a"})
        await main._reconcile_realtime_listeners()
        await asyncio.sleep(0)
        await main._reconcile_realtime_listeners()
        assert main._realtime_stopped == {"inst-a"}

        _wanted(monkeypatch, set())
        await main._reconcile_realtime_listeners()
        assert main._realtime_stopped == set()

        park = True
        _wanted(monkeypatch, {"inst-a"})
        await main._reconcile_realtime_listeners()

    asyncio.run(scenario())

    assert starts == ["inst-a", "inst-a"]


def test_a_database_error_leaves_running_listeners_alone(monkeypatch):
    # An empty result is indistinguishable from "nothing is configured", so a
    # failed query must not be allowed to tear down every healthy listener.
    _park_forever(monkeypatch)

    def explode():
        raise RuntimeError("database unreachable")

    async def scenario():
        _wanted(monkeypatch, {"inst-a"})
        await main._reconcile_realtime_listeners()
        monkeypatch.setattr(main, "_wanted_realtime_connections", explode)
        await main._reconcile_realtime_listeners()

        assert "inst-a" in main._realtime_tasks
        assert not main._realtime_tasks["inst-a"].done()

    asyncio.run(scenario())


def test_shutdown_cancels_every_listener(monkeypatch):
    _park_forever(monkeypatch)
    _wanted(monkeypatch, {None, "inst-a"})

    async def scenario():
        await main._reconcile_realtime_listeners()
        tasks = list(main._realtime_tasks.values())
        assert len(tasks) == 2
        await main._shutdown_realtime_listeners()

        assert main._realtime_tasks == {}
        assert all(task.cancelled() for task in tasks)

    asyncio.run(scenario())
