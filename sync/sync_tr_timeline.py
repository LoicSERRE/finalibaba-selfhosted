"""Trade Republic's activity feed, and the Transaction rows it becomes.

Split out of sync_tr.py at v2.10.2, where 1172 lines made it the largest file
in the repository - and the largest nobody had measured, since the release
audit only ever ran `wc -l` over app/, components/ and lib/.

Positions and prices stay in sync_tr.py; this is the other half, the one that
turns a timeline item into a bank movement. Text moved, nothing else.
"""

import asyncio
import logging
from datetime import datetime
from decimal import Decimal

from db import upsert_transaction

log = logging.getLogger(__name__)

# ── Transaction history (timeline) ────────────────────────────────────────────

# TR's own app activity feed is split across two subscription types that
# together cover everything money-related: timelineTransactions (trades,
# dividends, interest, transfers) and timelineActivityLog (card payments,
# deposits, and a few event types timelineTransactions omits) - pytr's own
# Timeline class fetches and merges both for the exact same reason. Both are
# cursor-paginated and return newest-first.
TIMELINE_FEEDS = ("timelineTransactions", "timelineActivityLog")


def _parse_tr_timestamp(ts: str) -> datetime:
    """TR's timeline timestamps look like '...+0200' (no colon in the UTC
    offset), which Python's datetime.fromisoformat rejects on older
    versions - same fix pytr's own Event.from_dict applies before parsing."""
    if len(ts) >= 5 and ts[-5] in "+-" and ts[-3] != ":":
        ts = ts[:-2] + ":" + ts[-2:]
    return datetime.fromisoformat(ts)


async def _fetch_timeline_feed(api, feed_type: str, known_ids: set[str], max_pages: int = 200) -> list[dict]:
    """Paginate one timeline feed (newest-first) until either the API runs
    out of pages, or an entire page is already-known (syncId already in DB)
    - since the feed is strictly newest-first, that means everything further
    back is guaranteed already synced too, so it's safe to stop there. This
    is what keeps every sync after the first one fast: the very first run
    (empty known_ids) paginates the full available history, every run after
    that stops within a page or two of the most recent already-synced item.
    max_pages is a hard safety cap so a bug in the stop condition, or an API
    response shape TR changes later, can't paginate forever.
    """
    items = []
    after = None
    for _ in range(max_pages):
        try:
            sub = await api.subscribe({"type": feed_type, "after": after})
            page = await asyncio.wait_for(api._recv_subscription(sub), timeout=15)
        except Exception as e:
            log.warning("TR %s page fetch error (stopping this feed here): %s", feed_type, e)
            break
        if not isinstance(page, dict):
            break
        page_items = page.get("items") or []
        if not page_items:
            break
        items.extend(page_items)
        if all(item.get("id") in known_ids for item in page_items):
            break
        after = (page.get("cursors") or {}).get("after")
        if not after:
            break
    return items


# Trade Republic's own event vocabulary for "this moved securities, not
# household money". Read from the raw timeline item, which carries an
# eventType this project never looked at before.
#
# The label fallback below exists because that is the ONLY signal rows
# already in the database carry - eventType was never stored for them, and
# a re-sync will not revisit them since upsert_transaction skips a syncId it
# already knows. It is also the safety net if TR renames an event: the
# German words below come from real captured data on a live account, the
# eventType strings from pytr's vocabulary, and neither is guaranteed
# forever.
_SECURITIES_EVENT_TYPES = frozenset({
    "TRADE_INVOICE",
    "ORDER_EXECUTED",
    "SAVINGS_PLAN_EXECUTED",
    "SAVINGS_PLAN_INVOICE_CREATED",
    "BENEFITS_SAVEBACK_EXECUTION",
    "BENEFITS_SPARE_CHANGE_EXECUTION",
    "SHAREBOOKING",
    "SHAREBOOKING_TRANSACTION",
    "TRADE_CORRECTED",
})

_SECURITIES_LABEL_MARKERS = ("kauforder", "verkaufsorder", "sparplan", "saveback")


