"""
Trade Republic portfolio sync via pytr (web login).

Handles multiple account types: CTO (STANDARD), PEA, CRYPTO.

The TR WebSocket API requires passing the securitiesAccountNumber to
compactPortfolio - without it, positions come back empty. Account numbers
are extracted from the tr_session JWT obtained via /api/v1/auth/web/session.

First run: docker exec -it finalibaba-sync-1 python sync_tr.py --setup
"""
import asyncio
import base64
import json
import logging
import os
import sys
from datetime import datetime
from decimal import Decimal

import psycopg2.extras

from db import (
    get_conn,
    get_institution_id,
    record_balance,
    upsert_account,
    upsert_holding,
    upsert_transaction,
    write_sync_log,
)

log = logging.getLogger(__name__)

BASE_URL = "https://api.traderepublic.com"

# TR JWT account type → (AccountType, investmentSubtype, display name, sync_id suffix)
ACC_TYPE_MAP = {
    "default":        ("INVESTMENT", "CTO", "CTO",   "cto"),
    "tax_wrapper_fr": ("INVESTMENT", "PEA", "PEA",   "pea"),
    "CRYPTO":         ("CRYPTO",     None,  "Crypto", "crypto"),  # virtual - from featuresEnabled
}


# ── Auth ──────────────────────────────────────────────────────────────────────

def _get_api(phone_no: str, pin: str, interactive: bool):
    from pytr.api import TradeRepublicApi
    # save_cookies=True → pytr persists cookies to ~/.pytr/cookies.<phone>.txt
    # (MozillaCookieJar format, WAF token excluded automatically)
    api = TradeRepublicApi(phone_no=phone_no, pin=pin, save_cookies=True)

    if not interactive:
        if api.resume_websession():
            return api
        raise AuthRequiredError("Trade Republic: no saved session. Run --setup")

    # Interactive mode (--setup CLI): pytr handles the WAF token via Playwright
    countdown = api.initiate_weblogin()
    print(f"\n📱 Open the Trade Republic app and approve the connection (code valid for {countdown}s).")
    code = input("Enter the code displayed in the app: ").strip()
    api.complete_weblogin(code)  # saves cookies automatically
    print("✓ Web session saved")
    return api


# ── JWT / account discovery ───────────────────────────────────────────────────

def _position_isin(pos: dict) -> str:
    """A TR position's ISIN - the field is called "instrumentId" in newer API
    responses, "isin" in older ones. Every call site needs both checked."""
    return pos.get("instrumentId") or pos.get("isin") or ""


def split_crypto_positions(positions: list) -> tuple[list, list]:
    """TR crypto assets (XF000* ISINs) show up in the CTO portfolio but belong
    to a separate crypto wallet - split them out. Returns (non_crypto, crypto)."""
    non_crypto = [p for p in positions if not _position_isin(p).startswith("XF0")]
    crypto = [p for p in positions if _position_isin(p).startswith("XF0")]
    return non_crypto, crypto


def resolve_position(pos: dict, prices: dict, neon_quantities: dict) -> dict | None:
    """Resolve one TR position dict into the fields the DB layer needs
    (price/quantity/cost-basis/value). Returns None if the position has no
    ISIN (skip it).

    Pure - given the same pos/prices/neon_quantities it always returns the
    same result, no I/O. Extracted from _sync_positions so the price/quantity
    resolution rules (which price source wins, which quantity source wins)
    can be unit tested without a DB.
    """
    isin = _position_isin(pos)
    if not isin:
        return None

    ticker_price, ticker_name = prices.get(isin, (0, None))
    # Prefer neonPortfolio price (already resolved by the caller: neon >
    # exchange ticker) over compactPortfolioByType's own currentPrice, which
    # for illiquid PE/ELTIF funds returns averageBuyIn instead of current NAV.
    raw_price = pos.get("currentPrice") or pos.get("lastPrice") or 0
    compact_price_cents = int(Decimal(str(raw_price)) * 100)
    price_cents = ticker_price or compact_price_cents
    name = ticker_name or pos.get("name") or isin
    # Quantity: prefer neon_quantities[isin] when available - it's the
    # virtualSize neonPortfolio used as price divisor (netValue/virtualSize),
    # so using the same value here ensures quantity × price = netValue
    # exactly. Fixes PE/ELTIF where compactPortfolioByType may omit
    # virtualSize and fall back to netSize, causing a ~20% undercount.
    quantity = str(neon_quantities.get(isin) or pos.get("virtualSize") or pos.get("netSize") or pos.get("quantity", "0"))
    avg_price = str(pos.get("averageBuyIn") or pos.get("avgCost") or 0)
    cost_basis_cents = int((Decimal(quantity) * Decimal(avg_price) * 100).to_integral_value()) if float(avg_price) else None
    value_cents = int(Decimal(quantity) * Decimal(str(price_cents)))

    return {
        "isin": isin,
        "name": name,
        "price_cents": price_cents,
        "quantity": quantity,
        "cost_basis_cents": cost_basis_cents,
        "value_cents": value_cents,
    }


