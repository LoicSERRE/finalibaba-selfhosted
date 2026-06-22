"""
Generic Woob sync — works with any Woob-compatible bank module.

Called per institution by main.py. Credentials are stored in the Institution
table (woobModule / woobLogin / woobPassword), not in env vars.

For banks that require 2FA on first use, the sync will fail with auth_required.
Interactive setup (if needed) must be done manually in the container for now.
"""
import logging
import os
import subprocess
from decimal import Decimal
from pathlib import Path

import psycopg2.extras

from db import get_conn, upsert_account, record_balance, upsert_transaction, write_sync_log

log = logging.getLogger(__name__)

ACCOUNT_TYPE_MAP = {
    "livret": "SAVINGS",
    "épargne": "SAVINGS",
    "ldd": "SAVINGS",
    "pel": "SAVINGS",
    "cel": "SAVINGS",
    "ldds": "SAVINGS",
    "savings": "SAVINGS",
    "bourse": "INVESTMENT",
    "pea": "INVESTMENT",
    "cto": "INVESTMENT",
    "titre": "INVESTMENT",
    "actions": "INVESTMENT",
}


def _infer_account_type(label: str) -> str:
    label_lower = label.lower()
    for keyword, account_type in ACCOUNT_TYPE_MAP.items():
        if keyword in label_lower:
            return account_type
    return "CHECKING"


def _configure_woob(backend_name: str, module: str, login: str, password: str):
    """Write a Woob backends config file for the given institution."""
    config_dir = Path.home() / ".config" / "woob"
    config_dir.mkdir(parents=True, exist_ok=True)

    # Each institution gets its own named backend (backend_name = sanitised institution id)
    backends_file = config_dir / "backends"

    # Read existing config (other banks may already be configured)
    existing = backends_file.read_text() if backends_file.exists() else ""

    # Remove the existing block for this backend if present
    lines = existing.splitlines(keepends=True)
    new_lines = []
    skip = False
    for line in lines:
        if line.strip() == f"[{backend_name}]":
            skip = True
        elif line.startswith("[") and skip:
            skip = False
        if not skip:
            new_lines.append(line)

    new_block = (
        f"[{backend_name}]\n"
        f"_module = {module}\n"
        f"login = {login}\n"
        f"password = {password}\n"
    )
    new_lines.append(new_block)
    backends_file.write_text("".join(new_lines))
    backends_file.chmod(0o600)

    result = subprocess.run(["woob", "config", "update"], capture_output=True, text=True, timeout=60)
    if result.returncode != 0:
        log.warning("woob config update failed (non-fatal): %s", result.stderr[:200])


