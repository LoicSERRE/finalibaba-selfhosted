"""Reading a Trade Republic position payload. Pure: a dict in, a value out.

Split out of sync_tr.py at v2.10.2. These are the functions that know where a
field hides across TR's API versions - "instrumentId" in newer responses,
"isin" in older ones, a valuation under three different keys - and they make no
network call at all, which is what makes them the part worth testing on their
own. sync_tr.py keeps the fetching and the writing.
"""

import logging
from decimal import Decimal

log = logging.getLogger(__name__)

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
    # .to_integral_value() (rounds, ROUND_HALF_EVEN) not int() (truncates) -
    # matches cost_basis_cents above and the TS display layer's
    # Decimal(...).round() in lib/domain/account-detail.ts's
    # holdingMarketValue(). A plain int() here silently dropped sub-cent
    # fractions instead of rounding them, nudging the account's recorded
    # balance snapshot (sum of every position's value_cents) away from what
    # the UI displays (sum of each individually-rounded holding).
    value_cents = int((Decimal(quantity) * Decimal(str(price_cents))).to_integral_value())

    return {
        "isin": isin,
        "name": name,
        "price_cents": price_cents,
        "quantity": quantity,
        "cost_basis_cents": cost_basis_cents,
        "value_cents": value_cents,
    }


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