def _is_auth_error(exc: Exception) -> bool:
    """True only for signals that specifically indicate the TR session itself
    is invalid, not any transient network/timeout error. Narrower than
    matching generic words ("session", "login", "expired"...) against the
    full exception text - a transient WebSocket disconnect or timeout could
    easily contain one of those words too, and wrongly deleting a still-valid
    saved session forces the user through the OTP flow again for no reason.
    """
    from pytr.api import TradeRepublicError
    from requests.exceptions import HTTPError

    if isinstance(exc, HTTPError):
        return exc.response is not None and exc.response.status_code == 401
    return isinstance(exc, TradeRepublicError) and "3003" in str(exc.error)


def _decode_jwt_payload(token: str) -> dict:
    try:
        parts = token.split(".")
        if len(parts) < 2:
            return {}
        padded = parts[1] + "=" * (4 - len(parts[1]) % 4)
        return json.loads(base64.urlsafe_b64decode(padded))
    except Exception:
        return {}


def _get_securities_accounts(api) -> tuple[dict[str, list[str]], bool]:
    """
    Refresh web session and decode tr_session JWT.
    Returns:
      sec_accounts: {"default": ["0405756002"], "tax_wrapper_fr": ["0405756003"]}
      has_crypto: True if "crypto" feature is enabled
    """
    try:
        r = api._websession.get(f"{BASE_URL}/api/v1/auth/web/session", timeout=10)
        r.raise_for_status()
        # Response cookies (RequestsCookieJar) have .get(); session jar may be a
        # MozillaCookieJar (no .get()) - check response first, then iterate.
        tr_session = r.cookies.get("tr_session") or next(
            (c.value for c in api._websession.cookies if c.name == "tr_session"),
            None,
        )
        if not tr_session:
            log.warning("TR: tr_session cookie not found after refresh")
            return {}, False

        claims = _decode_jwt_payload(tr_session)
        # JWT: act.acc.owner = {"default": {"sec": [...], "cash": [...]}, "tax_wrapper_fr": {...}}
        owner = claims.get("act", {}).get("acc", {}).get("owner", {})
        sec_accounts = {
            acc_type: acc_data.get("sec", [])
            for acc_type, acc_data in owner.items()
            if acc_type in ACC_TYPE_MAP and acc_data.get("sec")
        }
        features = [f.get("feature") for f in claims.get("featuresEnabled", [])]
        has_crypto = "crypto" in features
        log.info("TR accounts: %s | crypto: %s", dict(sec_accounts), has_crypto)
        return sec_accounts, has_crypto
    except Exception as e:
        log.warning("TR: failed to decode session JWT: %s", e)
        return {}, False


# ── WebSocket fetchers ────────────────────────────────────────────────────────

async def _fetch_positions_for_account(api, sec_number: str) -> list:
    # TR deprecated compactPortfolio for web sessions (connect_id=31) in June 2026.
    # compactPortfolioByType is the replacement - same secAccNo param, positions are
    # grouped in categories[].positions instead of a flat positions list.
    sub = await api.subscribe({"type": "compactPortfolioByType", "secAccNo": sec_number})
    data = await asyncio.wait_for(api._recv_subscription(sub), timeout=15)
    if not isinstance(data, dict):
        return []
    categories = data.get("categories") or []
    if categories:
        return [pos for cat in categories for pos in cat.get("positions", [])]
    return data.get("positions", [])  # fallback if old flat format ever returns


