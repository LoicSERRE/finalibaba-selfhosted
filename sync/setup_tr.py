"""
Trade Republic web login setup — delegates to pytr.

pytr's initiate_weblogin() obtains the AWS WAF token via Playwright internally.

Flow:
  1. POST /sync/trade-republic/setup/start
     → Creates TradeRepublicApi with save_cookies=True
     → api.initiate_weblogin(): pytr launches headless Chromium, retrieves the WAF token,
       sends POST /api/v1/auth/web/login
     → TR sends a 4-digit code to the registered phone
     → Returns {"countdown": N}

  2. POST /sync/trade-republic/setup/complete  {"code": "1234"}
     → api.complete_weblogin(code): sends POST /api/v1/auth/web/login/{processId}/{code}
       and saves cookies (without WAF token) to ~/.pytr/cookies.<phone>.txt
"""
import logging
import os

log = logging.getLogger(__name__)

# In-memory state between start and complete
_pending: dict | None = None  # {"api": TradeRepublicApi}


def start_setup() -> dict:
    global _pending
    _cleanup()

    phone_no = os.environ["TR_PHONE"]
    pin = os.environ["TR_PIN"]

    from pytr.api import TradeRepublicApi

    api = TradeRepublicApi(phone_no=phone_no, pin=pin, save_cookies=True)

    log.info("TR setup: initiating web login via pytr (WAF token via Playwright)…")
    countdown = api.initiate_weblogin()
    countdown = int(countdown) + 1 if countdown else 181

    log.info("TR setup: login initiated — code valid for %ds", countdown)
    _pending = {"api": api}
    return {"countdown": countdown}


def complete_setup(code: str) -> None:
    global _pending
    if _pending is None:
        raise RuntimeError("No pending login — call /setup/start first")

    api = _pending["api"]
    log.info("TR setup: completing login with the code…")
    api.complete_weblogin(code)  # saves cookies automatically

    log.info("TR setup: session saved to %s", api._cookies_file)
    _cleanup()


def _cleanup() -> None:
    global _pending
    _pending = None
