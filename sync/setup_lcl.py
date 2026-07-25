"""
LCL web login setup — Certicode Plus flow via woob.

Flow :
  1. POST /sync/lcl/setup/start
     → woob initie la connexion LCL avec les credentials
     → LCL envoie une notification Certicode Plus dans l'app mobile
     → Retourne {"status": "pending_approval"}

  2. POST /sync/lcl/setup/complete
     → woob rappelle iter_accounts sur la même session (cookies conservés)
     → Si l'utilisateur a approuvé dans l'app LCL → session établie
     → Retourne {"accounts": N}
"""
import logging
import os
from pathlib import Path

log = logging.getLogger(__name__)

# État en mémoire entre start et complete
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
    """Itère les comptes LCL en ignorant les erreurs bourse (410 Gone)."""
    from woob.core.bcall import CallErrors
    accounts = []
    try:
        for result in w.do("iter_accounts", backends="lcl"):
            accounts.append(result)  # noqa: PERF402 — must keep partial results gathered before a mid-iteration CallErrors
    except CallErrors as e:
        for backend, exc, tb in e.errors:
            msg = (str(exc) + tb).lower()
            if "bourse" in msg or "connectionreset" in msg or "connection aborted" in msg:
                log.info("LCL setup: bourse inaccessible (ignoré) : %s", exc)
            else:
                raise
    return accounts


def start_setup() -> dict:
    global _pending
    _cleanup()
    _configure_woob()

    from woob.core import Woob
    from woob.exceptions import (
        AppValidation,
        AppValidationExpired,
        NeedInteractive,
        NeedInteractiveFor2FA,
    )

    w = Woob()
    w.load_backends(modules=["lcl"])

    try:
        accounts = _iter_accounts(w)
        # Session encore valide — pas besoin de Certicode Plus
        log.info("LCL setup: session déjà valide (%d comptes)", len(accounts))
        try:
            w.deinit()
        except Exception as e:
            log.debug("woob deinit failed (ignored): %s", e)
        return {"status": "already_connected", "accounts": len(accounts)}

    except AppValidationExpired:
        try:
            w.deinit()
        except Exception as e:
            log.debug("woob deinit failed (ignored): %s", e)
        raise RuntimeError("Validation Certicode Plus expirée avant d'être approuvée — réessaie")

    except (AppValidation, NeedInteractiveFor2FA, NeedInteractive):
        # Certicode Plus envoyé — conserver l'instance woob pour complete_setup
        _pending = {"w": w}
        log.info("LCL setup: Certicode Plus envoyé — en attente d'approbation utilisateur")
        return {"status": "pending_approval"}


def complete_setup() -> dict:
    if _pending is None:
        raise RuntimeError("Aucun setup LCL en cours — relance start d'abord")

    w = _pending["w"]
    from woob.exceptions import (
        AppValidation,
        AppValidationExpired,
        NeedInteractive,
        NeedInteractiveFor2FA,
    )

    try:
        accounts = _iter_accounts(w)
    except AppValidationExpired:
        _cleanup()
        raise RuntimeError("Validation Certicode Plus expirée — relance la connexion")
    except (AppValidation, NeedInteractiveFor2FA, NeedInteractive):
        # Pas encore approuvé dans l'app LCL
        raise RuntimeError("Connexion non encore approuvée dans l'app LCL — réessaie dans quelques secondes")

    count = len(accounts)
    _cleanup()
    log.info("LCL setup: session établie — %d compte(s)", count)
    return {"accounts": count}


def _cleanup():
    global _pending
    if _pending is None:
        return
    try:
        _pending["w"].deinit()
    except Exception as e:
        log.debug("woob deinit failed (ignored): %s", e)
    _pending = None