async def _fetch_ticker_price(api, isin: str) -> tuple[int, str | None]:
    """Return (price_cents, name) via instrument + ticker ISIN.EXCHANGE subscriptions."""
    try:
        # Step 1: get instrument metadata (name + available exchanges)
        sub = await api.subscribe({"type": "instrument", "id": isin})
        instr = await asyncio.wait_for(api._recv_subscription(sub), timeout=8)
        if not isinstance(instr, dict):
            return 0, None

        name = instr.get("shortName") or instr.get("name") or None
        active_exchanges = [e["slug"] for e in instr.get("exchanges", []) if e.get("active")]

        # Prefer TR's own exchange (TDG), then EUR venues
        preferred = ["TDG", "LSX", "XETR", "XFRA", "XMIL", "TIB"]
        exchange = next((e for e in preferred if e in active_exchanges), active_exchanges[0] if active_exchanges else None)
        if not exchange:
            return 0, name

        # Step 2: fetch live price via ticker ISIN.EXCHANGE
        sub2 = await api.subscribe({"type": "ticker", "id": f"{isin}.{exchange}"})
        tick = await asyncio.wait_for(api._recv_subscription(sub2), timeout=8)
        if not isinstance(tick, dict):
            return 0, name

        # Response: {"last": {"price": "296.5", ...}, "bid": {...}, "ask": {...}}
        price_str = (
            (tick.get("last") or {}).get("price")
            or (tick.get("bid") or {}).get("price")
            or 0
        )
        return int(Decimal(str(price_str)) * 100), name
    except Exception as e:
        log.warning("TR ticker %s erreur : %s", isin, e)
        return 0, None


def _resolve_isin(pos: dict) -> str:
    return (
        pos.get("instrumentId")
        or pos.get("isin")
        or (pos.get("instrument") or {}).get("isin")
        or ""
    )


def _resolve_direct_price_val(pos: dict):
    """Direct per-unit price field, checked in fallback order (still raw -
    the caller converts to cents). None if no direct price field exists at
    all, meaning only netValue/virtualSize (if available) can price this
    position."""
    price_val = (
        pos.get("currentPrice")
        or pos.get("lastPrice")
        or (pos.get("instrument") or {}).get("currentPrice")
    )
    if price_val is not None:
        return price_val
    cpeur = pos.get("currentPriceEur")
    return cpeur.get("value") if isinstance(cpeur, dict) else cpeur


def _resolve_virtual_size(pos: dict) -> Decimal:
    net_size_raw = pos.get("netSize") or pos.get("quantity") or 0
    virtual_size_raw = pos.get("virtualSize") or net_size_raw
    return Decimal(str(virtual_size_raw))


def _resolve_net_value(pos: dict) -> Decimal:
    net_value_raw = pos.get("netValue") or pos.get("netValueEur")
    if isinstance(net_value_raw, dict):
        net_value_raw = net_value_raw.get("value", 0)
    return Decimal(str(net_value_raw or 0))


def _resolve_neon_price(pos: dict) -> tuple[str, int | None, str | None] | None:
    """Resolve one neonPortfolio position into (isin, price_cents, quantity).
    `quantity` is only set when virtualSize/netSize is positive (used as
    price divisor for PE/ELTIF - see _fetch_neon_portfolio_prices), `price_cents`
    is None when neither netValue/virtualSize nor a direct price field is
    available. Returns None if the position has no ISIN at all.

    Pure - extracted from _fetch_neon_portfolio_prices's loop body so the
    price-resolution rules (netValue/virtualSize wins over a direct price
    field) live in one place, same pattern as resolve_position() above."""
    isin = _resolve_isin(pos)
    if not isin:
        return None

    virtual_size = _resolve_virtual_size(pos)
    quantity = str(virtual_size) if virtual_size > 0 else None

    # netValue is TR's authoritative total position value (what the app displays).
    # For PE/ELTIF funds the exchange ticker currentPrice is stale while netValue
    # reflects the current NAV - always prefer netValue/virtualSize over currentPrice.
    net_value = _resolve_net_value(pos)
    if net_value and virtual_size > 0:
        price_cents = int((net_value / virtual_size * 100).to_integral_value())
        log.info("TR neonPortfolio %s : netValue=%s virtualSize=%s → %d cts/unit",
                 isin, net_value, virtual_size, price_cents)
        return isin, price_cents, quantity

    # Fallback: use direct per-unit price field (liquid instruments without netValue)
    price_val = _resolve_direct_price_val(pos)
    price_cents = int(Decimal(str(price_val)) * 100) if price_val else None
    return isin, price_cents, quantity


