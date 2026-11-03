"""Interactive Trade Republic setup for a UI-configured institution.

The per-user counterpart to setup_tr.py, which drives the single
TR_PHONE/TR_PIN connection configured in the environment and belongs to the
instance owner. That module is deliberately left untouched: it keeps working
exactly as before, the same way setup_lcl.py was left alone when
setup_woob.py generalised the Woob path in v1.12.

Shape follows setup_woob.py rather than setup_tr.py, because the same
constraint applies: several institutions can plausibly be mid-setup at once
(two family members adding their accounts on the same evening), so pending
state is keyed by institution id instead of a single module-level global.

Trade Republic's v2 web login has two outcomes: the user approves it in the
mobile app (pending_approval, then complete_setup waits for it), or, with an
authenticator app enabled, types its code (code_required).
"""

import logging

from sync_tr import (
    _get_api,
    fetch_tr_institution,
    login_step,
    new_tr_api,
    tr_cookies_path,
)

log = logging.getLogger(__name__)

# institution_id -> {"api": TradeRepublicApi}
#
# In-memory and single-process, the same accepted scope as setup_woob.py's own
# _pending and lib/services/realtime-bus.ts: this container runs one uvicorn
# worker, and a setup that does not complete before a restart simply has to be
# started again.
_pending: dict[str, dict] = {}


class SetupError(Exception):
    """Carries a message meant for the user, not a stack trace."""

    def __init__(self, user_message: str):
        super().__init__(user_message)
        self.user_message = user_message


def _require_credentials(institution_id: str) -> dict:
    inst = fetch_tr_institution(institution_id)
    if not inst:
        raise SetupError("Institution introuvable.")
    if not inst["trPhone"] or not inst["trPin"]:
        raise SetupError(
            "Renseigne d'abord le numéro de téléphone et le code PIN Trade Republic de cette institution."
        )
    return inst


def start_setup(institution_id: str) -> dict:
    """Start a Trade Republic login, which the user approves in the app.

    Returns what the user has to do - approve in the app (pending_approval)
    or type an authenticator code (code_required) - and for how long.
    """
    _cleanup(institution_id)
    inst = _require_credentials(institution_id)

    # A session that still resumes needs no code at all - report that instead
    # of pointlessly pushing a notification to the user's phone.
    try:
        _get_api(
            inst["trPhone"], inst["trPin"], interactive=False, scope_institution_id=institution_id
        )
        _cleanup(institution_id)
        return {"status": "already_connected"}
    except Exception as e:
        # No usable saved session, which is the normal case when someone is
        # deliberately (re)connecting. Logged rather than swallowed so a real
        # failure here (a broken cookie file, a pytr change) is still traceable.
        log.debug("TR setup (%s): no resumable session, starting a fresh login - %s", institution_id, e)

    cookies_file = tr_cookies_path(institution_id)
    cookies_file.parent.mkdir(parents=True, exist_ok=True)

    api = new_tr_api(
        phone_no=inst["trPhone"],
        pin=inst["trPin"],
        save_cookies=True,
        cookies_file=str(cookies_file),
    )

    log.info("TR setup (%s): initiating web login", inst["name"])
    try:
        countdown = api.initiate_weblogin()
    except Exception as e:
        raise SetupError(
            f"Trade Republic a refusé la connexion : {str(e)[:200]}"
        ) from e

    step = login_step(api, countdown)
    _pending[institution_id] = {"api": api}
    log.info("TR setup (%s): %s for %ds", inst["name"], step["status"], step["countdown"])
    return step


def complete_setup(institution_id: str, code: str | None = None) -> dict:
    """Wait for the user to approve the login in the app (or check their
    authenticator code), then save the session. Blocks until Trade Republic
    answers, up to the login's own expiry (about two minutes)."""
    entry = _pending.get(institution_id)
    if not entry:
        raise SetupError("Aucune connexion en attente - relance la configuration.")

    api = entry["api"]
    needs_code = api.weblogin_needs_authenticator
    if needs_code and not code:
        raise SetupError("Saisis le code de ton application d'authentification.")
    try:
        api.complete_weblogin(code if needs_code else None)  # persists cookies to our per-institution file
    except TimeoutError as e:
        _cleanup(institution_id)
        raise SetupError("Connexion non validée à temps dans l'app Trade Republic - relance-la.") from e
    except Exception as e:
        # Logged server-side, never forwarded: main.py's own SetupError handler
        # states the invariant that a user_message is written here at raise
        # time and never derived from str(exception), and this was the single
        # place breaking it. Same rule the backup route and the GoCardless
        # institutions route already follow - an upstream library's exception
        # text is not something to hand a browser.
        log.exception("TR setup (%s): weblogin completion refused", institution_id)
        if needs_code:
            # A typo: the login process is still open, so the code can be retyped.
            raise SetupError("Code refusé par Trade Republic - vérifie le code de ton application d'authentification.") from e
        _cleanup(institution_id)
        raise SetupError("Trade Republic n'a pas validé la connexion - relance-la.") from e

    log.info("TR setup (%s): session saved to %s", institution_id, api._cookies_file)
    _cleanup(institution_id)
    return {"status": "connected"}


def _cleanup(institution_id: str) -> None:
    _pending.pop(institution_id, None)
