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

import setup_locks
import woob_errors
from db import (
    get_conn,
    infer_account_type,
    promote_account_to_investment,
    record_balance,
    replace_holdings,
    upsert_account,
    upsert_transaction,
    write_sync_log,
)

log = logging.getLogger(__name__)


# Woob keeps browser state - cookies, a bank's own session token, the date 2FA
# was last cleared - only when it is given a storage. Woob() with none keeps
# NOTHING, and that made an interactive setup pointless for any bank needing
# one: the setup authenticated, its session died with the object, and the sync
# firing right after opened a fresh browser that got challenged again.
#
# Observed end to end on Amundi (issue #51): the phone approval succeeded, the
# sync that followed still logged "captcha required", and not a single account
# was ever imported. Both the setup and the sync now share THIS file, which is
# the whole point - the setup's authenticated state is what the sync reuses.
#
# It lives on the woob_session volume docker-compose.yml already mounts at
# /root/.config/woob, so a container restart does not force a fresh setup.
_STORAGE_PATH = Path.home() / ".config" / "woob" / "storage.json"


def make_woob():
    """A Woob whose browser state survives the call, and the container."""
    from woob.core import Woob
    from woob.tools.storage import StandardStorage

    _STORAGE_PATH.parent.mkdir(parents=True, exist_ok=True)
    return Woob(storage=StandardStorage(str(_STORAGE_PATH)))


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


def _investment_to_holding(inv) -> dict | None:
    """Map one Woob Investment onto this project's Holding shape.

    **Every field goes through `empty()`, and that is not defensive style.**
    Woob does not use None for a field a bank did not report: it uses the
    `NotAvailable` singleton, which is NOT None and whose str() is the literal
    "Not available". So `inv.unitprice is not None` passes, and
    `Decimal(str(inv.unitprice))` then dies with ConversionSyntax - which is
    exactly what happened on a real Amundi PEE: iter_investment returned the
    positions correctly and every single one was dropped by this mapping.

    `code` is the ISIN when the bank gives one, the stable identity a holding
    should be keyed by; the label is only a fallback, truncated because it is
    the unique key together with the account.

    **When quantity is missing**, and funds routinely omit it, the position is
    stored as a single unit priced at its valuation. The account's total value -
    the number that actually matters - stays exact; only the per-unit price
    becomes the whole line. Better than dropping a real position for lack of a
    share count.
    """
    from woob.capabilities.base import empty

    def value(field):
        return None if empty(field) else field

    valuation = value(inv.valuation)
    quantity = value(inv.quantity)
    unitvalue = value(inv.unitvalue)
    unitprice = value(inv.unitprice)
    code = value(inv.code)
    label = value(inv.label)

    if valuation is None and (quantity is None or unitvalue is None):
        return None  # nothing to value this line with

    ticker = str(code or label or "").strip()[:64]
    if not ticker:
        return None

    if quantity is None or not unitvalue:
        quantity, unitvalue = Decimal(1), valuation

    cost = None
    if unitprice is not None:
        cost = int(Decimal(str(unitprice)) * Decimal(str(quantity)) * 100)

    return {
        "ticker": ticker,
        "name": str(label) if label else None,
        "quantity": Decimal(str(quantity)),
        "last_price_cents": int(Decimal(str(unitvalue)) * 100),
        "cost_basis_cents": cost,
    }


