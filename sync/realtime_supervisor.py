"""Supervision of the per-connection Trade Republic websocket listeners.

Split out of main.py at v2.10.2, where it sat among the scheduler jobs and the
FastAPI routes in a 919-line entrypoint. It belongs beside sync_tr_realtime.py,
which owns a single listener, rather than inside the HTTP surface: this module
decides which listeners should exist and reconciles them, nothing else.

Text moved from main.py, with one addition - `listener_states()`, which is the
body GET /realtime/status used to compute inline off these same globals.
"""

import asyncio
import logging
import os
from contextlib import suppress

import psycopg2.extras

from workers import executor

log = logging.getLogger(__name__)

# ── Real-time listener supervision ────────────────────────────────────────────
#
# One websocket per Trade Republic connection, alive for the process's lifetime.
# A RECONCILE LOOP rather than a one-shot start, because connections come and go
# while the process runs: it compares configured connections against live tasks
# every REALTIME_RESCAN_S. Started once at boot instead, moving off .env silently
# ended real-time updates with nothing saying so.
#
# `None` keys the .env connection - it has no Institution row, which is exactly
# what distinguishes it.

REALTIME_RESCAN_S = 60

_realtime_tasks: dict[str | None, asyncio.Task] = {}
# Connections whose listener stopped and must not be restarted on a timer.
# listen_forever() only ever returns after an authentication failure, which no
# amount of retrying fixes - a human has to reconnect from Settings. Restarting
# those on the rescan would be an endless reconnect loop against a dead session.
_realtime_stopped: set[str | None] = set()
# The connections the last reconcile found configured. Kept so /realtime/status
# can answer for one that is configured but has no task yet (the supervisor
# runs on a timer) without going back to the database on every Settings render.
_realtime_wanted: set[str | None] = set()


def realtime_enabled() -> bool:
    """Opt-in, still. Kept as an explicit switch rather than turned on by
    default because it is what decides whether this container holds persistent
    outbound connections at all - now potentially one per user, not one per
    instance. What changed in v2.3 is only that it no longer implies TR_PHONE:
    the flag now governs every Trade Republic connection, .env or not."""
    return os.environ.get("TR_REALTIME_ENABLED") == "true"


def _wanted_realtime_connections() -> set[str | None]:
    """Every Trade Republic connection that should have a live listener.

    Raises rather than returning a partial set on a DB error: an empty result
    is indistinguishable from "no connections configured", and the caller would
    tear down every healthy listener over one failed query.
    """
    wanted: set[str | None] = set()
    if os.environ.get("TR_PHONE") and os.environ.get("TR_PIN"):
        wanted.add(None)
    from db import get_conn, get_tr_institutions
    conn = get_conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        for inst in get_tr_institutions(cur):
            wanted.add(inst["id"])
        cur.close()
    finally:
        conn.close()
    return wanted


def _harvest_finished_listeners() -> None:
    """Move any task that has ended into the stopped set.

    listen_forever() returns only on an authentication failure and raises only
    on a bug, and neither is worth retrying on a timer - a crash loop reconnects
    to Trade Republic every minute forever, which is exactly the traffic pattern
    that gets an account flagged.
    """
    # Collected before anything is removed: this loop mutates the dict it
    # reads from, so the two steps cannot share an iterator.
    finished = [key for key, task in _realtime_tasks.items() if task.done()]
    for key in finished:
        task = _realtime_tasks.pop(key)
        _realtime_stopped.add(key)
        if task.cancelled():
            continue
        exc = task.exception()
        if exc:
            log.warning("TR realtime listener for %s ended unexpectedly: %s", key or ".env", exc)
        else:
            log.info("TR realtime listener for %s stopped, waiting for a reconnect", key or ".env")


async def _reconcile_realtime_listeners() -> None:
    loop = asyncio.get_event_loop()
    try:
        wanted = await loop.run_in_executor(executor, _wanted_realtime_connections)
    except Exception:
        log.exception("TR realtime: could not list connections, leaving current listeners alone")
        return

    _realtime_wanted.clear()
    _realtime_wanted.update(wanted)
    _harvest_finished_listeners()

    # Same reason as _harvest_finished_listeners: collect, then remove.
    gone = [key for key in _realtime_tasks if key not in wanted]
    for key in gone:
        log.info("TR realtime: connection %s is gone, stopping its listener", key or ".env")
        _realtime_tasks.pop(key).cancel()
    # A connection that disappears also forgets it was stopped, so re-adding it
    # later starts clean instead of staying silently dead.
    _realtime_stopped.intersection_update(wanted)

    from sync_tr_realtime import listen_forever
    for key in wanted:
        if key in _realtime_tasks or key in _realtime_stopped:
            continue
        _realtime_tasks[key] = asyncio.create_task(listen_forever(key))
        log.info("TR realtime: listener started for %s", key or ".env")


def resume_realtime(institution_id: str | None) -> None:
    """Let a stopped listener start again on the next reconcile.

    Called right after a successful reconnection ceremony: that is the single
    moment a dead session becomes live again, and the only signal this process
    gets that retrying is worth anything.
    """
    _realtime_stopped.discard(institution_id)


async def _realtime_supervisor() -> None:
    while True:
        try:
            await _reconcile_realtime_listeners()
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("TR realtime: reconcile failed")
        await asyncio.sleep(REALTIME_RESCAN_S)


async def _shutdown_realtime_listeners() -> None:
    tasks = list(_realtime_tasks.values())
    _realtime_tasks.clear()
    for task in tasks:
        task.cancel()
    for task in tasks:
        with suppress(asyncio.CancelledError):
            await task

def listener_states() -> dict:
    """Process state of every known connection, for GET /realtime/status.

    Deliberately reports process state, not database state: a listener can be
    configured and still not be running (flag off, session expired, just
    crashed), and that gap is the entire point of the endpoint.
    """
    _harvest_finished_listeners()
    live = {key for key, task in _realtime_tasks.items() if not task.done()}

    def state(key: str | None) -> str:
        if not realtime_enabled():
            return "disabled"
        if key in live:
            return "listening"
        return "stopped" if key in _realtime_stopped else "starting"

    known = live | _realtime_stopped | _realtime_wanted
    return {
        "enabled": realtime_enabled(),
        "env": state(None) if os.environ.get("TR_PHONE") else "unconfigured",
        "institutions": {key: state(key) for key in known if key is not None},
    }
