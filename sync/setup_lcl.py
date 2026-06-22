"""
LCL web login setup — Certicode Plus flow via woob.

Flow:
  1. POST /sync/lcl/setup/start
     → woob initiates the LCL connection with credentials
     → LCL sends a Certicode Plus push notification to the mobile app
     → Returns {"status": "pending_approval"}

  2. POST /sync/lcl/setup/complete
     → woob calls iter_accounts on the same session (cookies preserved)
     → If the user approved in the LCL app → session established
     → Returns {"accounts": N}
"""
import logging
import os
from pathlib import Path

log = logging.getLogger(__name__)

# In-memory state between start and complete
_pending: dict | None = None  # {"w": Woob instance}


def _configure_woob():
    config_dir = Path.home() / ".config" / "woob"
    config_dir.mkdir(parents=True, exist_ok=True)
    backends_file = config_dir / "backends"
    backends_file.write_text(
        "[lcl]\n"
        "_module = lcl\n"
        f"login = {os.environ['LCL_LOGIN']}\n"
        f"password = {os.environ['LCL_PASSWORD']}\n"
    )
    backends_file.chmod(0o600)


def _iter_accounts(w):
    """Iterate LCL accounts, ignoring bourse errors (410 Gone)."""
    from woob.core.bcall import CallErrors
    accounts = []
    try:
        for result in w.do("iter_accounts", backends="lcl"):
            accounts.append(result)
    except CallErrors as e:
        for backend, exc, tb in e.errors:
            msg = (str(exc) + tb).lower()
            if "bourse" in msg or "connectionreset" in msg or "connection aborted" in msg:
                log.info("LCL setup: bourse unreachable (ignored): %s", exc)
            else:
                raise
    return accounts


def start_setup() -> dict:
    global _pending
    _cleanup()
    _configure_woob()

    from woob.core import Woob
    from woob.exceptions import AppValidation, AppValidationExpired, NeedInteractiveFor2FA, NeedInteractive

    w = Woob()
    w.load_backends(modules=["lcl"])

    try:
        accounts = _iter_accounts(w)
        # Session still valid — no Certicode Plus needed
        log.info("LCL setup: session already valid (%d accounts)", len(accounts))
        try:
            w.deinit()
        except Exception:
            pass
        return {"status": "already_connected", "accounts": len(accounts)}

    except AppValidationExpired:
        try:
            w.deinit()
        except Exception:
            pass
        raise RuntimeError("Certicode Plus validation expired before approval — try again")

    except (AppValidation, NeedInteractiveFor2FA, NeedInteractive):
        # Certicode Plus sent — keep the woob instance alive for complete_setup
        _pending = {"w": w}
        log.info("LCL setup: Certicode Plus sent — waiting for user approval")
        return {"status": "pending_approval"}


def complete_setup() -> dict:
    global _pending
    if _pending is None:
        raise RuntimeError("No LCL setup in progress — call start first")

    w = _pending["w"]
    from woob.exceptions import AppValidationExpired, AppValidation, NeedInteractiveFor2FA, NeedInteractive

    try:
        accounts = _iter_accounts(w)
    except AppValidationExpired:
        _cleanup()
        raise RuntimeError("Certicode Plus validation expired — restart the connection")
    except (AppValidation, NeedInteractiveFor2FA, NeedInteractive):
        # Not yet approved in the LCL app
        raise RuntimeError("Connection not yet approved in the LCL app — retry in a few seconds")

    count = len(accounts)
    _cleanup()
    log.info("LCL setup: session established — %d account(s)", count)
    return {"accounts": count}


def _cleanup():
    global _pending
    if _pending is None:
        return
    try:
        _pending["w"].deinit()
    except Exception:
        pass
    _pending = None
