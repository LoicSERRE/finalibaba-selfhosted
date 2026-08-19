"""
Generic Woob interactive setup - works with any Woob-compatible bank module
configured via Settings -> "Configurer Woob" (Institution.woobModule/
woobLogin/woobPassword in the DB, not env vars - see sync_woob.py).

Mirrors setup_lcl.py's start/complete shape, generalised to any institution
and to the two families of 2FA Woob actually raises (confirmed against
woob==3.7's own woob/exceptions.py and woob/tools/application/console.py -
its reference CLI implementation - rather than guessed):

  - "wait and approve" (AppValidation/DecoupledValidation and friends,
    e.g. LCL's Certicode Plus): nothing to submit, just retry iter_accounts
    once the user has approved on their end.
  - "enter a code" (SentOTPQuestion/OfflineOTPQuestion, e.g. an SMS code):
    the exception carries `.fields` - Value objects whose `.id` is a
    backend config key. console.py's own bcall_error_handler does exactly
    `backend.config[field.id].set(v)` then retries - that's the only
    documented way to feed the code back in, so this does the same.

A handful of Woob exceptions genuinely can't be driven from a web form
(CaptchaQuestion, BrowserRedirect, ActionNeeded and its subclasses like
BrowserPasswordExpired) - those surface as {"status": "unsupported"} with
Woob's own message, no retry loop offered.

Flow (mirrors setup_lcl.py's two-endpoint shape):
  1. POST /sync/institution/{id}/setup/start
     -> reads credentials from the Institution row, attempts iter_accounts
  2. POST /sync/institution/{id}/setup/complete   {"code": "..."}  (code optional)
     -> resumes the same Woob session
"""
import logging

import psycopg2.extras

from db import get_conn
from sync_woob import _configure_woob

log = logging.getLogger(__name__)

# One pending Woob session per institution - unlike setup_lcl.py's single
# global, several institutions could plausibly be mid-setup at once here.
_pending: dict[str, dict] = {}


def _backend_name(institution_id: str) -> str:
    # Same sanitisation/truncation as sync_woob.py's run() - must match so a
    # session started here is found by the next scheduled/manual sync.
    return f"inst_{institution_id.replace('-', '_')[:20]}"


def _fetch_institution(institution_id: str) -> dict | None:
    conn = get_conn()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute(
        'SELECT id, name, "woobModule", "woobLogin", "woobPassword" FROM "Institution" WHERE id = %s',
        (institution_id,),
    )
    row = cur.fetchone()
    cur.close()
    conn.close()
    return row


def _safe_deinit(w):
    try:
        w.deinit()
    except Exception as e:
        log.debug("woob deinit failed (ignored): %s", e)


def _iter_accounts(w, backend_name: str) -> list:
    """Same bourse/connection-reset tolerance as sync_woob.py's own
    _iter_accounts - duplicated rather than imported since that version
    takes an institution_name purely for logging, not worth threading
    through here too."""
    from woob.core.bcall import CallErrors
    accounts = []
    try:
        for result in w.do("iter_accounts", backends=backend_name):
            accounts.append(result)  # noqa: PERF402 - must keep partial results gathered before a mid-iteration CallErrors
    except CallErrors as e:
        for _backend, exc, tb in e.errors:
            msg = (str(exc) + tb).lower()  # NOSONAR - see sync_woob.py's identical line
            if any(k in msg for k in ("bourse", "connectionreset", "connection aborted", "410")):
                log.warning("setup: sub-module error ignored: %s", str(exc)[:120])
            else:
                raise exc
    return accounts


def _try_connect(w, backend_name: str) -> dict:
    """Attempts iter_accounts and buckets whatever 2FA exception comes back
    into the three UI-facing shapes described in this module's docstring."""
    from woob.exceptions import (
        ActionNeeded,
        AppValidation,
        AppValidationExpired,
        BrowserRedirect,
        CaptchaQuestion,
        DecoupledValidation,
        NeedInteractive,
        NeedInteractiveFor2FA,
        OTPQuestion,
    )

    try:
        accounts = _iter_accounts(w, backend_name)
        return {"status": "already_connected", "accounts": len(accounts)}

    # SentOTPQuestion/OfflineOTPQuestion are both OTPQuestion subclasses -
    # catching the base covers either without needing to distinguish them
    # (both resolve the exact same way: fill in `.fields`, retry).
    except OTPQuestion as e:
        backend = w.get_backend(backend_name)
        field_ids = [f.id for f in e.fields]
        _pending[backend_name] = {"w": w, "field_ids": field_ids}
        medium_label = getattr(e, "medium_label", None)
        medium_type = getattr(e, "medium_type", None)
        log.info("Woob setup: code requested for %s (medium=%s)", backend.name, medium_type)
        return {
            "status": "code_required",
            "medium_type": medium_type,
            "medium_label": medium_label,
            "message": str(e) or None,
        }

    except (AppValidation, DecoupledValidation, NeedInteractiveFor2FA, NeedInteractive) as e:
        _pending[backend_name] = {"w": w, "field_ids": []}
        medium_label = getattr(e, "medium_label", None)
        log.info("Woob setup: approval pending for %s", backend_name)
        return {"status": "pending_approval", "medium_label": medium_label, "message": str(e) or None}

    except AppValidationExpired:
        _safe_deinit(w)
        raise RuntimeError("Validation expirée avant d'être approuvée - relance la connexion")

    except (ActionNeeded, CaptchaQuestion, BrowserRedirect) as e:
        _safe_deinit(w)
        return {"status": "unsupported", "message": str(e) or "Cette banque nécessite une action non prise en charge automatiquement"}


def start_setup(institution_id: str) -> dict:
    _cleanup(institution_id)

    inst = _fetch_institution(institution_id)
    if not inst:
        raise RuntimeError("Institution introuvable")
    if not inst["woobModule"]:
        raise RuntimeError("Aucun module Woob configuré pour cette institution")

    backend_name = _backend_name(institution_id)
    _configure_woob(backend_name, inst["woobModule"], inst["woobLogin"], inst["woobPassword"])

    from woob.core import Woob
    w = Woob()
    try:
        w.load_backends(modules=[inst["woobModule"]], names=[backend_name])
    except Exception as e:
        raise RuntimeError(f"Échec du chargement du module Woob '{inst['woobModule']}': {e}") from e

    return _try_connect(w, backend_name)


def complete_setup(institution_id: str, code: str | None = None) -> dict:
    backend_name = _backend_name(institution_id)
    pending = _pending.get(backend_name)
    if pending is None:
        raise RuntimeError("Aucune configuration en cours pour cette institution - relance la connexion")

    w = pending["w"]
    if pending["field_ids"]:
        if not code:
            raise RuntimeError("Code manquant")
        backend = w.get_backend(backend_name)
        for field_id in pending["field_ids"]:
            backend.config[field_id].set(code)

    from woob.exceptions import AppValidationExpired

    try:
        result = _try_connect(w, backend_name)
    except AppValidationExpired:
        _cleanup(institution_id)
        raise

    if result["status"] in ("pending_approval", "code_required"):
        # Still not approved / wrong code - keep the session alive so the
        # user can retry without starting over.
        raise RuntimeError(result.get("message") or "Connexion non encore approuvée - réessaie dans quelques secondes")

    _cleanup(institution_id)
    return result


def _cleanup(institution_id: str) -> None:
    backend_name = _backend_name(institution_id)
    pending = _pending.pop(backend_name, None)
    if pending is not None:
        _safe_deinit(pending["w"])