async def _fetch_neon_portfolio_prices(api) -> tuple[dict[str, int], dict[str, str]]:
    """Fetch per-unit prices from neonPortfolio subscription.

    neonPortfolio returns current EUR values per position as displayed in the TR app,
    giving accurate prices for illiquid instruments (PE funds) where exchange ticker
    data is stale or wrong.

    Returns:
      prices:          {isin: price_cents}
      neon_quantities: {isin: virtual_size_str} - only for instruments where price was
                       derived via netValue/virtualSize (PE/ELTIF). The same virtualSize
                       must be used as holding quantity so that quantity × price = netValue.
                       Empty for instruments with a direct price field.
    """
    try:
        sub = await api.subscribe({"type": "neonPortfolio"})
        data = await asyncio.wait_for(api._recv_subscription(sub), timeout=15)
        if not isinstance(data, dict):
            return {}, {}

        positions = (
            data.get("positions")
            or data.get("portfolioPositions")
            or data.get("items")
            or []
        )
        if positions:
            log.info("TR neonPortfolio: sample keys=%s", list(positions[0].keys()))

        prices: dict[str, int] = {}
        neon_quantities: dict[str, str] = {}
        for pos in positions:
            resolved = _resolve_neon_price(pos)
            if resolved is None:
                continue
            isin, price_cents, quantity = resolved
            if quantity is not None:
                neon_quantities[isin] = quantity
            if price_cents is not None:
                prices[isin] = price_cents

        log.info("TR neonPortfolio: %d prices loaded, %d PE/ELTIF quantities", len(prices), len(neon_quantities))
        return prices, neon_quantities
    except Exception as e:
        log.warning("TR neonPortfolio error (fallback to ticker): %s", e)
        return {}, {}


async def _fetch_crypto_positions(api) -> list:
    """Crypto uses a dedicated subscription (no securitiesAccountNumber)."""
    try:
        sub = await api.subscribe({"type": "cryptoPortfolio"})
        data = await asyncio.wait_for(api._recv_subscription(sub), timeout=15)
        return data.get("positions", []) if isinstance(data, dict) else []
    except Exception as e:
        log.warning("TR cryptoPortfolio erreur : %s", e)
        return []


async def _fetch_cash(api) -> list:
    sub = await api.subscribe({"type": "cash"})
    data = await asyncio.wait_for(api._recv_subscription(sub), timeout=15)
    return data if isinstance(data, list) else []


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
    label = f"{title} - {subtitle}" if subtitle and subtitle != title else (title or subtitle or "—")

    return {
        "id": item["id"],
        "date": _parse_tr_timestamp(item["timestamp"]),
        "label": label,
        "amount_cents": int(Decimal(str(value)) * 100),
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
            )
            count += 1
        log.info("TR transactions - %d nouvelle(s) sur %d élément(s) reçus", count, len(items))
        return count
    except Exception as e:
        log.warning("TR transactions ignorées : %s", e)
        return 0


async def _fetch_positions_for_type(api, acc_type: str, sec_numbers: list[str]) -> list:
    """Fetch and merge positions across every securities-account-number under
    one TR account type (a type can have several sub-accounts) - a fetch
    failure on one sub-account is logged and skipped rather than aborting
    the others, same non-fatal-per-item pattern as _sync_account_transactions
    in sync_lcl.py/sync_woob.py."""
    all_positions = []
    for sec_num in sec_numbers:
        try:
            positions = await _fetch_positions_for_account(api, sec_num)
            all_positions.extend(positions)
            log.info("TR %s (%s) : %d position(s)", acc_type, sec_num, len(positions))
        except Exception as e:
            log.warning("TR %s (%s) erreur : %s", acc_type, sec_num, e)
    return all_positions


