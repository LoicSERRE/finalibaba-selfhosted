"""Which syncs are running right now, in this process.

The app shows a "sync in progress" badge, and it used to have no way to know
whether one was actually running: it fired a request, then waited for a new
SyncLog row to appear. A sync that writes none - nothing configured, or a
second request arriving while the first still ran - left the badge up until a
two-minute timeout, and nothing stopped every page load from queueing another
full sync behind the one in progress.

This answers the question directly. Every sync job runs inside `tracking(key)`;
`running()` lists the keys currently held; a trigger can refuse to queue a key
that is already running. Counted rather than a set, so the same key run twice
concurrently (the cron and a manual trigger) stays "running" until both end.

In-memory and per-process, which is correct here: uvicorn runs a single worker
(see main.py), and the state only describes work this process is doing.
"""
import threading
from collections.abc import Iterator
from contextlib import contextmanager

_lock = threading.Lock()
_running: dict[str, int] = {}


@contextmanager
def tracking(key: str) -> Iterator[None]:
    """Marks `key` as running for the duration of the block, even if it raises."""
    with _lock:
        _running[key] = _running.get(key, 0) + 1
    try:
        yield
    finally:
        with _lock:
            remaining = _running.get(key, 1) - 1
            if remaining <= 0:
                _running.pop(key, None)
            else:
                _running[key] = remaining


def is_running(key: str) -> bool:
    with _lock:
        return key in _running


def running() -> list[str]:
    with _lock:
        return sorted(_running)


def _reset_for_tests() -> None:
    with _lock:
        _running.clear()


def tracked(key):
    """Decorator form of `tracking`. `key` is a string, or a function of the
    wrapped call's positional arguments for per-institution jobs."""
    import functools

    def decorate(fn):
        @functools.wraps(fn)
        def wrapper(*args, **kwargs):
            with tracking(key(*args) if callable(key) else key):
                return fn(*args, **kwargs)
        return wrapper

    return decorate
