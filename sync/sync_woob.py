"""
Generic Woob sync - works with any Woob-compatible bank module.

Called per institution by main.py. Credentials are stored in the Institution
table (woobModule / woobLogin / woobPassword), not in env vars.

For banks that require 2FA on first use, the sync will fail with auth_required.
Interactive setup (if needed) must be done manually in the container for now.
"""
import logging
import subprocess
from decimal import Decimal
from pathlib import Path

import psycopg2.extras

from db import (
    get_conn,
    infer_account_type,
    record_balance,
    upsert_account,
    upsert_transaction,
    write_sync_log,
)

log = logging.getLogger(__name__)


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

    result = subprocess.run(["woob", "config", "update"], capture_output=True, text=True, timeout=60, check=False)
    if result.returncode != 0:
        log.warning("woob config update failed (non-fatal): %s", result.stderr[:200])


def _fail(cur, conn, sync_source: str, status: str, msg: str):
    """Common cleanup for every early-exit error path below: log the sync
    attempt, commit that log entry (not the rest of the transaction), and
    release the connection before the caller raises."""
    conn.rollback()
    write_sync_log(cur, sync_source, status, msg)
    conn.commit()
    cur.close()
    conn.close()


def _sync_account_transactions(w, backend_name, institution_id, institution_name, account, account_db_id, cur):
    """Fetch and upsert transaction history for one account. Errors here are
    non-fatal to the overall sync - the account balance above was already
    recorded, so a transactions-fetch failure just means that account's
    history stays stale until the next run, not that the whole sync aborts."""
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
                    label=(tx.label or tx.raw or "").strip() or "-",
                    amount_cents=amount_cents,
                )
                tx_count += 1
        except CallErrors as e:
            log.warning("%s iter_history errors (ignored): %s", institution_name, str(e)[:120])
        log.info("%s - %s: %d transaction(s) imported", institution_name, account.label, tx_count)
    except Exception:
        log.warning("%s transactions skipped for %s", institution_name, account.label, exc_info=True)


def _iter_accounts(w, backend_name, institution_name):
    from woob.core.bcall import CallErrors
    accounts = []
    try:
        for result in w.do("iter_accounts", backends=backend_name):
            accounts.append(result)  # noqa: PERF402 - must keep partial results gathered before a mid-iteration CallErrors
    except CallErrors as e:
        for _backend, exc, tb in e.errors:
            # NOT redundant despite what python:S1110 claims - see
            # setup_lcl.py's identical line for why (.lower() binds tighter
            # than + in Python, so removing the parens changes behavior).
            msg = (str(exc) + tb).lower()  # NOSONAR
            # Ignore sub-module errors for stock/bourse accounts (e.g. LCL bourse 410)
            if any(k in msg for k in ("bourse", "connectionreset", "connection aborted", "410")):
                log.warning("%s: sub-module error ignored: %s", institution_name, str(exc)[:120])
            else:
                raise exc
    return accounts


def _fetch_accounts(w, backend_name, institution_id, institution_name, cur, conn, sync_source) -> list:
    """Wraps _iter_accounts with the auth-vs-generic-error split every sync
    module needs: 2FA/validation errors mean "run interactive setup", any
    other exception is an unexpected Woob failure - both write a sync log
    and clean up the connection via _fail before re-raising."""
    from woob.exceptions import (
        AppValidation,
        AppValidationExpired,
        NeedInteractive,
        NeedInteractiveFor2FA,
    )
    try:
        return _iter_accounts(w, backend_name, institution_name)
    except (AppValidation, AppValidationExpired, NeedInteractiveFor2FA, NeedInteractive):
        msg = f"2FA required - run setup manually in the container: docker exec -it finalibaba-sync-1 python sync_woob.py --setup {institution_id}"
        _fail(cur, conn, sync_source, "auth_required", msg)
        raise AuthRequiredError(msg)
    except Exception as e:
        msg = str(e)[:300]
        # log.exception (not log.error(..., e)) so the traceback lands in
        # docker compose logs - a bare message can't tell "Woob module raised
        # something new" from "the account this ran against changed shape".
        log.exception("%s: unexpected error during iter_accounts", institution_name)
        _fail(cur, conn, sync_source, "error", msg)
        raise


def _sync_account(cur, institution_id, institution_name, account) -> dict | None:
    """Upsert one account's balance row. Returns the synced summary (with
    the DB id, needed by the caller to then sync transactions), or None if
    the account has no balance to record (some Woob sub-accounts surface
    with balance=None)."""
    if account.balance is None:
        return None
    balance_cents = int(Decimal(str(account.balance)) * 100)
    sync_id = f"woob:{institution_id}:{account.id}"
    account_type = infer_account_type(account.label)
    account_db_id = upsert_account(
        cur,
        sync_id=sync_id,
        name=account.label,
        account_type=account_type,
        institution_id=institution_id,
    )
    record_balance(cur, account_db_id, balance_cents)
    log.info("%s - %s: %d cents", institution_name, account.label, balance_cents)
    return {"label": account.label, "balance_cents": balance_cents, "account_db_id": account_db_id}


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

    accounts = _fetch_accounts(w, backend_name, institution_id, institution_name, cur, conn, sync_source)

    if not accounts:
        msg = "No accounts returned - check credentials or run interactive setup"
        log.warning("%s: %s", institution_name, msg)
        _fail(cur, conn, sync_source, "auth_required", msg)
        raise AuthRequiredError(msg)

    synced = []
    for account in accounts:
        summary = _sync_account(cur, institution_id, institution_name, account)
        if summary is None:
            continue
        synced.append({"label": summary["label"], "balance_cents": summary["balance_cents"]})
        _sync_account_transactions(w, backend_name, institution_id, institution_name, account, summary["account_db_id"], cur)

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

    # Usage: python sync_woob.py <institution_id>
    # Reads credentials from DB for the given institution. The module
    # dropdown in Settings -> "Configurer Woob" fetches the full bank list
    # itself now (GET /woob/modules) - this used to also accept a --list
    # flag for that, but it shelled out to `woob config -l`, which was never
    # valid syntax (the real subcommand is `woob config modules`) - removed
    # rather than fixed, since nothing needs a CLI listing path anymore.
    if len(sys.argv) < 2 or sys.argv[1].startswith("-"):
        print("Usage: python sync_woob.py <institution_id>")
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
        print(f"✓ {row['name']} sync OK - {len(result['synced'])} account(s)")
    except AuthRequiredError as e:
        print(f"⚠ {e}")
        sys.exit(2)
    except Exception:
        log.exception("Woob sync error for %s", row["name"])
        sys.exit(1)
