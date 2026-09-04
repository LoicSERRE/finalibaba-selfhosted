"""A scheduled sync must not run while an interactive setup is in flight.

From issue #51, and this is the defect that actually stranded the user rather
than any of the ones fixed before it. The timeline from a real container log:

    08:38:52  captcha solved, approval pending, notification sent to the phone
    08:39:21  user approves, setup starts polling for the token
    08:41:05  a full sync runs against the SAME bank
    08:42:21  polling gives up after its full 180s, token never appeared

The approval was fine. The competing session opened at 08:41:05 invalidated the
mfa_id the setup was polling, so the token it waited for could never arrive.
"""

import time

import setup_locks
import sync_woob


def setup_function():
    setup_locks._active.clear()


def test_a_sync_is_skipped_while_a_setup_is_in_flight(monkeypatch):
    """The core guard. Skipped, not failed: run() must return without touching
    Woob at all."""
    called = []
    monkeypatch.setattr(sync_woob, "_configure_woob", lambda *a, **k: called.append(a))

    setup_locks.mark_setup_started("inst-1")
    result = sync_woob.run("inst-1", "Amundi", "amundi", "login", "pw")

    assert result["skipped"] == "setup_in_progress"
    assert called == [], "no Woob session may be opened while a validation is pending"


def test_skipping_writes_no_sync_log(monkeypatch):
    """A skip is not a failure. Writing a SyncLog row would raise a failure
    alert for a bank that is in the middle of being connected properly."""
    monkeypatch.setattr(sync_woob, "_configure_woob", lambda *a, **k: None)
    wrote = []
    monkeypatch.setattr(sync_woob, "_fail", lambda *a, **k: wrote.append(a))

    setup_locks.mark_setup_started("inst-1")
    sync_woob.run("inst-1", "Amundi", "amundi", "login", "pw")

    assert wrote == [], "a skip must not look like a sync failure"


def test_an_unrelated_institution_still_syncs(monkeypatch):
    """The lock is per institution - one bank being set up must not freeze the
    others."""
    monkeypatch.setattr(sync_woob, "_configure_woob", lambda *a, **k: None)

    setup_locks.mark_setup_started("inst-1")

    assert setup_locks.is_setup_in_progress("inst-1") is True
    assert setup_locks.is_setup_in_progress("inst-2") is False


def test_the_lock_is_released_when_the_setup_finishes():
    setup_locks.mark_setup_started("inst-1")
    setup_locks.clear_setup("inst-1")
    assert setup_locks.is_setup_in_progress("inst-1") is False


def test_an_abandoned_setup_cannot_block_syncing_for_good(monkeypatch):
    """A user who walks away mid-setup must not disable that bank's sync
    permanently - the entry expires on its own."""
    setup_locks.mark_setup_started("inst-1")
    # Pretend the TTL has elapsed rather than sleeping through it. The real
    # clock is read ONCE up front: a lambda calling time.monotonic() would call
    # the patched version and recurse forever.
    later = time.monotonic() + setup_locks._TTL_S + 1
    monkeypatch.setattr(setup_locks.time, "monotonic", lambda: later)

    assert setup_locks.is_setup_in_progress("inst-1") is False
    assert "inst-1" not in setup_locks._active, "the stale entry must be dropped, not just ignored"
