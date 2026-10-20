"""Daily exchange rates for accounts a bank keeps in another currency.

The Python half of lib/services/exchange-rate.ts's ratesToEurForDays (v2.18,
dev-docs/currencies.md): both read and fill the same "ExchangeRate" table,
so a rate fetched by either side is the rate the other one uses. Every
*Cents column is in the instance's base currency (EUR unless set otherwise
at install, v2.19 - base_currency); what a bank reports in another one is
stored beside its converted value, at the rate of the day it describes.

Same rules as the app: one cache read and at most one Yahoo request per
batch of days, a day without a close (a weekend) takes the previous one
within a week and is stored under its own day, and a day nobody can price
is None - callers skip the write, never guess.
"""

import datetime
import logging
import os
from decimal import ROUND_HALF_UP, Decimal

import requests

log = logging.getLogger(__name__)

DEFAULT_BASE_CURRENCY = "EUR"
# The bases a holding can be converted into - HoldingCurrency's values, the
# same list as lib/utils/base-currency.ts.
SUPPORTED_BASE_CURRENCIES = ("EUR", "USD", "GBP", "CHF")
LOOKBACK_DAYS = 7
FETCH_TIMEOUT_S = 8

_settled_base: str | None = None


def parse_base_currency(raw) -> str:
    code = str(raw or "").strip().upper()
    return code if code in SUPPORTED_BASE_CURRENCIES else DEFAULT_BASE_CURRENCY


def base_currency(cur) -> str:
    """The instance's base currency (v2.19): the unit every *Cents column is in.

    The app settles it in "InstanceConfig" at its first boot and the stored
    value wins over any variable, so it is read from there - cached once
    found, since it never changes afterwards. Until the app has booted once
    (a fresh install whose sync service started first) there is no row:
    BASE_CURRENCY, else EUR, and nothing is cached so the stored value is
    picked up as soon as it exists.
    """
    global _settled_base
    if _settled_base is not None:
        return _settled_base
    row = None
    if cur is not None:
        # A savepoint, not a rollback: this runs in the middle of a sync's
        # transaction, and a missing table must not undo what it wrote.
        cur.execute("SAVEPOINT fx_base_currency")
        try:
            cur.execute('SELECT "baseCurrency" FROM "InstanceConfig" WHERE id = %s', ("singleton",))
            row = cur.fetchone()
            cur.execute("RELEASE SAVEPOINT fx_base_currency")
        except Exception:  # a database not migrated to v2.19 yet: no table
            log.warning("InstanceConfig unreadable; using BASE_CURRENCY or EUR", exc_info=True)
            cur.execute("ROLLBACK TO SAVEPOINT fx_base_currency")
    if row:
        _settled_base = parse_base_currency(_stored(row, "baseCurrency", 0))
        return _settled_base
    return parse_base_currency(os.environ.get("BASE_CURRENCY"))


def is_base(cur, currency: str | None) -> bool:
    return currency in (None, "") or currency == base_currency(cur)


def parse_currency(raw) -> str | None:
    """A bank's currency field as an ISO code, or None when it says nothing
    usable - which must mean "unknown", never "EUR": a module that omits the
    field on one run would otherwise flip a USD account back to euros."""
    code = str(raw or "").strip().upper()
    return code if len(code) == 3 and code.isalpha() else None


def to_base_cents(native_cents: int, rate: float) -> int:
    """Native cents to base cents. Half away from zero, like decimal.js's
    round() in lib/domain/currency.ts, so both sides convert identically."""
    return int((Decimal(native_cents) * Decimal(str(rate))).to_integral_value(rounding=ROUND_HALF_UP))


def pick_rate(rows: dict[datetime.date, float], day: datetime.date) -> float | None:
    """That day's rate, else the latest earlier one within a week."""
    best = None
    for row_day, rate in rows.items():
        if row_day > day or (day - row_day).days > LOOKBACK_DAYS:
            continue
        if best is None or row_day > best[0]:
            best = (row_day, rate)
    return best[1] if best else None


