"""
Trade Republic web login setup — délègue à pytr (PR #327 mergé dans master).

Depuis pytr master, initiate_weblogin() obtient le token AWS WAF via Playwright
en interne. Plus besoin de gérer le contexte Playwright manuellement.

Flow :
  1. POST /sync/trade-republic/setup/start
     → Crée TradeRepublicApi avec save_cookies=True
     → api.initiate_weblogin() : pytr ouvre Chromium headless, récupère le WAF token,
       fait POST /api/v1/auth/web/login
     → TR envoie un code à 4 chiffres sur le téléphone
     → Retourne {"countdown": N}

  2. POST /sync/trade-republic/setup/complete  {"code": "1234"}
     → api.complete_weblogin(code) : fait POST /api/v1/auth/web/login/{processId}/{code}
       et sauvegarde automatiquement les cookies (sans WAF token) dans
       ~/.pytr/cookies.<phone>.txt
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

    from pytr.api import TradeRepublicApi

    api = TradeRepublicApi(phone_no=phone_no, pin=pin, save_cookies=True)

    log.info("TR setup: initiation du web login via pytr (WAF token via Playwright)…")
    countdown = api.initiate_weblogin()
    countdown = int(countdown) + 1 if countdown else 181

    log.info("TR setup: login initié — code valide %ds", countdown)
    _pending = {"api": api}
    return {"countdown": countdown}


def complete_setup(code: str) -> None:
    if _pending is None:
        raise RuntimeError("Aucun login en attente — relance /setup/start d'abord")

    api = _pending["api"]
    log.info("TR setup: completion du login avec le code…")
    api.complete_weblogin(code)  # sauvegarde les cookies automatiquement

    log.info("TR setup: session sauvegardée dans %s", api._cookies_file)
    _cleanup()


def _cleanup() -> None:
    global _pending
    _pending = None
