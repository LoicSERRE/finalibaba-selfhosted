"""
Trade Republic setup for the TR_PHONE/TR_PIN connection from the environment,
on Trade Republic's v2 web login (see setup_tr_institution.py, the per-user
equivalent).

  1. POST /sync/trade-republic/setup/start
     -> {"status": "pending_approval" | "code_required", "countdown": N}
  2. POST /sync/trade-republic/setup/complete  {"code": "123456" | null}
     -> waits until the login is approved in the Trade Republic app (or checks
        the authenticator code), then saves the cookies to ~/.pytr.
"""
import logging
import os

log = logging.getLogger(__name__)

# État en mémoire entre start et complete
_pending: dict | None = None  # {"api": TradeRepublicApi}


def start_setup() -> dict:
    global _pending
    _cleanup()

    phone_no = os.environ["TR_PHONE"]
    pin = os.environ["TR_PIN"]

    from sync_tr import login_step, new_tr_api

    api = new_tr_api(phone_no=phone_no, pin=pin, save_cookies=True)

    log.info("TR setup: initiation du web login via pytr…")
    step = login_step(api, api.initiate_weblogin())

    log.info("TR setup: login initié - %s pendant %ds", step["status"], step["countdown"])
    _pending = {"api": api}
    return step


def complete_setup(code: str | None = None) -> None:
    if _pending is None:
        raise RuntimeError("Aucun login en attente - relance /setup/start d'abord")

    api = _pending["api"]
    log.info("TR setup: attente de la validation du login…")
    try:
        # Waits for the approval in the app, then saves the cookies.
        api.complete_weblogin(code if api.weblogin_needs_authenticator else None)
    except TimeoutError:
        _cleanup()
        raise

    log.info("TR setup: session sauvegardée dans %s", api._cookies_file)
    _cleanup()


def _cleanup() -> None:
    global _pending
    _pending = None
