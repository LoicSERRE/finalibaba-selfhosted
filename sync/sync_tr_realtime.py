"""
Persistent Trade Republic listener - keeps a websocket connection open and
triggers a fetch-and-write cycle on every push from TR's own subscriptions,
instead of waiting for the next 4h cron tick. See CLAUDE.md's "Trade
Republic real-time tracking" for the full design.

Deliberately built on the exact pytr client sync_tr.py already uses (same
cookie-based session, same auth/setup flow, same _fetch_and_write_once DB
logic) - not a new library, not a new auth path.

One listener per connection, and as of v2.3 a connection is not necessarily
the .env one. This module was written when TR_PHONE/TR_PIN were the only way
to reach Trade Republic, so it read them directly, looked its institution up
by name, and wrote the fixed `tr:cash` account id. v2.1 then added per-user
connections configured from Settings - and a user who did what that release
invited them to do, moving off .env entirely, silently lost real-time
updates: main.py starts this listener only when TR_PHONE is set, so removing
it stopped the listener with nothing to say so. Their portfolio went back to
moving once every four hours.

So `institution_id` is now a parameter throughout: None keeps the legacy
env-configured behaviour byte-identical, a real id drives one user's own
connection. Everything that differs between the two - credentials, the
account syncId shape, the SyncLog source, whose browser tabs get refreshed -
follows from that single argument.

Subscribes to neonPortfolio/cash(/cryptoPortfolio) - the topics confirmed
(against pytr's own pinned source) to push on real change - rather than
timelineTransactions itself, which sync_tr.py only ever uses as a one-shot
paginated fetch and isn't confirmed to be push-capable. A push on any
subscribed topic is treated as "something happened, go re-fetch the real
delta" - it triggers the same full _fetch_and_write_once() cycle the 4h
cron uses, not a hand-rolled diff of the pushed payload itself.
"""
import asyncio
import logging
import os

import psycopg2.extras

from db import (
    get_conn,
    get_institution_id,
    institution_owner_id,
    upsert_account,
    write_sync_log,
)
from sync_tr import (
    AuthRequiredError,
    _fetch_and_write_once,
    _get_api,
    _get_securities_accounts,
    _is_auth_error,
    fetch_tr_institution,
    tr_sync_id,
)

log = logging.getLogger(__name__)

ENV_SOURCE = "trade_republic_realtime"
SUBSCRIBE_TOPICS = ("neonPortfolio", "cash")

INITIAL_BACKOFF_S = 5
MAX_BACKOFF_S = 300


def realtime_source(institution_id: str | None) -> str:
    """This listener's own SyncLog identity.

    Separate from the batch sync's source on purpose, and it always has been:
    a listener reconnects and drops far more often than a 4h cron runs, and
    sharing an identity would let those cycles churn the batch sync's
    failure-dedup state.

    "tr-realtime:<id>" is a sibling of the batch sync's "tr:<id>", not nested
    inside it - see db.py's _sync_log_owner for why a third segment would have
    filed every one of these rows under the instance owner instead of the
    person whose connection it is.
    """
    return f"tr-realtime:{institution_id}" if institution_id else ENV_SOURCE


def _app_call(path: str, timeout: int, payload: dict | None = None) -> None:
    """Best-effort POST to the Next.js app - a failure here must never abort
    the listener itself, same non-fatal-side-effect reasoning
    _sync_transactions() already applies to its own DB writes."""
    app_url = os.environ.get("APP_SERVICE_URL")
    secret = os.environ.get("NEXTAUTH_SECRET")
    if not app_url or not secret:
        return
    try:
        import requests
        requests.post(
            f"{app_url}{path}",
            headers={"Authorization": f"Bearer {secret}"},
            json=payload,
            timeout=timeout,
        )
    except Exception as e:
        log.warning("TR realtime: failed to call %s: %s", path, e)


def _notify_and_followup(owner_user_id: str | None) -> None:
    """Fans the SSE 'something changed' signal out to any open browser tabs
    (app/api/realtime/notify), then runs the same auto-categorize/alerts
    follow-up _run_all()'s own cron path already does after every sync -
    reused here so a real-time-detected transaction gets categorized and can
    trigger a custom alert rule immediately, not up to 4h later.

    The refresh is addressed to the connection's owner. Omitting it means the
    instance owner, which is correct for the .env connection and wrong for
    everyone else's - their dashboard would keep showing the previous figures
    while somebody else's tab refreshed for their trade.
    """
    _app_call("/api/realtime/notify", timeout=5, payload={"userId": owner_user_id} if owner_user_id else None)
    _app_call("/api/transactions/auto-categorize", timeout=30)
    _app_call("/api/alerts/check", timeout=30)


def _mark_auth_required_realtime(source: str, msg: str) -> None:
    try:
        conn = get_conn()
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        write_sync_log(cur, source, "auth_required", msg)
        conn.commit()
        cur.close()
        conn.close()
    except Exception as db_err:
        log.warning("TR realtime: failed to write auth_required to DB - %s", db_err)


