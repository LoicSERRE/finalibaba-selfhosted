"""Daily exchange rates for accounts a bank keeps in another currency (v2.18).

sync/fx.py mirrors lib/services/exchange-rate.ts and lib/domain/currency.ts:
the vectors in test_to_base_cents_matches_the_app are the ones
__tests__/currency.test.ts asserts on the TypeScript side, so a conversion
written by the sync service and one written by the app agree to the cent.
"""

import datetime

import pytest

import fx

D = datetime.date


def test_to_base_cents_matches_the_app():
    # Same vectors as __tests__/currency.test.ts ("rounds to the cent").
    assert fx.to_base_cents(10_000, 0.91234) == 9_123
    assert fx.to_base_cents(-10_000, 0.91236) == -9_124
    assert fx.to_base_cents(0, 0.9) == 0
    # Half away from zero, like decimal.js's round().
    assert fx.to_base_cents(1, 0.5) == 1
    assert fx.to_base_cents(-1, 0.5) == -1


def test_parse_currency_never_turns_unknown_into_euros():
    assert fx.parse_currency("usd") == "USD"
    assert fx.parse_currency(" CHF ") == "CHF"
    # Unknown is None, not EUR: a module that omits the field once must not
    # flip a dollar account back to euros.
    for raw in (None, "", "US", "DOLLAR", "12$"):
        assert fx.parse_currency(raw) is None


def test_pick_rate_carries_a_close_over_the_weekend_but_not_further():
    rows = {D(2026, 3, 5): 0.91, D(2026, 3, 6): 0.92}
    assert fx.pick_rate(rows, D(2026, 3, 5)) == 0.91
    assert fx.pick_rate(rows, D(2026, 3, 8)) == 0.92
    assert fx.pick_rate(rows, D(2026, 3, 4)) is None
    assert fx.pick_rate(rows, D(2026, 3, 14)) is None


def _stamp(day):
    return int(datetime.datetime(day.year, day.month, day.day, 22, tzinfo=datetime.UTC).timestamp())


def test_parse_yahoo_inverts_each_close():
    payload = {
        "chart": {
            "result": [
                {
                    "timestamp": [_stamp(D(2026, 3, 5)), _stamp(D(2026, 3, 6)), _stamp(D(2026, 3, 7))],
                    "indicators": {"quote": [{"close": [1.25, 1.0, None]}]},
                }
            ]
        }
    }
    assert fx.parse_yahoo_daily_rates(payload) == {D(2026, 3, 5): 0.8, D(2026, 3, 6): 1.0}
    assert fx.parse_yahoo_daily_rates(None) == {}
    assert fx.parse_yahoo_daily_rates({"chart": {"result": []}}) == {}


@pytest.fixture(autouse=True)
def _fresh_base(monkeypatch):
    # base_currency caches the stored value for the process: start each test clean.
    monkeypatch.setattr(fx, "_settled_base", None)
    monkeypatch.delenv("BASE_CURRENCY", raising=False)


class RateCursor:
    """The statements rates_for_days issues, against an in-memory table, on an
    instance whose InstanceConfig row says `base` (None: no row yet)."""

    def __init__(self, stored=None, base="EUR"):
        self.table = dict(stored or {})
        self.inserted = []
        self.base = base
        self._one = None

    def execute(self, sql, params=None):
        if "SAVEPOINT" in sql:
            return
        if "InstanceConfig" in sql:
            self._one = {"baseCurrency": self.base} if self.base else None
            return
        if sql.startswith("SELECT"):
            _base, _currency, start, end = params
            self._rows = [{"day": d, "rate": r} for d, r in self.table.items() if start <= d <= end]
        else:
            _base, _currency, day, rate = params
            self.inserted.append((day, rate))
            self.table.setdefault(day, rate)

    def fetchall(self):
        return self._rows

    def fetchone(self):
        return self._one


def test_rates_for_days_asks_nobody_for_euros():
    assert fx.rates_for_days(None, "EUR", [D(2026, 3, 5)]) == {D(2026, 3, 5): 1.0}


def test_rates_for_days_serves_the_cache_without_fetching(monkeypatch):
    monkeypatch.setattr(fx, "_fetch_daily_rates", lambda *a: (_ for _ in ()).throw(AssertionError("fetched")))
    cur = RateCursor({D(2026, 3, 5): 0.9})
    assert fx.rates_for_days(cur, "USD", [D(2026, 3, 5)]) == {D(2026, 3, 5): 0.9}


def test_rates_for_days_fetches_once_and_stores_the_weekend(monkeypatch):
    calls = []

    def fetch(base, currency, start, end):
        calls.append((base, currency, start, end))
        return {D(2026, 3, 5): 0.8, D(2026, 3, 6): 1.0}

    monkeypatch.setattr(fx, "_fetch_daily_rates", fetch)
    cur = RateCursor()
    rates = fx.rates_for_days(cur, "USD", [D(2026, 3, 7), D(2026, 3, 5)])

    assert len(calls) == 1
    assert rates == {D(2026, 3, 5): 0.8, D(2026, 3, 7): 1.0}
    assert sorted(cur.inserted) == [(D(2026, 3, 5), 0.8), (D(2026, 3, 6), 1.0), (D(2026, 3, 7), 1.0)]


def test_rates_for_days_reports_a_day_nobody_can_price(monkeypatch):
    monkeypatch.setattr(fx, "_fetch_daily_rates", lambda *a: {})
    cur = RateCursor()
    assert fx.rates_for_days(cur, "USD", [D(2026, 3, 5)]) == {D(2026, 3, 5): None}
    assert cur.inserted == []


def test_the_base_comes_from_instance_config_and_sticks():
    cur = RateCursor(base="USD")
    assert fx.base_currency(cur) == "USD"
    # Cached once found: it never changes afterwards.
    cur.base = "GBP"
    assert fx.base_currency(cur) == "USD"
    assert fx.is_base(cur, "USD") and not fx.is_base(cur, "EUR")


def test_before_the_app_settled_it_the_variable_then_eur(monkeypatch):
    cur = RateCursor(base=None)
    assert fx.base_currency(cur) == "EUR"
    monkeypatch.setenv("BASE_CURRENCY", "chf")
    assert fx.base_currency(cur) == "CHF"
    # Not cached: the stored value is picked up as soon as it exists.
    cur.base = "GBP"
    assert fx.base_currency(cur) == "GBP"


def test_an_unsupported_base_falls_back_to_eur(monkeypatch):
    monkeypatch.setenv("BASE_CURRENCY", "JPY")
    assert fx.base_currency(None) == "EUR"


def test_rates_into_another_base_ask_yahoo_for_that_pair(monkeypatch):
    calls = []
    monkeypatch.setattr(fx, "_fetch_daily_rates", lambda base, currency, s, e: calls.append((base, currency)) or {D(2026, 3, 5): 0.9})
    cur = RateCursor(base="USD")
    assert fx.rates_for_days(cur, "EUR", [D(2026, 3, 5)]) == {D(2026, 3, 5): 0.9}
    assert calls == [("USD", "EUR")]
    assert fx.rates_for_days(cur, "USD", [D(2026, 3, 5)]) == {D(2026, 3, 5): 1.0}
