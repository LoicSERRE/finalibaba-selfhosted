"""
LCL balance sync via woob.

First run: interactive — woob will prompt for Certicode Plus validation
           Run manually: docker exec -it finalibaba-sync-1 python sync_lcl.py --setup
Subsequent runs: uses cached session (valid several weeks).
"""
import logging
import os
import sys
from decimal import Decimal
from pathlib import Path

import psycopg2.extras

from db import get_conn, get_institution_id, upsert_account, record_balance, upsert_transaction, write_sync_log

log = logging.getLogger(__name__)

ACCOUNT_TYPE_MAP = {
    # keywords in account label → AccountType
    "livret": "SAVINGS",
    "épargne": "SAVINGS",
    "ldd": "SAVINGS",
    "pel": "SAVINGS",
    "cel": "SAVINGS",
    "ldds": "SAVINGS",
}


def _infer_account_type(label: str) -> str:
    label_lower = label.lower()
    for keyword, account_type in ACCOUNT_TYPE_MAP.items():
        if keyword in label_lower:
            return account_type
    return "CHECKING"


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
    result = subprocess.run(["woob", "config", "update"], capture_output=True, text=True, timeout=60)
    if result.returncode != 0:
        log.warning("woob config update failed (non-fatal): %s", result.stderr[:200])


def run(interactive: bool = False) -> dict:
    _configure_woob()

    from woob.core import Woob

    w = Woob()
    try:
        w.load_backends(modules=["lcl"])
    except Exception as e:
        raise RuntimeError(f"Failed to load LCL backend: {e}") from e

    conn = get_conn()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    institution_id = get_institution_id(cur, "LCL")
    if not institution_id:
        raise RuntimeError("Institution 'LCL' not found in DB. Run npm run db:seed.")

    synced = []
    from woob.exceptions import AppValidation, AppValidationExpired, NeedInteractiveFor2FA, NeedInteractive

    def _iter_accounts():
        from woob.core.bcall import CallErrors
        accounts = []
        try:
            for result in w.do("iter_accounts", backends="lcl"):
                accounts.append(result)
        except CallErrors as e:
            for backend, exc, tb in e.errors:
                msg = (str(exc) + tb).lower()
                if "bourse" in msg or "connectionreset" in msg or "connection aborted" in msg:
                    # Log full traceback so we can diagnose which URL is failing
                    log.warning(
                        "LCL bourse unreachable (ignored): [%s] %s\n%s",
                        getattr(backend, "name", backend), exc, tb.strip()
                    )
                else:
                    raise
        return accounts

    try:
        accounts = _iter_accounts()
    except (AppValidation, NeedInteractiveFor2FA, NeedInteractive) as e:
        if not interactive:
            conn.rollback()
            write_sync_log(cur, "lcl", "auth_required", "Certicode Plus required — run --setup")
            conn.commit()
            raise AuthRequiredError("LCL Certicode Plus required")
        # Interactive mode: wait for user to validate in LCL app
        print(f"\n📱 Open the LCL app → 'Certicode Plus' and approve the connection.")
        print(f"   (woob message: {e})")
        input("\nPress Enter once approved in the LCL app… ")
        accounts = _iter_accounts()

    if not accounts:
        # Woob returned no accounts without raising an explicit auth error.
        # Possible causes: session expired silently, or the PATCH_410 in entrypoint.sh
        # didn't apply (woob module format changed). Check container logs for details.
        msg = "No accounts returned — check logs (was entrypoint.sh patch applied?)"
        log.error("LCL: %s", msg)
        if interactive:
            print(f"\n⚠ LCL: {msg}")
        write_sync_log(cur, "lcl", "auth_required", msg)
        conn.commit()
        cur.close()
        conn.close()
        raise AuthRequiredError(f"LCL: {msg}")

    for account in accounts:
        if account.balance is None:
            continue

        balance_cents = int(Decimal(str(account.balance)) * 100)
        sync_id = f"lcl:{account.id}"
        account_type = _infer_account_type(account.label)

        account_db_id = upsert_account(
            cur,
            sync_id=sync_id,
            name=account.label,
            account_type=account_type,
            institution_id=institution_id,
        )
        record_balance(cur, account_db_id, balance_cents)
        synced.append({"label": account.label, "balance_cents": balance_cents})
        log.info("LCL — %s: %d cents", account.label, balance_cents)

        # Fetch transactions (last ~90 days)
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
                log.warning("LCL iter_history CallErrors (ignored): %s", str(e)[:120])
            log.info("LCL — %s: %d transaction(s) imported", account.label, tx_count)
        except Exception as e:
            log.warning("LCL transactions skipped for %s: %s", account.label, e)

    write_sync_log(cur, "lcl", "success", f"{len(synced)} account(s) synced")
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
        print(f"✓ LCL sync OK — {len(result['synced'])} account(s)")
    except AuthRequiredError as e:
        print(f"⚠ {e}")
        print("→ Re-run with: docker exec -it finalibaba-sync-1 python sync_lcl.py --setup")
        sys.exit(2)
    except Exception as e:
        log.exception("LCL sync error")
        sys.exit(1)