def is_securities_movement(item: dict, label: str) -> bool:
    """Whether this timeline entry is a portfolio movement rather than
    spending. Pure, so the classification can be tested without a live
    session - see _timeline_item_to_transaction's own note.

    Dividends and interest are deliberately NOT here: they are real income
    the user may well want in their budget, and they are separately
    recordable as an IncomeEvent.
    """
    event_type = (item.get("eventType") or "").strip().upper()
    if event_type in _SECURITIES_EVENT_TYPES:
        return True

    lowered = label.lower()
    if any(marker in lowered for marker in _SECURITIES_LABEL_MARKERS):
        return True
    # "<instrument> - PEA": cash entering the PEA envelope, which the
    # account's own balance already reflects.
    return lowered.endswith("- pea")


def _timeline_item_to_transaction(item: dict) -> dict | None:
    """Resolve one raw timeline item into the fields upsert_transaction()
    needs. Returns None for items that don't represent a real money movement
    (no amount, cancelled) - informational-only timeline entries (address
    changes, document notifications, etc.) have no "amount" field at all.

    Pure - no I/O, so the mapping logic can be unit tested without a live
    TR session, same reasoning as resolve_position() above.
    """
    if item.get("status", "").lower() == "canceled":
        return None
    amount = item.get("amount")
    value = amount.get("value") if isinstance(amount, dict) else None
    if not value:
        return None

    title = (item.get("title") or "").strip()
    subtitle = (item.get("subtitle") or "").strip()
    label = f"{title} - {subtitle}" if subtitle and subtitle != title else (title or subtitle or "-")

    return {
        "id": item["id"],
        "date": _parse_tr_timestamp(item["timestamp"]),
        "label": label,
        "amount_cents": int(Decimal(str(value)) * 100),
        "is_securities_movement": is_securities_movement(item, label),
        # The bank's own name for what this is. Stored raw and used as
        # evidence the label cannot give: a card payment is never one leg of a
        # transfer between two of your own accounts, however well its amount
        # happens to match something elsewhere.
        "source_event_type": (item.get("eventType") or None),
    }


async def _fetch_all_timeline_items(api, known_ids: set[str]) -> list[dict]:
    merged: dict[str, dict] = {}
    for feed_type in TIMELINE_FEEDS:
        for item in await _fetch_timeline_feed(api, feed_type, known_ids):
            merged[item["id"]] = item  # both feeds can report the same event id
    return list(merged.values())


def _sync_transactions(cur, account_id: str, items: list[dict]) -> int:
    """Upsert TR's cash-relevant activity history (card payments, transfers,
    trades, dividends, interest) into the same account transaction history
    LCL/Woob already populate for their accounts, so budget categorization
    and recurring-transaction detection work the same way for Trade
    Republic's cash account as for a regular bank account.

    `items` is already fetched (see _fetch_all's docstring for why that
    fetch has to happen inside the same asyncio.run() call as the
    positions/cash fetch, not a separate one here) - this function is pure
    DB writing, no I/O to TR at all.

    Errors here are non-fatal - the position/cash sync above already
    committed, so a failure here just leaves the transaction history stale
    until the next run instead of failing the whole TR sync, same pattern
    as _sync_account_transactions in sync_lcl.py/sync_woob.py.
    """
    try:
        count = 0
        for item in items:
            resolved = _timeline_item_to_transaction(item)
            if resolved is None:
                continue
            upsert_transaction(
                cur,
                account_id=account_id,
                sync_id=f"tr:{resolved['id']}",
                date=resolved["date"],
                label=resolved["label"],
                amount_cents=resolved["amount_cents"],
                is_securities_movement=resolved["is_securities_movement"],
                source_event_type=resolved["source_event_type"],
            )
            count += 1
        log.info("TR transactions - %d nouvelle(s) sur %d élément(s) reçus", count, len(items))
        return count
    except Exception as e:
        log.warning("TR transactions ignorées : %s", e)
        return 0