def parse_yahoo_daily_rates(payload) -> dict[datetime.date, float]:
    """EUR per 1 unit out of a Yahoo chart answer for EUR{XXX}=X, which quotes
    "XXX per 1 EUR". Empty or non-positive closes are dropped."""
    try:
        result = payload["chart"]["result"][0]
        stamps = result.get("timestamp") or []
        closes = result["indicators"]["quote"][0].get("close") or []
    except (KeyError, IndexError, TypeError):
        return {}
    rates = {}
    for stamp, close in zip(stamps, closes):
        if not isinstance(close, (int, float)) or close <= 0:
            continue
        day = datetime.datetime.fromtimestamp(stamp, tz=datetime.UTC).date()
        rates[day] = 1 / close
    return rates


def _fetch_daily_rates(base: str, currency: str, start: datetime.date, end: datetime.date) -> dict[datetime.date, float]:
    def epoch(day):
        return int(datetime.datetime.combine(day, datetime.time(), tzinfo=datetime.UTC).timestamp())

    # requests rather than urllib: urllib also opens file:// URLs, and this
    # URL carries a bank-reported value. The host and path are fixed here;
    # the currency only ever reaches the path as three letters (parse_currency).
    if not (len(currency) == 3 and currency.isalpha()):
        return {}
    try:
        response = requests.get(
            f"https://query2.finance.yahoo.com/v8/finance/chart/{base}{currency.upper()}=X",
            params={"interval": "1d", "period1": epoch(start), "period2": epoch(end)},
            headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"},
            timeout=FETCH_TIMEOUT_S,
        )
        response.raise_for_status()
        return parse_yahoo_daily_rates(response.json())
    except Exception:  # any failure means "no rate", which callers handle
        log.warning("exchange rate fetch failed for %s", currency, exc_info=True)
        return {}


def _cached_rates(cur, base: str, currency: str, start: datetime.date, end: datetime.date) -> dict[datetime.date, float]:
    cur.execute(
        'SELECT day, rate FROM "ExchangeRate" WHERE base = %s AND currency = %s AND day BETWEEN %s AND %s',
        (base, currency, start, end),
    )
    return {_stored(row, "day", 0): float(_stored(row, "rate", 1)) for row in cur.fetchall()}


def _rows_to_store(cached, fetched, result) -> dict[datetime.date, float]:
    """What a fetch adds to the table: the closes it brought, plus each asked
    day that had none (a weekend) under the rate it was given."""
    to_store = {day: rate for day, rate in fetched.items() if day not in cached}
    for day, rate in result.items():
        if rate is not None and day not in cached and day not in fetched:
            to_store[day] = rate
    return to_store


def rates_for_days(cur, currency: str, days) -> dict[datetime.date, float | None]:
    """Base currency per 1 unit of `currency` for each day in `days`."""
    wanted = sorted(set(days))
    if is_base(cur, currency):
        return {day: 1.0 for day in wanted}
    if not wanted:
        return {}

    base = base_currency(cur)
    start = wanted[0] - datetime.timedelta(days=LOOKBACK_DAYS)
    cached = _cached_rates(cur, base, currency, start, wanted[-1])
    if all(day in cached for day in wanted):
        return {day: pick_rate(cached, day) for day in wanted}

    fetched = _fetch_daily_rates(base, currency, start, wanted[-1] + datetime.timedelta(days=1))
    known = {**cached, **fetched}
    result = {day: pick_rate(known, day) for day in wanted}
    for day, rate in _rows_to_store(cached, fetched, result).items():
        cur.execute(
            'INSERT INTO "ExchangeRate" (base, currency, day, rate) VALUES (%s, %s, %s, %s)'
            " ON CONFLICT DO NOTHING",
            (base, currency, day, rate),
        )
    return result


def rate_for_day(cur, currency: str, day: datetime.date) -> float | None:
    return rates_for_days(cur, currency, [day]).get(day)


def _stored(row, key, index):
    # RealDictCursor rows are keyed by name, plain cursors by position.
    return row[key] if isinstance(row, dict) else row[index]