def _credentials(institution_id: str | None) -> tuple[str, str, str]:
    """(phone, pin, display name) for whichever connection this listener drives."""
    if institution_id is None:
        return os.environ["TR_PHONE"], os.environ["TR_PIN"], "Trade Republic (.env)"
    inst = fetch_tr_institution(institution_id)
    if not inst:
        raise RuntimeError(f"Institution {institution_id} not found")
    if not inst["trPhone"] or not inst["trPin"]:
        raise RuntimeError(f"Institution {inst['name']} has no Trade Republic credentials configured")
    return inst["trPhone"], inst["trPin"], inst["name"]


def _resolve_db_institution(cur, institution_id: str | None) -> str:
    """The Institution row this listener writes accounts under.

    The env connection has no institution of its own, so it looks one up by
    name among the owner's - the same thing sync_tr.run() does. A per-user
    connection *is* an institution, so there is nothing to look up.
    """
    if institution_id:
        return institution_id
    resolved = get_institution_id(cur, "Trade Republic")
    if not resolved:
        raise RuntimeError("Institution 'Trade Republic' not found in DB.")
    return resolved


async def _run_one_session(institution_id: str | None = None) -> None:
    """One connect→subscribe→listen cycle. Raises AuthRequiredError on a
    real session failure (caller stops retrying), any other exception on a
    transient disconnect (caller reconnects with backoff)."""
    source = realtime_source(institution_id)
    phone_no, pin, label = _credentials(institution_id)
    try:
        api = _get_api(phone_no, pin, interactive=False, scope_institution_id=institution_id)
    except AuthRequiredError:
        _mark_auth_required_realtime(source, "Session web absente - reconnecte depuis Paramètres")
        raise

    conn = get_conn()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        db_institution_id = _resolve_db_institution(cur, institution_id)
        owner_user_id = institution_owner_id(cur, db_institution_id)

        sec_accounts, has_crypto = _get_securities_accounts(api)
        api.save_websession()

        cash_account_id = upsert_account(
            cur,
            sync_id=tr_sync_id("cash", institution_id),
            name="Compte espèces",
            account_type="CHECKING",
            institution_id=db_institution_id,
        )
        cur.execute('SELECT "syncId" FROM "Transaction" WHERE "accountId" = %s', (cash_account_id,))
        known_tx_ids = {row["syncId"].split(":", 1)[1] for row in cur.fetchall() if row["syncId"]}
        conn.commit()

        topics = list(SUBSCRIBE_TOPICS) + (["cryptoPortfolio"] if has_crypto else [])
        subs = [await api.subscribe({"type": t}) for t in topics]
        log.info("TR realtime [%s]: connected, listening on %s", label, topics)

        while True:
            try:
                recv_tasks = [asyncio.create_task(api._recv_subscription(sub)) for sub in subs]
                done, pending = await asyncio.wait(recv_tasks, return_when=asyncio.FIRST_COMPLETED)
                for task in pending:
                    task.cancel()
                for task in done:
                    task.result()  # surface any exception from the completed recv

                summary, known_tx_ids = _fetch_and_write_once(
                    api, cur,
                    institution_id=db_institution_id, sec_accounts=sec_accounts, has_crypto=has_crypto,
                    cash_account_id=cash_account_id, known_tx_ids=known_tx_ids, source=source,
                    scope_institution_id=institution_id,
                )
                conn.commit()
                log.info("TR realtime [%s]: push processed - %s", label, summary)
                _notify_and_followup(owner_user_id)
            except Exception as e:
                if _is_auth_error(e):
                    conn.commit()
                    _mark_auth_required_realtime(
                        source, "Session expirée - reconnecte depuis Paramètres → Trade Republic"
                    )
                    raise AuthRequiredError(f"Trade Republic ({label}): session expired.") from e
                raise
    finally:
        cur.close()
        conn.close()


async def listen_forever(institution_id: str | None = None) -> None:
    """Reconnect-with-backoff wrapper - pytr has no built-in keepalive or
    auto-reconnect (confirmed against its own pinned source), so this loop
    owns that entirely. Runs for the lifetime of the sync process, launched
    from main.py's supervisor and cancelled on shutdown. Stops (does not keep
    retrying) once a real auth error is hit - the 4h cron keeps running
    independently either way, and a human needs to reconnect from Settings
    before this listener can come back.

    Returning rather than raising on auth failure is what lets the supervisor
    tell "this one is waiting for a human" apart from "this one crashed", so
    it can leave the first alone and restart the second.
    """
    backoff = INITIAL_BACKOFF_S
    while True:
        try:
            await _run_one_session(institution_id)
        except asyncio.CancelledError:
            log.info("TR realtime: listener cancelled, shutting down")
            raise
        except AuthRequiredError:
            log.warning("TR realtime: stopping until the session is re-established from Settings")
            return
        except Exception as e:
            log.warning("TR realtime: disconnected (%s), reconnecting in %ds", e, backoff)
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, MAX_BACKOFF_S)
