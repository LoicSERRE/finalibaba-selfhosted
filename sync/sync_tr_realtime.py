"""
Persistent Trade Republic listener - keeps a websocket connection open and
triggers a fetch-and-write cycle on every push from TR's own subscriptions,
instead of waiting for the next 4h cron tick. See CLAUDE.md's "Trade
Republic real-time tracking" for the full design.

Deliberately built on the exact pytr client sync_tr.py already uses (same
cookie-based session, same auth/setup flow, same _fetch_and_write_once DB
logic) - not a new library, not a new auth path. Requires
TR_REALTIME_ENABLED=true in addition to TR_PHONE/TR_PIN - opt-in, since this
is the first persistent outbound connection this container ever holds open.

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

from db import get_conn, get_institution_id, upsert_account, write_sync_log
from sync_tr import (
    AuthRequiredError,
    _fetch_and_write_once,
    _get_api,
    _get_securities_accounts,
    _is_auth_error,
)

log = logging.getLogger(__name__)

SOURCE = "trade_republic_realtime"
SUBSCRIBE_TOPICS = ("neonPortfolio", "cash")

INITIAL_BACKOFF_S = 5
MAX_BACKOFF_S = 300


def _app_call(path: str, timeout: int) -> None:
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
            timeout=timeout,
        )
    except Exception as e:
        log.warning("TR realtime: failed to call %s: %s", path, e)


def _notify_and_followup() -> None:
    """Fans the SSE 'something changed' signal out to any open browser tabs
    (app/api/realtime/notify), then runs the same auto-categorize/alerts
    follow-up _run_all()'s own cron path already does after every sync -
    reused here so a real-time-detected transaction gets categorized and can
    trigger a custom alert rule immediately, not up to 4h later."""
    _app_call("/api/realtime/notify", timeout=5)
    _app_call("/api/transactions/auto-categorize", timeout=30)
    _app_call("/api/alerts/check", timeout=30)


def _mark_auth_required_realtime(msg: str) -> None:
    try:
        conn = get_conn()
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        write_sync_log(cur, SOURCE, "auth_required", msg)
        conn.commit()
        cur.close()
        conn.close()
    except Exception as db_err:
        log.warning("TR realtime: failed to write auth_required to DB - %s", db_err)


async def _run_one_session() -> None:
    """One connect→subscribe→listen cycle. Raises AuthRequiredError on a
    real session failure (caller stops retrying), any other exception on a
    transient disconnect (caller reconnects with backoff)."""
    phone_no = os.environ["TR_PHONE"]
    pin = os.environ["TR_PIN"]
    try:
        api = _get_api(phone_no, pin, interactive=False)
    except AuthRequiredError:
        _mark_auth_required_realtime("Session web absente - lance --setup")
        raise

    conn = get_conn()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        institution_id = get_institution_id(cur, "Trade Republic")
        if not institution_id:
            raise RuntimeError("Institution 'Trade Republic' not found in DB.")

        sec_accounts, has_crypto = _get_securities_accounts(api)
        api.save_websession()

        cash_account_id = upsert_account(
            cur,
            sync_id="tr:cash",
            name="Compte espèces",
            account_type="CHECKING",
            institution_id=institution_id,
        )
        cur.execute('SELECT "syncId" FROM "Transaction" WHERE "accountId" = %s', (cash_account_id,))
        known_tx_ids = {row["syncId"].split(":", 1)[1] for row in cur.fetchall() if row["syncId"]}
        conn.commit()

        topics = list(SUBSCRIBE_TOPICS) + (["cryptoPortfolio"] if has_crypto else [])
        subs = [await api.subscribe({"type": t}) for t in topics]
        log.info("TR realtime: connected, listening on %s", topics)

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
                    institution_id=institution_id, sec_accounts=sec_accounts, has_crypto=has_crypto,
                    cash_account_id=cash_account_id, known_tx_ids=known_tx_ids, source=SOURCE,
                )
                conn.commit()
                log.info("TR realtime: push processed - %s", summary)
                _notify_and_followup()
            except Exception as e:
                if _is_auth_error(e):
                    conn.commit()
                    _mark_auth_required_realtime("Session expirée - reconnecte depuis Paramètres → Trade Republic")
                    raise AuthRequiredError("Trade Republic: session expired.") from e
                raise
    finally:
        cur.close()
        conn.close()


async def listen_forever() -> None:
    """Reconnect-with-backoff wrapper - pytr has no built-in keepalive or
    auto-reconnect (confirmed against its own pinned source), so this loop
    owns that entirely. Runs for the lifetime of the sync process, launched
    from main.py's lifespan and cancelled on shutdown. Stops (does not keep
    retrying) once a real auth error is hit - the existing 90-min HTTP
    keepalive job and the 4h cron both keep running independently either
    way, and a human needs to re-run --setup before this listener can
    reconnect."""
    backoff = INITIAL_BACKOFF_S
    while True:
        try:
            await _run_one_session()
        except asyncio.CancelledError:
            log.info("TR realtime: listener cancelled, shutting down")
            raise
        except AuthRequiredError:
            log.warning("TR realtime: stopping until session is re-established via --setup")
            return
        except Exception as e:
            log.warning("TR realtime: disconnected (%s), reconnecting in %ds", e, backoff)
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, MAX_BACKOFF_S)