async def _build_positions_by_type(api, sec_accounts: dict[str, list[str]], has_crypto: bool) -> dict:
    """Fetch every account type's positions and group them, splitting TR's
    crypto-in-CTO assets (XF000* ISINs) out to their own CRYPTO bucket and
    merging in the dedicated cryptoPortfolio subscription when enabled."""
    positions_by_type: dict[str, list] = {}

    for acc_type, sec_numbers in sec_accounts.items():
        all_positions = await _fetch_positions_for_type(api, acc_type, sec_numbers)

        # TR crypto assets (XF000* ISINs) are in the CTO portfolio but belong
        # to a separate crypto wallet - split them out to the CRYPTO account.
        if acc_type == "default":
            all_positions, crypto_pos = split_crypto_positions(all_positions)
            if crypto_pos:
                positions_by_type.setdefault("CRYPTO", []).extend(crypto_pos)
                log.info("TR %d crypto position(s) (XF000*) split from CTO", len(crypto_pos))

        if all_positions:
            positions_by_type[acc_type] = all_positions

    if has_crypto:
        crypto_positions = await _fetch_crypto_positions(api)
        if crypto_positions:
            positions_by_type["CRYPTO"] = crypto_positions

    return positions_by_type


async def _resolve_ticker_prices(api, all_isins: set[str], neon_prices: dict[str, int]) -> dict[str, tuple[int, str | None]]:
    """Ticker subscription for name resolution + fallback prices - always
    prefers neonPortfolio's price (authoritative TR display value) over the
    exchange ticker when both are available."""
    prices: dict[str, tuple[int, str | None]] = {}
    for isin in all_isins:
        ticker_cents, name = await _fetch_ticker_price(api, isin)
        price_cents = neon_prices.get(isin) or ticker_cents
        prices[isin] = (price_cents, name)
        log.debug("TR %s : neon=%s ticker=%d final=%d cts name=%s",
                  isin, neon_prices.get(isin), ticker_cents, price_cents, name)
    return prices


async def _fetch_all(
    api, sec_accounts: dict[str, list[str]], has_crypto: bool, known_tx_ids: set[str]
) -> tuple[dict, list, dict, dict, list]:
    """
    Returns:
      positions_by_type: {"default": [...], "tax_wrapper_fr": [...], "CRYPTO": [...]}
      cash_accounts: [{"currencyId": "EUR", "amount": 1700.63}, ...]
      prices: {isin: (price_cents, name)} fetched via ticker subscription
      neon_quantities: {isin: virtual_size_str} for PE/ELTIFs priced via netValue/virtualSize
      timeline_items: raw timelineTransactions/timelineActivityLog items, deduplicated

    Transaction history is fetched here, in the same event loop as everything
    else, deliberately - api's websocket connection is bound to whichever
    asyncio event loop created it (via the one asyncio.run() call in run()),
    and calling asyncio.run() a second time for a separate fetch creates a
    *different* loop, which fails hard trying to reuse that same connection
    ("Future ... attached to a different loop"). Confirmed the hard way
    testing against a real account before this was folded in here.
    """
    positions_by_type = await _build_positions_by_type(api, sec_accounts, has_crypto)

    all_isins = {
        _position_isin(pos)
        for positions in positions_by_type.values()
        for pos in positions
        if _position_isin(pos)
    }

    # neonPortfolio gives accurate per-unit prices for all instruments including
    # illiquid ones (PE funds, funds with delayed NAV) where exchange tickers are wrong.
    # neon_quantities carries the virtualSize used as price divisor for PE/ELTIFs - must
    # be reused as holding quantity so that quantity × price = netValue exactly.
    neon_prices, neon_quantities = await _fetch_neon_portfolio_prices(api)

    prices = await _resolve_ticker_prices(api, all_isins, neon_prices)

    cash_accounts = await _fetch_cash(api)
    timeline_items = await _fetch_all_timeline_items(api, known_tx_ids)
    return positions_by_type, cash_accounts, prices, neon_quantities, timeline_items


# ── DB sync ───────────────────────────────────────────────────────────────────

