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

A captcha CAN be driven from a web form, and is: the exception carries the
reCAPTCHA site key, the browser renders the real widget, the human solves it,
and the token comes back as `captcha_response` - the same path an SMS code
takes. That is the mechanism Woob intends; a paid solving service is merely
the other way to fill the same field, and is deliberately not used here.

What genuinely can't be driven from a web form is narrower than it looks:
BrowserRedirect and ActionNeeded (including subclasses like
BrowserPasswordExpired) surface as {"status": "unsupported"} with Woob's own
message, no retry loop offered.

Flow (mirrors setup_lcl.py's two-endpoint shape):
  1. POST /sync/institution/{id}/setup/start
     -> reads credentials from the Institution row, attempts iter_accounts
  2. POST /sync/institution/{id}/setup/complete   {"code": "..."}  (code optional)
     -> resumes the same Woob session
"""
import logging

import psycopg2.extras

import setup_locks
from db import get_conn
from sync_woob import _configure_woob, make_woob, persist_accounts

log = logging.getLogger(__name__)


class SetupError(Exception):
    """A setup failure with a message that's always safe to show the user
    as-is - the message is set explicitly at construction, never derived
    from str(exception)/.args of whatever caused it, so main.py's handler
    can surface it in an HTTP response without CodeQL (correctly) flagging
    exception-derived data reaching a client - the class itself, not a
    try/except on RuntimeError, is what makes "safe to show" verifiable:
    every SetupError's message was written by this module on purpose.
    """
    def __init__(self, user_message: str):
        self.user_message = user_message
        super().__init__(user_message)


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


def _mark_interactive(backend) -> None:
    """Tell Woob this is an interactive session by giving `request_information`
    a non-None value.

    Woob's own base browser treats `request_information is None` as "batch mode,
    do NOT trigger a 2FA challenge" and raises NeedInteractiveFor2FA instead of
    driving the real one. A dict (it may carry PSD2 headers, empty is fine) is
    what flips it to "interactive, go ahead". The reference CLI sets exactly
    this before every attempt (ReplApplication._do_and_retry). No-op for a
    module without the field.
    """
    key = "request_information"
    if key in backend.config and backend.config[key].get() is None:
        backend.config[key].set({})


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
        # The list travels with the result, under a private key the HTTP layer
        # strips: whoever called us must be able to WRITE these accounts while
        # this session is still alive. Returning only the count is what left the
        # database empty after a successful setup (issue #51) - see
        # sync_woob.persist_accounts for why a later sync cannot re-fetch them.
        return {"status": "already_connected", "accounts": len(accounts), "_accounts": accounts}

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
        raise SetupError("Validation expirée avant d'être approuvée - relance la connexion")

    # A captcha is NOT in the unsupported family, despite where it started.
    # The module raises it only because nothing supplied an answer: give
    # `captcha_response` a value and the login proceeds normally (see the
    # Amundi module, browser.py around the RecaptchaV2Question raise). The
    # exception carries website_key and website_url precisely so a caller can
    # put the challenge in front of a HUMAN - which is what the UI now does.
    #
    # This is the one field id Woob does not list in `.fields` the way an OTP
    # does, so it is named here. Everything downstream is unchanged:
    # complete_setup sets it exactly like an SMS code, and if the bank then
    # also wants a phone approval (Amundi does), _try_connect's AppValidation
    # branch takes over and re-stores the session with no fields left to set.
    except CaptchaQuestion as e:
        _pending[backend_name] = {"w": w, "field_ids": ["captcha_response"]}
        log.info("Woob setup: captcha requested for %s", backend_name)
        return {
            "status": "captcha_required",
            "website_key": getattr(e, "website_key", None),
            "website_url": getattr(e, "website_url", None),
            "message": str(e) or None,
        }

    except (ActionNeeded, BrowserRedirect) as e:
        _safe_deinit(w)
        return {"status": "unsupported", "message": str(e) or "Cette banque nécessite une action non prise en charge automatiquement"}


def _persist_connected(result: dict, w, backend_name: str, institution_id: str) -> dict:
    """Write the accounts a just-established session fetched, before anything
    tears that session down.

    Called on the success path of BOTH entry points, because for an MFA bank
    this is the only moment its data can be written at all - see
    sync_woob.persist_accounts. `_accounts` is popped either way so it never
    reaches the HTTP response.
    """
    accounts = result.pop("_accounts", None)
    if result.get("status") != "already_connected" or not accounts:
        return result

    inst = _fetch_institution(institution_id)
    name = inst["name"] if inst else institution_id
    try:
        written = persist_accounts(w, backend_name, institution_id, name, accounts)
        result["synced"] = len(written.get("synced", []))
    except Exception:
        # The session IS established, so this is not a setup failure - but the
        # user must not be told everything worked while the database stayed
        # empty, which is exactly how issue #51 presented.
        log.exception("Setup connected %s but writing its accounts failed", name)
        result["persist_failed"] = True
    return result


def start_setup(institution_id: str) -> dict:
    _cleanup(institution_id)

    inst = _fetch_institution(institution_id)
    if not inst:
        raise SetupError("Institution introuvable")
    if not inst["woobModule"]:
        raise SetupError("Aucun module Woob configuré pour cette institution")

    backend_name = _backend_name(institution_id)
    # From here until _cleanup, no scheduled sync may open a competing session
    # on this bank - see setup_locks for the Amundi approval it silently broke.
    setup_locks.mark_setup_started(institution_id)
    _configure_woob(backend_name, inst["woobModule"], inst["woobLogin"], inst["woobPassword"])

    # Same storage as the sync path, deliberately: what this setup
    # authenticates is exactly what the next sync must reuse.
    w = make_woob()
    try:
        w.load_backends(modules=[inst["woobModule"]], names=[backend_name])
    except Exception as e:
        log.exception("Failed to load Woob module '%s' for institution %s", inst["woobModule"], institution_id)
        raise SetupError(
            f"Échec du chargement du module Woob '{inst['woobModule']}' - vérifie que le nom du module est correct"
        ) from e

    _mark_interactive(w.get_backend(backend_name))
    result = _persist_connected(_try_connect(w, backend_name), w, backend_name, institution_id)
    if result["status"] == "already_connected":
        _cleanup(institution_id)
    return result


def complete_setup(institution_id: str, code: str | None = None) -> dict:
    backend_name = _backend_name(institution_id)
    pending = _pending.get(backend_name)
    if pending is None:
        raise SetupError("Aucune configuration en cours pour cette institution - relance la connexion")

    w = pending["w"]
    backend = w.get_backend(backend_name)
    _mark_interactive(backend)
    if pending["field_ids"]:
        if not code:
            raise SetupError("Code manquant")
        for field_id in pending["field_ids"]:
            backend.config[field_id].set(code)
    else:
        # An empty field list means a decoupled app validation is pending - the
        # phone approval Amundi asks for after the captcha. Woob resumes it
        # ONLY when the `resume` config key carries a value: do_login calls the
        # polling handler when it does, and otherwise falls straight through to
        # init_login and restarts the whole flow from scratch - a fresh captcha
        # and a fresh approval. That is exactly why the approval never
        # completed and the connection stuck in "pending" (issue #51): every
        # "I've approved it" click re-ran init_login instead of finishing.
        # Mirrors the reference CLI's DecoupledValidation branch
        # (ReplApplication._do_and_retry), which hardcodes this same key.
        if "resume" in backend.config:
            backend.config["resume"].set(True)

    from woob.exceptions import AppValidationExpired

    try:
        result = _try_connect(w, backend_name)
    except AppValidationExpired:
        _cleanup(institution_id)
        raise

    if result["status"] == "captcha_required":
        # The bank asked AGAIN, which means the token was refused - expired
        # (they last about two minutes) or simply not accepted. Must not fall
        # through to the success return below: main.py hands that straight
        # back as a 200 and the UI would report a connection that never
        # happened. The session is dropped rather than kept, because retrying
        # needs a freshly solved captcha and the widget on screen is already
        # spent - the caller starts over.
        _cleanup(institution_id)
        raise SetupError("Captcha refusé ou expiré - relance la connexion pour en obtenir un nouveau")

    if result["status"] in ("pending_approval", "code_required"):
        # NOT a failure: the bank answered a completed step with another step
        # rather than with a session. Amundi does exactly this - a solved
        # captcha is followed by a phone approval - and _try_connect has
        # already re-stored the session with whatever fields remain to be
        # filled (none, for an approval), so this is resumable by design.
        #
        # Raising here turned that resumable state into a red error, and the
        # UI - which correctly drops a spent captcha widget on any failure -
        # then fell back to the Connect button. So every retry restarted from
        # a fresh captcha and triggered a fresh phone prompt, and the flow
        # could never converge. Reported from a real Amundi account, where it
        # made the bank impossible to connect at all despite the captcha
        # itself working.
        #
        # Returned as a value so the caller can render the right panel: the
        # same "model expected errors as return values" rule this repo already
        # applies to Server Actions. The session is deliberately NOT cleaned
        # up - it is what the next call resumes.
        return result

    result = _persist_connected(result, w, backend_name, institution_id)
    _cleanup(institution_id)
    return result


def _cleanup(institution_id: str) -> None:
    setup_locks.clear_setup(institution_id)
    backend_name = _backend_name(institution_id)
    pending = _pending.pop(backend_name, None)
    if pending is not None:
        _safe_deinit(pending["w"])