def run(institution_id: str, institution_name: str, module: str, login: str, password: str) -> dict:
    # Use a sanitised version of the institution id as the Woob backend name
    backend_name = f"inst_{institution_id.replace('-', '_')[:20]}"
    sync_source = f"woob:{institution_id}"

    _configure_woob(backend_name, module, login, password)

    from woob.core import Woob
    w = Woob()
    try:
        w.load_backends(modules=[module], names=[backend_name])
    except Exception as e:
        raise RuntimeError(f"Failed to load Woob backend '{module}': {e}") from e

    conn = get_conn()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    synced = []

    from woob.exceptions import AppValidation, AppValidationExpired, NeedInteractiveFor2FA, NeedInteractive

    def _iter_accounts():
        from woob.core.bcall import CallErrors
        accounts = []
        try:
            for result in w.do("iter_accounts", backends=backend_name):
                accounts.append(result)
        except CallErrors as e:
            for _backend, exc, tb in e.errors:
                msg = (str(exc) + tb).lower()
                # Ignore sub-module errors for stock/bourse accounts (e.g. LCL bourse 410)
                if any(k in msg for k in ("bourse", "connectionreset", "connection aborted", "410")):
                    log.warning("%s: sub-module error ignored: %s", institution_name, str(exc)[:120])
                else:
                    raise exc
        return accounts

    try:
        accounts = _iter_accounts()
    except (AppValidation, AppValidationExpired, NeedInteractiveFor2FA, NeedInteractive) as e:
        conn.rollback()
        msg = f"2FA required — run setup manually in the container: docker exec -it finalibaba-sync-1 python sync_woob.py --setup {institution_id}"
        write_sync_log(cur, sync_source, "auth_required", msg)
        conn.commit()
        cur.close()
        conn.close()
        raise AuthRequiredError(msg)
    except Exception as e:
        conn.rollback()
        msg = str(e)[:300]
        log.error("%s: unexpected error during iter_accounts: %s", institution_name, msg)
        write_sync_log(cur, sync_source, "error", msg)
        conn.commit()
        cur.close()
        conn.close()
        raise

    if not accounts:
        msg = "No accounts returned — check credentials or run interactive setup"
        log.warning("%s: %s", institution_name, msg)
        write_sync_log(cur, sync_source, "auth_required", msg)
        conn.commit()
        cur.close()
        conn.close()
        raise AuthRequiredError(msg)

    for account in accounts:
        if account.balance is None:
            continue

        balance_cents = int(Decimal(str(account.balance)) * 100)
        sync_id = f"woob:{institution_id}:{account.id}"
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
        log.info("%s — %s: %d cents", institution_name, account.label, balance_cents)

        # Fetch transactions
        try:
            from woob.core.bcall import CallErrors
            tx_count = 0
            try:
                for tx in w.do("iter_history", account, backends=backend_name):
                    if tx.amount is None or tx.date is None:
                        continue
                    amount_cents = int(Decimal(str(tx.amount)) * 100)
                    tx_sync_id = (
                        f"woob:{institution_id}:{account.id}:{tx.id}"
                        if tx.id
                        else f"woob:{institution_id}:{account.id}:{tx.date.isoformat()}:{amount_cents}"
                    )
                    upsert_transaction(
                        cur,
                        account_id=account_db_id,
                        sync_id=tx_sync_id,
                        date=tx.date,
                        label=(tx.label or tx.raw or "").strip() or "—",
                        amount_cents=amount_cents,
                    )
                    tx_count += 1
            except CallErrors as e:
                log.warning("%s iter_history errors (ignored): %s", institution_name, str(e)[:120])
            log.info("%s — %s: %d transaction(s) imported", institution_name, account.label, tx_count)
        except Exception as e:
            log.warning("%s transactions skipped for %s: %s", institution_name, account.label, e)

    write_sync_log(cur, sync_source, "success", f"{len(synced)} account(s) synced")
    conn.commit()
    cur.close()
    conn.close()
    return {"synced": synced}


class AuthRequiredError(Exception):
    pass


if __name__ == "__main__":
    import sys
    import psycopg2
    logging.basicConfig(level=logging.INFO)

    if "--list" in sys.argv:
        result = subprocess.run(["woob", "config", "-l"], capture_output=False, text=True)
        sys.exit(result.returncode)

    # Usage: python sync_woob.py <institution_id>
    # Reads credentials from DB for the given institution
    if len(sys.argv) < 2 or sys.argv[1].startswith("-"):
        print("Usage: python sync_woob.py <institution_id>")
        print("       python sync_woob.py --list   (list available Woob modules)")
        sys.exit(1)

    inst_id = sys.argv[1]
    conn = get_conn()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute(
        'SELECT id, name, "woobModule", "woobLogin", "woobPassword" FROM "Institution" WHERE id = %s',
        (inst_id,),
    )
    row = cur.fetchone()
    cur.close()
    conn.close()

    if not row:
        print(f"Institution {inst_id!r} not found in DB")
        sys.exit(1)
    if not row["woobModule"]:
        print(f"Institution {row['name']!r} has no woobModule configured")
        sys.exit(1)

    try:
        result = run(row["id"], row["name"], row["woobModule"], row["woobLogin"], row["woobPassword"])
        print(f"✓ {row['name']} sync OK — {len(result['synced'])} account(s)")
    except AuthRequiredError as e:
        print(f"⚠ {e}")
        sys.exit(2)
    except Exception:
        log.exception("Woob sync error for %s", row["name"])
        sys.exit(1)
