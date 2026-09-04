"""Which institutions are in the middle of an interactive setup.

Shared by setup_woob (which holds the live Woob session) and sync_woob (which
must not open a competing one). It is its own module because setup_woob already
imports sync_woob, so importing back the other way would be a cycle.

**Why this exists**, from a real failure (issue #51, Amundi). A bank whose login
ends in a phone approval accepts only ONE pending validation at a time. A
scheduled sync firing while the user is approving opens a second session and
invalidates the `mfa_id` the setup is polling, so the approval can never
complete. Observed exactly that way: the user approved on their phone, a full
sync ran 90 seconds later, and handle_polling still ran its whole 180-second
course without ever seeing the token. Nothing was wrong with the approval - it
simply no longer belonged to the session that was waiting for it.

Entries expire on their own, so a setup the user walked away from can never
block that institution's syncing for good.
"""

import time

# Generous next to a real setup (a captcha plus a phone approval is a couple of
# minutes at worst), short enough that an abandoned one is forgotten well before
# the next scheduled run matters.
_TTL_S = 15 * 60

_active: dict[str, float] = {}


def mark_setup_started(institution_id: str) -> None:
    _active[institution_id] = time.monotonic()


def clear_setup(institution_id: str) -> None:
    _active.pop(institution_id, None)


def is_setup_in_progress(institution_id: str) -> bool:
    started = _active.get(institution_id)
    if started is None:
        return False
    if time.monotonic() - started > _TTL_S:
        _active.pop(institution_id, None)
        return False
    return True
