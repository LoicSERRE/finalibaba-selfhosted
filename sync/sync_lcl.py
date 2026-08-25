"""
LCL balance sync via woob.

First run: interactive - woob will prompt for Certicode Plus validation
           Run manually: docker exec -it finalibaba-sync-1 python sync_lcl.py --setup
Subsequent runs: uses cached session (valid several weeks).
"""
import logging
import os
import sys
from decimal import Decimal
from pathlib import Path

import psycopg2.extras

from db import (
    get_conn,
    get_institution_id,
    infer_account_type,
    record_balance,
    upsert_account,
    upsert_transaction,
    write_sync_log,
)

log = logging.getLogger(__name__)


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

    import subprocess
    result = subprocess.run(["woob", "config", "update"], capture_output=True, text=True, timeout=60, check=False)
    if result.returncode != 0:
        log.warning("woob config update a échoué (non-fatal) : %s", result.stderr[:200])


def _sync_account_transactions(w, account, account_db_id, cur):
    """Fetch and upsert transaction history for one account. Not capped at
    ~90 days despite an earlier version of this comment claiming that - the
    LCL woob module's iter_history paginates up to 5000 transactions itself
    (see modules/lcl/browser.py upstream) with no artificial cutoff on our
    side either. Confirmed against a real account: some accounts (Livret A,
    LEP, Livret Jeune) came back close to 2 years deep, others (the checking
    account) only ~3 months - the real limiting factor is what LCL's own
    site exposes per account type, not this code. Errors here are non-fatal
    - the account balance above was already
    recorded, so a failure just leaves that account's history stale until
    the next run instead of aborting the whole sync."""
    try:
        from woob.core.bcall import CallErrors
        tx_count = 0
        try:
            for tx in w.do("iter_history", account, backends="lcl"):
                if tx.amount is None or tx.date is None:
                    continue
                amount_cents = int(Decimal(str(tx.amount)) * 100)
                sync_id = f"lcl:{account.id}:{tx.id}" if tx.id else f"lcl:{account.id}:{tx.date.isoformat()}:{amount_cents}"
                upsert_transaction(
                    cur,
                    account_id=account_db_id,
                    sync_id=sync_id,
                    date=tx.date,
                    label=(tx.label or tx.raw or "").strip() or "—",
                    amount_cents=amount_cents,
                )
                tx_count += 1
        except CallErrors as e:
            log.warning("LCL iter_history CallErrors (ignoré) : %s", str(e)[:120])
        log.info("LCL - %s : %d transaction(s) importée(s)", account.label, tx_count)
    except Exception as e:
        log.warning("LCL transactions ignorées pour %s : %s", account.label, e)


def _iter_accounts(w):
    from woob.core.bcall import CallErrors
    accounts = []
    try:
        for result in w.do("iter_accounts", backends="lcl"):
            accounts.append(result)  # noqa: PERF402 - must keep partial results gathered before a mid-iteration CallErrors
    except CallErrors as e:
        for backend, exc, tb in e.errors:
            # NOT redundant despite what python:S1110 claims - see
            # setup_lcl.py's identical line for why (.lower() binds tighter
            # than + in Python, so removing the parens changes behavior).
            msg = (str(exc) + tb).lower()  # NOSONAR
            if "bourse" in msg or "connectionreset" in msg or "connection aborted" in msg:
                # Log full traceback so we can diagnose which URL is failing
                log.warning(
                    "LCL bourse inaccessible (ignoré) : [%s] %s\n%s",
                    getattr(backend, "name", backend), exc, tb.strip()
                )
            else:
                raise
    return accounts


def _fetch_accounts(w, conn, cur, interactive: bool) -> list:
    """Wraps _iter_accounts with the Certicode Plus 2FA flow: in interactive
    (--setup) mode, prompt the user to validate in the LCL app and retry
    once; in non-interactive mode, write auth_required and raise."""
    from woob.exceptions import AppValidation, NeedInteractive, NeedInteractiveFor2FA
    try:
        return _iter_accounts(w)
    except (AppValidation, NeedInteractiveFor2FA, NeedInteractive) as e:
        if not interactive:
            conn.rollback()
            write_sync_log(cur, "lcl", "auth_required", "Certicode Plus requis - lance --setup")
            conn.commit()
            raise AuthRequiredError("LCL Certicode Plus requis")
        # Interactive mode: wait for user to validate in LCL app
        print("\n📱 Ouvre l'app LCL → 'Certicode Plus' et valide la connexion.")
        print(f"   (Message woob : {e})")
        input("\nAppuie sur Entrée une fois validé dans l'app LCL… ")
        return _iter_accounts(w)


def _sync_account(cur, institution_id, account) -> dict | None:
    """Upsert one account's balance row. Returns the synced summary (with
    the DB id, needed by the caller to then sync transactions), or None if
    the account has no balance to record."""
    if account.balance is None:
        return None
    balance_cents = int(Decimal(str(account.balance)) * 100)
    sync_id = f"lcl:{account.id}"
    account_type = infer_account_type(account.label)
    account_db_id = upsert_account(
        cur,
        sync_id=sync_id,
        name=account.label,
        account_type=account_type,
        institution_id=institution_id,
    )
    record_balance(cur, account_db_id, balance_cents)
    log.info("LCL - %s : %d cts", account.label, balance_cents)
    return {"label": account.label, "balance_cents": balance_cents, "account_db_id": account_db_id}


def run(interactive: bool = False) -> dict:
    _configure_woob()

    from woob.core import Woob

    w = Woob()
    try:
        w.load_backends(modules=["lcl"])
    except Exception as e:
        raise RuntimeError(f"Impossible de charger le backend LCL : {e}") from e

    conn = get_conn()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    institution_id = get_institution_id(cur, "LCL")
    if not institution_id:
        raise RuntimeError("Institution 'LCL' introuvable en base. Lance npm run db:seed.")

    accounts = _fetch_accounts(w, conn, cur, interactive)

    if not accounts:
        # Woob returned no accounts without raising an explicit auth error.
        # Possible causes: session expired silently, or the PATCH_410 in entrypoint.sh
        # didn't apply (woob module format changed). Check container logs for details.
        msg = "Aucun compte retourné - vérifier les logs (patch entrypoint.sh appliqué ?)"
        log.error("LCL: %s", msg)
        if interactive:
            print(f"\n⚠ LCL: {msg}")
        write_sync_log(cur, "lcl", "auth_required", msg)
        conn.commit()
        cur.close()
        conn.close()
        raise AuthRequiredError(f"LCL: {msg}")

    synced = []
    for account in accounts:
        summary = _sync_account(cur, institution_id, account)
        if summary is None:
            continue
        synced.append({"label": summary["label"], "balance_cents": summary["balance_cents"]})
        # Fetch transaction history - see _sync_account_transactions'
        # docstring for how far back this actually goes.
        _sync_account_transactions(w, account, summary["account_db_id"], cur)

    write_sync_log(cur, "lcl", "success", f"{len(synced)} compte(s) synchronisé(s)")
    conn.commit()
    cur.close()
    conn.close()
    return {"synced": synced}


class AuthRequiredError(Exception):
    pass


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    interactive = "--setup" in sys.argv
    try:
        result = run(interactive=interactive)
        print(f"✓ LCL sync OK - {len(result['synced'])} compte(s)")
    except AuthRequiredError as e:
        print(f"⚠ {e}")
        print("→ Relance avec: docker exec -it finalibaba-sync-1 python sync_lcl.py --setup")
        sys.exit(2)
    except Exception:
        log.exception("Erreur sync LCL")
        sys.exit(1)