def _sync_positions(cur, positions: list, account_id: str, acc_type_label: str, prices: dict, neon_quantities: dict) -> int:
    # Purge holdings no longer in TR portfolio (sold positions)
    current_isins = {_position_isin(pos) for pos in positions if _position_isin(pos)}
    if current_isins:
        cur.execute(
            f'DELETE FROM "Holding" WHERE "accountId" = %s AND ticker NOT IN ({",".join(["%s"] * len(current_isins))})',
            [account_id, *current_isins],
        )
    else:
        cur.execute('DELETE FROM "Holding" WHERE "accountId" = %s', (account_id,))

    total_cents = 0
    for pos in positions:
        resolved = resolve_position(pos, prices, neon_quantities)
        if resolved is None:
            continue
        total_cents += resolved["value_cents"]
        upsert_holding(
            cur,
            account_id=account_id,
            ticker=resolved["isin"],
            name=resolved["name"],
            quantity=resolved["quantity"],
            last_price_cents=resolved["price_cents"],
        )
        if resolved["cost_basis_cents"]:
            cur.execute(
                'UPDATE "Holding" SET "costBasisCents" = %s WHERE "accountId" = %s AND ticker = %s',
                (resolved["cost_basis_cents"], account_id, resolved["isin"]),
            )
        log.info(
            "TR %s - %s (%s): qty %s @ %d cts",
            acc_type_label, resolved["name"], resolved["isin"], resolved["quantity"], resolved["price_cents"],
        )
    record_balance(cur, account_id, total_cents)
    return total_cents


def _get_or_create_account(cur, institution_id: str, acc_type: str) -> str:
    db_type, subtype, display_name, sync_suffix = ACC_TYPE_MAP[acc_type]
    sync_id = f"tr:{sync_suffix}"

    # Migrate legacy "tr:portfolio" → "tr:cto" on first run
    if acc_type == "default":
        cur.execute('SELECT id FROM "Account" WHERE "syncId" IN (%s, %s)', ("tr:portfolio", "tr:standard"))
        row = cur.fetchone()
        if row:
            cur.execute('UPDATE "Account" SET "syncId" = %s WHERE id = %s', (sync_id, row["id"]))
            if subtype:
                cur.execute(
                    'UPDATE "Account" SET "investmentSubtype" = %s, name = %s WHERE id = %s AND "investmentSubtype" IS NULL',
                    (subtype, display_name, row["id"]),
                )
            return row["id"]

    account_id = upsert_account(
        cur,
        sync_id=sync_id,
        name=display_name,
        account_type=db_type,
        institution_id=institution_id,
    )
    if subtype:
        cur.execute(
            'UPDATE "Account" SET "investmentSubtype" = %s WHERE id = %s AND "investmentSubtype" IS NULL',
            (subtype, account_id),
        )
    return account_id


# ── Entry point ───────────────────────────────────────────────────────────────

