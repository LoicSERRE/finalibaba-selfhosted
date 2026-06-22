"""
Trade Republic portfolio sync via pytr (web login).

Handles multiple account types: CTO (STANDARD), PEA, CRYPTO.

The TR WebSocket API requires passing the securitiesAccountNumber to
compactPortfolio — without it, positions come back empty. Account numbers
are extracted from the tr_session JWT obtained via /api/v1/auth/web/session.

First run: docker exec -it finalibaba-sync-1 python sync_tr.py --setup
"""
import asyncio
import base64
import json
import logging
import os
import sys
from decimal import Decimal
from pathlib import Path

import psycopg2.extras

from db import get_conn, get_institution_id, upsert_account, upsert_holding, record_balance, write_sync_log

log = logging.getLogger(__name__)

BASE_URL = "https://api.traderepublic.com"

# TR JWT account type → (AccountType, investmentSubtype, display name, sync_id suffix)
ACC_TYPE_MAP = {
    "default":        ("INVESTMENT", "CTO", "CTO",   "cto"),
    "tax_wrapper_fr": ("INVESTMENT", "PEA", "PEA",   "pea"),
    "CRYPTO":         ("CRYPTO",     None,  "Crypto", "crypto"),  # virtual — from featuresEnabled
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
        # MozillaCookieJar (no .get()) — check response first, then iterate.
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
        log.info("TR accounts: %s | crypto: %s", {k: v for k, v in sec_accounts.items()}, has_crypto)
        return sec_accounts, has_crypto
    except Exception as e:
        log.warning("TR: failed to decode session JWT: %s", e)
        return {}, False


# ── WebSocket fetchers ────────────────────────────────────────────────────────

async def _fetch_positions_for_account(api, sec_number: str) -> list:
    # TR deprecated compactPortfolio for web sessions (connect_id=31) in June 2026.
    # compactPortfolioByType is the replacement — same secAccNo param, positions are
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


async def _fetch_neon_portfolio_prices(api) -> tuple[dict[str, int], dict[str, str]]:
    """Fetch per-unit prices from neonPortfolio subscription.

    neonPortfolio returns current EUR values per position as displayed in the TR app,
    giving accurate prices for illiquid instruments (PE funds) where exchange ticker
    data is stale or wrong.

    Returns:
      prices:          {isin: price_cents}
      neon_quantities: {isin: virtual_size_str} — only for instruments where price was
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
            isin = (
                pos.get("instrumentId")
                or pos.get("isin")
                or (pos.get("instrument") or {}).get("isin")
                or ""
            )
            if not isin:
                continue

            # Try direct per-unit price fields first
            price_val = (
                pos.get("currentPrice")
                or pos.get("lastPrice")
                or (pos.get("instrument") or {}).get("currentPrice")
            )
            if price_val is None:
                cpeur = pos.get("currentPriceEur")
                price_val = cpeur.get("value") if isinstance(cpeur, dict) else cpeur

            net_size_raw = pos.get("netSize") or pos.get("quantity") or 0
            virtual_size_raw = pos.get("virtualSize") or net_size_raw
            virtual_size = Decimal(str(virtual_size_raw))
            if virtual_size > 0:
                neon_quantities[isin] = str(virtual_size)

            # netValue is TR's authoritative total position value (what the app displays).
            # For PE/ELTIF funds the exchange ticker currentPrice is stale while netValue
            # reflects the current NAV — always prefer netValue/virtualSize over currentPrice.
            net_value_raw = pos.get("netValue") or pos.get("netValueEur")
            if isinstance(net_value_raw, dict):
                net_value_raw = net_value_raw.get("value", 0)
            net_value = Decimal(str(net_value_raw or 0))

            if net_value and virtual_size > 0:
                prices[isin] = int((net_value / virtual_size * 100).to_integral_value())
                log.info("TR neonPortfolio %s : netValue=%s virtualSize=%s → %d cts/unit",
                         isin, net_value, virtual_size, prices[isin])
                continue

            # Fallback: use direct per-unit price field (liquid instruments without netValue)
            if price_val:
                prices[isin] = int(Decimal(str(price_val)) * 100)

        log.info("TR neonPortfolio: %d prix chargés, %d quantités PE/ELTIF", len(prices), len(neon_quantities))
        return prices, neon_quantities
    except Exception as e:
        log.warning("TR neonPortfolio erreur (fallback ticker) : %s", e)
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


async def _fetch_all(api, sec_accounts: dict[str, list[str]], has_crypto: bool) -> tuple[dict, list, dict, dict]:
    """
    Returns:
      positions_by_type: {"default": [...], "tax_wrapper_fr": [...], "CRYPTO": [...]}
      cash_accounts: [{"currencyId": "EUR", "amount": 1700.63}, ...]
      prices: {isin: (price_cents, name)} fetched via ticker subscription
      neon_quantities: {isin: virtual_size_str} for PE/ELTIFs priced via netValue/virtualSize
    """
    positions_by_type: dict[str, list] = {}

    for acc_type, sec_numbers in sec_accounts.items():
        all_positions = []
        for sec_num in sec_numbers:
            try:
                positions = await _fetch_positions_for_account(api, sec_num)
                all_positions.extend(positions)
                log.info("TR %s (%s) : %d position(s)", acc_type, sec_num, len(positions))
            except Exception as e:
                log.warning("TR %s (%s) erreur : %s", acc_type, sec_num, e)

        # TR crypto assets (XF000* ISINs) are in the CTO portfolio but belong
        # to a separate crypto wallet — split them out to the CRYPTO account.
        # New format uses "isin" field; old used "instrumentId" — check both.
        if acc_type == "default":
            def _isin(p: dict) -> str:
                return p.get("instrumentId") or p.get("isin") or ""
            crypto_pos = [p for p in all_positions if _isin(p).startswith("XF0")]
            all_positions = [p for p in all_positions if not _isin(p).startswith("XF0")]
            if crypto_pos:
                positions_by_type.setdefault("CRYPTO", []).extend(crypto_pos)
                log.info("TR %d position(s) crypto (XF000*) séparée(s) du CTO", len(crypto_pos))

        if all_positions:
            positions_by_type[acc_type] = all_positions

    if has_crypto:
        crypto_positions = await _fetch_crypto_positions(api)
        if crypto_positions:
            positions_by_type["CRYPTO"] = crypto_positions

    # Collect unique ISINs
    all_isins = {
        pos.get("instrumentId") or pos.get("isin", "")
        for positions in positions_by_type.values()
        for pos in positions
        if pos.get("instrumentId") or pos.get("isin")
    }

    # neonPortfolio gives accurate per-unit prices for all instruments including
    # illiquid ones (PE funds, funds with delayed NAV) where exchange tickers are wrong.
    # neon_quantities carries the virtualSize used as price divisor for PE/ELTIFs — must
    # be reused as holding quantity so that quantity × price = netValue exactly.
    neon_prices, neon_quantities = await _fetch_neon_portfolio_prices(api)

    # Ticker subscription for name resolution + fallback prices
    prices: dict[str, tuple[int, str | None]] = {}
    for isin in all_isins:
        ticker_cents, name = await _fetch_ticker_price(api, isin)
        # Prefer neonPortfolio price (authoritative TR display value) over exchange ticker
        price_cents = neon_prices.get(isin) or ticker_cents
        prices[isin] = (price_cents, name)
        log.debug("TR %s : neon=%s ticker=%d final=%d cts name=%s",
                  isin, neon_prices.get(isin), ticker_cents, price_cents, name)

    cash_accounts = await _fetch_cash(api)
    return positions_by_type, cash_accounts, prices, neon_quantities


# ── DB sync ───────────────────────────────────────────────────────────────────

def _sync_positions(cur, positions: list, account_id: str, acc_type_label: str, prices: dict, neon_quantities: dict) -> int:
    # Purge holdings no longer in TR portfolio (sold positions)
    current_isins = {
        pos.get("instrumentId") or pos.get("isin", "")
        for pos in positions
        if pos.get("instrumentId") or pos.get("isin")
    }
    if current_isins:
        cur.execute(
            f'DELETE FROM "Holding" WHERE "accountId" = %s AND ticker NOT IN ({",".join(["%s"] * len(current_isins))})',
            [account_id, *current_isins],
        )
    else:
        cur.execute('DELETE FROM "Holding" WHERE "accountId" = %s', (account_id,))

    total_cents = 0
    for pos in positions:
        isin = pos.get("instrumentId") or pos.get("isin", "")
        if not isin:
            continue
        ticker_price, ticker_name = prices.get(isin, (0, None))
        # Prefer neonPortfolio price (already resolved in _fetch_all: neon > exchange ticker).
        # neonPortfolio derives price from netValue/virtualSize which matches exactly what TR
        # displays — including current NAV for illiquid PE/ELTIF funds where compactPortfolio
        # returns averageBuyIn as currentPrice instead of the actual current NAV.
        raw_price = pos.get("currentPrice") or pos.get("lastPrice") or 0
        compact_price_cents = int(Decimal(str(raw_price)) * 100)
        price_cents = ticker_price or compact_price_cents
        name = ticker_name or pos.get("name") or isin
        # Quantity: prefer neon_quantities[isin] when available — it's the virtualSize neonPortfolio
        # used as price divisor (netValue/virtualSize), so using the same value here ensures
        # quantity × price = netValue exactly. This fixes PE/ELTIF where compactPortfolioByType
        # may omit virtualSize and fall back to netSize, causing a ~20% undercount.
        quantity = str(neon_quantities.get(isin) or pos.get("virtualSize") or pos.get("netSize") or pos.get("quantity", "0"))
        # Average buy price (cost basis) if provided by TR
        avg_price = str(pos.get("averageBuyIn") or pos.get("avgCost") or 0)
        cost_basis_cents = int((Decimal(quantity) * Decimal(avg_price) * 100).to_integral_value()) if float(avg_price) else None
        value_cents = int(Decimal(quantity) * Decimal(str(price_cents)))
        total_cents += value_cents
        upsert_holding(
            cur,
            account_id=account_id,
            ticker=isin,
            name=name,
            quantity=quantity,
            last_price_cents=price_cents,
        )
        if cost_basis_cents:
            cur.execute(
                'UPDATE "Holding" SET "costBasisCents" = %s WHERE "accountId" = %s AND ticker = %s',
                (cost_basis_cents, account_id, isin),
            )
        log.info("TR %s — %s (%s) : qté %s @ %d cts", acc_type_label, name, isin, quantity, price_cents)
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
        write_sync_log(cur, "trade_republic", "auth_required", "Session web absente — lance --setup")
        conn.commit()
        raise

    conn = get_conn()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    institution_id = get_institution_id(cur, "Trade Republic")
    if not institution_id:
        raise RuntimeError("Institution 'Trade Republic' not found in DB. Run npm run db:seed.")

    # Discover securities account numbers from JWT.
    # _get_securities_accounts() calls /api/v1/auth/web/session which refreshes TR cookies —
    # persist them immediately so the next sync reads fresh cookies instead of the originals.
    sec_accounts, has_crypto = _get_securities_accounts(api)
    api.save_websession()
    if not sec_accounts:
        log.warning("TR: JWT decode failed — no portfolio accounts found, only cash will be synced")

    try:
        positions_by_type, cash_accounts, prices, neon_quantities = asyncio.run(_fetch_all(api, sec_accounts, has_crypto))
    except Exception as e:
        err = str(e).lower()
        if any(w in err for w in ["unauthorized", "401", "session", "expired", "login", "3003"]):
            api._cookies_file.unlink(missing_ok=True)
            conn.commit()
            _mark_auth_required("Session expirée — reconnecte depuis Paramètres → Trade Republic")
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

    # Cash account (always present)
    cash_account_id = upsert_account(
        cur,
        sync_id="tr:cash",
        name="Compte espèces",
        account_type="CHECKING",
        institution_id=institution_id,
    )
    cash_eur = sum(a.get("amount", 0) for a in cash_accounts if a.get("currencyId") == "EUR")
    cash_cents = int(Decimal(str(cash_eur)) * 100)
    record_balance(cur, cash_account_id, cash_cents)
    summary_parts.append(f"cash: {cash_eur:.2f}€")
    log.info("TR cash — %d cts", cash_cents)

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
        log.warning("TR: failed to write auth_required to DB — %s", db_err)


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
        log.debug("TR keepalive: no saved session — skipped")
        return
    try:
        if api.resume_websession():
            # Call /api/v1/auth/web/session to refresh the server-side cookie TTL.
            # Without this, resume_websession() only validates existing cookies but
            # does NOT extend their expiry — causing failures ~2h after last full sync.
            r = api._websession.get(f"{BASE_URL}/api/v1/auth/web/session", timeout=10)
            r.raise_for_status()
            api.save_websession()
            log.info("TR keepalive: session refreshed and saved")
        else:
            log.warning("TR keepalive: session expired — re-auth required")
            _mark_auth_required("Session expired — reconnect from Settings → Trade Republic")
    except Exception as e:
        log.warning("TR keepalive: error — %s", e)


class AuthRequiredError(Exception):
    pass


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    interactive = "--setup" in sys.argv
    try:
        result = run(interactive=interactive)
        print(f"✓ TR sync OK — {result['positions']} position(s), cash {result['cash_cents']/100:.2f}€")
    except AuthRequiredError as e:
        print(f"⚠ {e}")
        print("→ Re-run with: docker exec -it finalibaba-sync-1 python sync_tr.py --setup")
        sys.exit(2)
    except Exception as e:
        log.exception("Trade Republic sync error")
        sys.exit(1)
