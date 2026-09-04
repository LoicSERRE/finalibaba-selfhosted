"""Every way a bank login can fail, classified once instead of bank by bank.

**Why this exists.** Each authentication gap in this project was found the same
way: a user connected a bank, got "an error" with nothing in it, and opened an
issue. The fix each time was one more `except` clause. Measuring the catalogue
showed how badly that scales - and which case it had left out:

    BrowserIncorrectPassword   61 of 95 modules   unclassified
    AssertionError             40                 unclassified
    BrowserUserBanned          18                 unclassified
    BrowserPasswordExpired     17                 unclassified
    AuthMethodNotImplemented   16                 unclassified

The single most common failure of all - wrong credentials - fell through to the
generic handler, and `BrowserIncorrectPassword()` is raised with NO message, so
the SyncLog row was empty and the UI had nothing to show. Exactly the "no error
but sync is not ok" report (issue #54), reached from the most likely direction.

**Order is meaning here, not style.** The hierarchy overlaps: BrowserUserBanned
subclasses BrowserIncorrectPassword, while BrowserPasswordExpired and
AuthMethodNotImplemented both subclass ActionNeeded. Matching runs top-down, so
the specific entries must precede the general ones - a plain except-chain gets
this wrong silently, which is half the reason this is a table.

Statuses come from lib/domain/sync-status.ts:
  auth_required  a person can fix it, and a later run may then succeed
  unsupported    this integration cannot drive it; alert once, never nag
  error          transient or unknown; retryable, cleared by the next success
"""

from __future__ import annotations


def _entries():
    """Built lazily: importing woob at module import time would slow every
    caller that never hits an error."""
    from woob.capabilities.bank import NoAccountsException
    from woob.exceptions import (
        ActionNeeded,
        AppValidationCancelled,
        AuthMethodNotImplemented,
        BrowserForbidden,
        BrowserIncorrectPassword,
        BrowserPasswordExpired,
        BrowserRedirect,
        BrowserUnavailable,
        BrowserUserBanned,
        ScrapingBlocked,
    )

    # (exception, SyncLog status, message shown to the user)
    return (
        # --- must precede BrowserUnavailable, which it subclasses ---
        (ScrapingBlocked, "error",
         (
         "La banque a détecté et bloqué la connexion automatique. Réessaie plus tard ; "
         "si cela persiste, sa synchronisation automatique n'est peut-être pas possible."
         )),
        (BrowserUnavailable, "error",
         "La banque est momentanément indisponible ou en maintenance. Réessaie plus tard."),

        # --- must precede BrowserIncorrectPassword, which it subclasses ---
        (BrowserUserBanned, "error",
         (
         "La banque a temporairement bloqué l'accès après plusieurs tentatives. "
         "Attends avant de réessayer, sinon le blocage se prolonge."
         )),

        # --- must precede ActionNeeded, which they subclass ---
        (BrowserPasswordExpired, "auth_required",
         (
         "Ton mot de passe a expiré. Change-le sur le site de la banque, "
         "puis mets-le à jour ici."
         )),
        (AuthMethodNotImplemented, "unsupported",
         (
         "Cette banque impose une méthode d'authentification que cette intégration "
         "ne sait pas piloter."
         )),

        (AppValidationCancelled, "auth_required",
         "La validation a été refusée depuis l'application de la banque. Relance la connexion."),

        # 61 of 95 modules raise this, and it carries no message of its own -
        # which is why it must never reach the generic handler.
        (BrowserIncorrectPassword, "auth_required",
         (
         "Identifiants refusés par la banque. Vérifie l'identifiant et le mot de passe "
         "dans « Synchro configurée »."
         )),

        (BrowserForbidden, "error",
         "La banque a refusé l'accès. Vérifie que le compte est actif et accessible depuis son site."),
        (NoAccountsException, "error",
         "La banque n'a retourné aucun compte pour ces identifiants."),

        # --- the general ones, last ---
        (ActionNeeded, "unsupported",
         (
         "Cette banque demande une action de ta part sur son site "
         "(valider un message, compléter un dossier, activer une option). "
         "Fais-la puis relance la synchronisation."
         )),
        (BrowserRedirect, "unsupported",
         (
         "Cette banque exige une connexion sur son propre site, que cette intégration "
         "ne peut pas automatiser."
         )),
    )


# A module that gives up on its own bank. AssertionError is raised by 40 of the
# 95 modules for a response they do not recognise, and NotImplementedError by 25
# for a case they never covered - both mean "the bank changed under Woob", not
# "you did something wrong", and saying so is far better than a bare traceback.
_MODULE_GAVE_UP = (AssertionError, NotImplementedError)
_MODULE_GAVE_UP_MESSAGE = (
    "Le connecteur de cette banque n'a pas su interpréter sa réponse : elle a probablement "
    "changé son site ou son API. Rien à corriger de ton côté ; cela se règle en amont, "
    "dans le module Woob."
)


def classify(exc: BaseException) -> tuple[str, str] | None:
    """Map a login failure onto (SyncLog status, user-facing message).

    Returns None when nothing matches, so the caller keeps its own fallback and
    an unknown failure still reaches the container logs with a full traceback.
    """
    for kind, status, message in _entries():
        if isinstance(exc, kind):
            detail = str(exc)[:200].strip()
            # The bank's own wording is often the useful part ("accept the
            # notice on your account"), so it is appended rather than replaced.
            return status, f"{message} {detail}" if detail else message

    if isinstance(exc, _MODULE_GAVE_UP):
        detail = str(exc)[:200].strip()
        return "error", f"{_MODULE_GAVE_UP_MESSAGE} {detail}" if detail else _MODULE_GAVE_UP_MESSAGE

    return None