def run(interactive: bool = False) -> dict:
    phone_no = os.environ["TR_PHONE"]
    pin = os.environ["TR_PIN"]

    try:
        api = _get_api(phone_no, pin, interactive)
    except AuthRequiredError:
        conn = get_conn()
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        write_sync_log(cur, "trade_republic", "auth_required", "Session web absente - lance --setup")
        conn.commit()
        raise

    conn = get_conn()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    institution_id = get_institution_id(cur, "Trade Republic")
    if not institution_id:
        raise RuntimeError("Institution 'Trade Republic' not found in DB. Run npm run db:seed.")

    # Discover securities account numbers from JWT.
    # _get_securities_accounts() calls /api/v1/auth/web/session which refreshes TR cookies -
    # persist them immediately so the next sync reads fresh cookies instead of the originals.
    sec_accounts, has_crypto = _get_securities_accounts(api)
    api.save_websession()
    if not sec_accounts:
        log.warning("TR: JWT decode failed - no portfolio accounts found, only cash will be synced")

    # Created here (not after the fetch, where the cash balance itself is
    # recorded) so its already-synced transaction ids can be loaded before
    # the timeline fetch below - upsert_account is idempotent either way.
    cash_account_id = upsert_account(
        cur,
        sync_id="tr:cash",
        name="Compte espèces",
        account_type="CHECKING",
        institution_id=institution_id,
    )
    cur.execute('SELECT "syncId" FROM "Transaction" WHERE "accountId" = %s', (cash_account_id,))
    known_tx_ids = {row["syncId"].split(":", 1)[1] for row in cur.fetchall() if row["syncId"]}

    try:
        positions_by_type, cash_accounts, prices, neon_quantities, timeline_items = asyncio.run(
            _fetch_all(api, sec_accounts, has_crypto, known_tx_ids)
        )
    except Exception as e:
        if _is_auth_error(e):
            api._cookies_file.unlink(missing_ok=True)
            conn.commit()
            _mark_auth_required("Session expirée - reconnecte depuis Paramètres → Trade Republic")
            raise AuthRequiredError("Trade Republic: session expired. Run --setup")
        raise

    # Sync each account type to DB
    total_positions = 0
    summary_parts = []
    for acc_type, positions in positions_by_type.items():
        account_id = _get_or_create_account(cur, institution_id, acc_type)
        count_cents = _sync_positions(cur, positions, account_id, acc_type, prices, neon_quantities)
        total_positions += len(positions)
        summary_parts.append(f"{acc_type}: {len(positions)} pos ({count_cents/100:.0f}€)")

    # Cash balance (account itself already created above, before the fetch)
    cash_eur = sum(a.get("amount", 0) for a in cash_accounts if a.get("currencyId") == "EUR")
    cash_cents = int(Decimal(str(cash_eur)) * 100)
    record_balance(cur, cash_account_id, cash_cents)
    summary_parts.append(f"cash: {cash_eur:.2f}€")
    log.info("TR cash - %d cts", cash_cents)

    tx_count = _sync_transactions(cur, cash_account_id, timeline_items)
    if tx_count:
        summary_parts.append(f"{tx_count} transaction(s)")

    # XF000* ISINs (TR crypto) always belong in the CRYPTO account, never in CTO.
    # Purge unconditionally so stale entries from previous syncs are removed.
    cur.execute(
        'DELETE FROM "Holding" WHERE "accountId" IN (SELECT id FROM "Account" WHERE "syncId" = %s) AND ticker LIKE \'XF0%%\'',
        ("tr:cto",),
    )
    log.info("TR: purged XF000* crypto holdings from CTO")

    msg = " | ".join(summary_parts) if summary_parts else f"cash {cash_eur:.2f}€ (0 position)"
    write_sync_log(cur, "trade_republic", "success", msg)
    conn.commit()
    cur.close()
    conn.close()
    return {"positions": total_positions, "cash_cents": cash_cents}


def _mark_auth_required(msg: str) -> None:
    """Write auth_required to DB. Caller is responsible for deleting the session file."""
    try:
        conn = get_conn()
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        write_sync_log(cur, "trade_republic", "auth_required", msg)
        conn.commit()
        cur.close()
        conn.close()
        log.info("TR: auth_required written to DB")
    except Exception as db_err:
        log.warning("TR: failed to write auth_required to DB - %s", db_err)


def keepalive() -> None:
    """
    Refresh TR web session cookies to prevent expiry (~3h server-side TTL).
    Call every ~2h to keep the session alive between syncs.
    Writes auth_required to DB when an invalid session is detected.
    """
    from pytr.api import TradeRepublicApi
    phone_no = os.environ["TR_PHONE"]
    pin = os.environ["TR_PIN"]
    api = TradeRepublicApi(phone_no=phone_no, pin=pin, save_cookies=True)
    if not api._cookies_file.exists():
        log.debug("TR keepalive: no saved session - skipped")
        return
    try:
        if api.resume_websession():
            # Call /api/v1/auth/web/session to refresh the server-side cookie TTL.
            # Without this, resume_websession() only validates existing cookies but
            # does NOT extend their expiry - causing failures ~2h after last full sync.
            r = api._websession.get(f"{BASE_URL}/api/v1/auth/web/session", timeout=10)
            r.raise_for_status()
            api.save_websession()
            log.info("TR keepalive: session refreshed and saved")
        else:
            log.warning("TR keepalive: session expired - re-auth required")
            _mark_auth_required("Session expired - reconnect from Settings → Trade Republic")
    except Exception as e:
        log.warning("TR keepalive: error - %s", e)


class AuthRequiredError(Exception):
    pass


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    interactive = "--setup" in sys.argv
    try:
        result = run(interactive=interactive)
        print(f"✓ TR sync OK - {result['positions']} position(s), cash {result['cash_cents']/100:.2f}€")
    except AuthRequiredError as e:
        print(f"⚠ {e}")
        print("→ Re-run with: docker exec -it finalibaba-sync-1 python sync_tr.py --setup")
        sys.exit(2)
    except Exception:
        log.exception("Trade Republic sync error")
        sys.exit(1)