def _sync_account_investments(w, backend_name, institution_name, account, account_db_id, cur) -> int:
    """Fetch and store one account's holdings, when the bank reports any.

    Non-fatal like the transaction fetch above: the balance is already
    recorded, so a module that does not implement iter_investment - or errors
    on it - just leaves that account without lines rather than failing the sync.
    """
    try:
        from woob.core.bcall import CallErrors

        holdings = []
        try:
            for inv in w.do("iter_investment", account, backends=backend_name):
                mapped = _investment_to_holding(inv)
                if mapped:
                    holdings.append(mapped)
        except CallErrors as e:
            log.debug("%s iter_investment unsupported/errored: %s", institution_name, str(e)[:120])
            return 0

        if not holdings:
            return 0

        count = replace_holdings(cur, account_db_id, holdings)
        if promote_account_to_investment(cur, account_db_id):
            log.info("%s - %s: retyped as an investment account", institution_name, account.label)
        log.info("%s - %s: %d holding(s) imported", institution_name, account.label, count)
        return count
    except Exception:
        log.warning("%s holdings skipped for %s", institution_name, account.label, exc_info=True)
        return 0


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
        CaptchaQuestion,
        NeedInteractive,
        NeedInteractiveFor2FA,
    )
    try:
        return _iter_accounts(w, backend_name, institution_name)
    except (AppValidation, AppValidationExpired, NeedInteractiveFor2FA, NeedInteractive):
        msg = f"2FA required - run setup manually in the container: docker exec -it finalibaba-sync-1 python sync_woob.py --setup {institution_id}"
        _fail(cur, conn, sync_source, "auth_required", msg)
        raise AuthRequiredError(msg)
    except CaptchaQuestion as e:
        # A captcha IS reconnectable, so this is auth_required like any other
        # 2FA - the setup flow renders the real widget, a human solves it, and
        # the sync proceeds (see setup_woob.py's CaptchaQuestion branch).
        #
        # It was briefly classified "unsupported" alongside the two below, on
        # the reasoning that a captcha exists precisely to defeat automation.
        # True, and beside the point: the bank is refusing a ROBOT, and the
        # answer is to stop being one for one screen rather than to give up.
        # Reported from a real instance as a raw traceback (issue #51, Amundi,
        # RecaptchaV2Question) - the traceback is what was actually broken.
        #
        # The honest limit, stated in the UI rather than hidden here: a solved
        # token is single-use and expires in about two minutes, so this makes
        # ON-DEMAND sync work and can never make the 4h cron work. Every
        # scheduled run on such a bank lands right back here.
        msg = f"{_CAPTCHA_PREFIX}{str(e)[:200]}" if str(e) else _CAPTCHA_PREFIX.rstrip(": ")
        log.warning("%s: %s", institution_name, msg)
        # Its own status, not auth_required: both mean "reconnect and it
        # works", but only this one can never be cleared by a scheduled run,
        # so the failure alert must stop after telling the user once. See
        # lib/domain/sync-status.ts.
        _fail(cur, conn, sync_source, "captcha_required", msg)
        raise AuthRequiredError(msg) from e
    except Exception as e:
        # Everything that is not an interactive flow goes through one ordered
        # table (woob_errors) rather than a chain of except clauses grown one
        # bug report at a time. Measured on the catalogue, that chain had left
        # out the most common failure of all: BrowserIncorrectPassword, raised
        # by 61 of the 95 modules and carrying no message, so wrong credentials
        # produced an empty SyncLog and a UI with nothing to say.
        classified = woob_errors.classify(e)
        if classified is None:
            # Genuinely unknown: keep the traceback, it is the only way to tell
            # "a module raised something new" from "this account changed shape".
            msg = str(e)[:300] or "Erreur inattendue pendant la synchronisation."
            log.exception("%s: unexpected error during iter_accounts", institution_name)
            _fail(cur, conn, sync_source, "error", msg)
            raise

        status, msg = classified
        # An expected outcome, so a warning without a traceback.
        log.warning("%s: %s", institution_name, msg)
        _fail(cur, conn, sync_source, status, msg)
        if status == "auth_required":
            raise AuthRequiredError(msg) from e
        if status == "unsupported":
            raise UnsupportedBankError(msg) from e
        raise RuntimeError(msg) from e


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
    # A setup is in flight: the user is solving a captcha or approving on their
    # phone right now. Opening a second session would invalidate the pending
    # validation and strand them (issue #51). Skipped, NOT failed - there is
    # nothing wrong here, so no SyncLog row: writing one would raise a failure
    # alert for a bank that is in the middle of being connected properly.
    if setup_locks.is_setup_in_progress(institution_id):
        log.info("%s: interactive setup in progress, skipping this sync", institution_name)
        return {"skipped": "setup_in_progress", "accounts": 0}

    # Use a sanitised version of the institution id as the Woob backend name
    backend_name = f"inst_{institution_id.replace('-', '_')[:20]}"
    sync_source = f"woob:{institution_id}"

    _configure_woob(backend_name, module, login, password)

    w = make_woob()
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

    return persist_accounts(w, backend_name, institution_id, institution_name, accounts, cur, conn)


def persist_accounts(
    w,
    backend_name: str,
    institution_id: str,
    institution_name: str,
    accounts: list,
    cur=None,
    conn=None,
) -> dict:
    """Write an already-fetched account list, and its transactions, to the DB.

    Split out of run() so an interactive setup can persist what it fetched with
    its OWN live session, instead of counting the accounts and throwing them
    away for a later sync to re-fetch.

    For a bank like Amundi that later sync is not merely wasteful, it is
    impossible: its module calls check_interactive() from init_login as soon as
    MFA is on ("we will not be able to stop the login before the notification is
    sent"), so any non-interactive run raises NeedInteractiveFor2FA, and an
    interactive one would push a fresh notification to the user's phone. The
    only moment its accounts can be written is while the setup still holds the
    session that a human just approved - which is exactly what this enables.

    Issue #51: the setup succeeded, reported "4 accounts", and the database
    stayed empty through every retry.
    """
    sync_source = f"woob:{institution_id}"
    owns_connection = cur is None
    if owns_connection:
        conn = get_conn()
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    synced = []
    for account in accounts:
        summary = _sync_account(cur, institution_id, institution_name, account)
        if summary is None:
            continue
        synced.append({"label": summary["label"], "balance_cents": summary["balance_cents"]})
        _sync_account_investments(w, backend_name, institution_name, account, summary["account_db_id"], cur)
        _sync_account_transactions(w, backend_name, institution_id, institution_name, account, summary["account_db_id"], cur)

    write_sync_log(cur, sync_source, "success", f"{len(synced)} account(s) synced")
    conn.commit()
    cur.close()
    conn.close()
    return {"synced": synced}


# Shown to the user, so it says what to do rather than what went wrong.
_CAPTCHA_PREFIX = (
    "Cette banque demande un captcha : ouvre les réglages et clique "
    "sur « Se connecter » pour le résoudre (la synchronisation "
    "automatique ne peut pas le faire à ta place) : "
)


class UnsupportedBankError(Exception):
    """The bank cannot be driven by this integration at all - as opposed to
    AuthRequiredError, which means "reconnect and it will work". Kept separate
    so main.py can stop treating it as a failure to retry every 4 hours."""


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
