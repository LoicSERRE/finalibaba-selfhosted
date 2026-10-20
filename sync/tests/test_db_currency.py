"""Synced accounts in another currency (v2.18), against a real PostgreSQL.

What these pin is only visible in real rows: which columns record_balance and
upsert_transaction write, that the dedup window compares native amounts, and
that resolve_account_currency re-denominates a history stored as EUR before
v2.18. Every rate comes from the ExchangeRate table the test seeds, so
nothing here reaches Yahoo. Skipped when no database is reachable, and every
write is rolled back.
"""

import datetime
import os
import uuid

import pytest

psycopg2 = pytest.importorskip("psycopg2")
pytest.importorskip("psycopg2.extras")

import fx
from db import (
    record_balance,
    resolve_account_currency,
    upsert_account,
    upsert_transaction,
)

TODAY = datetime.datetime.now(datetime.UTC).date()
D1 = datetime.date(2026, 3, 5)
D2 = datetime.date(2026, 3, 6)


@pytest.fixture
def cur():
    url = os.environ.get("DATABASE_URL")
    if not url:
        pytest.skip("DATABASE_URL not set")
    try:
        conn = psycopg2.connect(url)
    except psycopg2.Error as e:  # pragma: no cover - environment dependent
        pytest.skip(f"database not reachable: {e}")
    try:
        cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        yield cursor
        cursor.close()
    finally:
        conn.rollback()
        conn.close()


@pytest.fixture(autouse=True)
def _fresh_base(monkeypatch):
    monkeypatch.setattr(fx, "_settled_base", None)
    monkeypatch.delenv("BASE_CURRENCY", raising=False)


@pytest.fixture
def account(cur, monkeypatch):
    monkeypatch.setattr(fx, "_fetch_daily_rates", lambda *a: pytest.fail("Yahoo was asked"))
    for day, rate in ((D1, 0.8), (D2, 0.9), (TODAY, 0.85)):
        cur.execute(
            'INSERT INTO "ExchangeRate" (base, currency, day, rate) VALUES (%s, %s, %s, %s) ON CONFLICT DO NOTHING',
            ("EUR", "USD", day, rate),
        )
    institution_id = f"test-inst-{uuid.uuid4().hex[:8]}"
    cur.execute(
        'INSERT INTO "Institution" (id, name, "createdAt") VALUES (%s, %s, NOW())',
        (institution_id, f"Wise {institution_id}"),
    )
    return upsert_account(
        cur, sync_id=f"woob:{institution_id}:usd1", name="USD", account_type="CHECKING", institution_id=institution_id
    )


def _balances(cur, account_id):
    cur.execute(
        'SELECT "balanceCents", "nativeBalanceCents", "fxRate" FROM "HistoricalBalance"'
        ' WHERE "accountId" = %s ORDER BY "recordedAt", id',
        (account_id,),
    )
    return [(int(r["balanceCents"]), r["nativeBalanceCents"] and int(r["nativeBalanceCents"]), r["fxRate"]) for r in cur.fetchall()]


def test_a_new_account_takes_the_currency_the_bank_reports(cur, account):
    assert resolve_account_currency(cur, account, "USD") == "USD"
    cur.execute('SELECT currency FROM "Account" WHERE id = %s', (account,))
    assert cur.fetchone()["currency"] == "USD"


def test_an_unknown_currency_keeps_the_accounts_own(cur, account):
    assert resolve_account_currency(cur, account, "USD") == "USD"
    assert resolve_account_currency(cur, account, None) == "USD"


def test_a_change_between_two_foreign_currencies_is_refused(cur, account):
    resolve_account_currency(cur, account, "USD")
    assert resolve_account_currency(cur, account, "GBP") is None


def test_the_balance_is_stored_in_euros_with_the_dollars_beside_it(cur, account):
    record_balance(cur, account, 100_00, currency="USD", rate=0.85)
    assert _balances(cur, account) == [(85_00, 100_00, 0.85)]


def test_unchanged_dollars_write_nothing_more_the_same_day(cur, account):
    # The rate has not moved today (rates are daily), so a second sync of the
    # same balance is the same row - not one per 4h run.
    record_balance(cur, account, 100_00, currency="USD", rate=0.85)
    record_balance(cur, account, 100_00, currency="USD", rate=0.85)
    assert len(_balances(cur, account)) == 1


def test_an_eur_account_behaves_as_before(cur, account):
    record_balance(cur, account, 100_00)
    record_balance(cur, account, 100_00)
    assert _balances(cur, account) == [(100_00, None, None)]


def test_a_transaction_is_stored_in_euros_and_dedups_on_dollars(cur, account):
    kwargs = {"account_id": account, "date": D1, "label": "Coffee", "amount_cents": -5_00, "currency": "USD"}
    upsert_transaction(cur, sync_id="woob:x:t1", rate=0.8, **kwargs)
    # The same movement under a different id, on a day the rate moved: the
    # window compares the dollars, so it is recognised and not stored twice.
    upsert_transaction(cur, sync_id="woob:x:t2", rate=0.9, **{**kwargs, "date": D2})

    cur.execute('SELECT "amountCents", "nativeAmountCents", "fxRate" FROM "Transaction" WHERE "accountId" = %s', (account,))
    rows = cur.fetchall()
    assert [(int(r["amountCents"]), int(r["nativeAmountCents"]), r["fxRate"]) for r in rows] == [(-4_00, -5_00, 0.8)]


def test_a_history_stored_as_euros_is_re_denominated_at_each_days_rate(cur, account):
    # Before v2.18 a dollar account's figures were written as if euros.
    cur.execute(
        'INSERT INTO "HistoricalBalance" (id, "accountId", "balanceCents", "recordedAt") VALUES (%s, %s, %s, %s), (%s, %s, %s, %s)',
        (str(uuid.uuid4()), account, 100_00, datetime.datetime(2026, 3, 5, 9, tzinfo=datetime.UTC), str(uuid.uuid4()), account, 200_00, datetime.datetime(2026, 3, 6, 9, tzinfo=datetime.UTC)),
    )
    upsert_transaction(cur, account_id=account, sync_id="woob:x:old", date=D1, label="Old", amount_cents=-10_00)

    assert resolve_account_currency(cur, account, "USD") == "USD"

    assert _balances(cur, account) == [(80_00, 100_00, 0.8), (180_00, 200_00, 0.9)]
    cur.execute('SELECT "amountCents", "nativeAmountCents" FROM "Transaction" WHERE "syncId" = %s', ("woob:x:old",))
    row = cur.fetchone()
    assert (int(row["amountCents"]), int(row["nativeAmountCents"])) == (-8_00, -10_00)


def test_no_switch_while_any_of_the_history_cannot_be_priced(cur, account, monkeypatch):
    monkeypatch.setattr(fx, "_fetch_daily_rates", lambda *a: {})  # Yahoo has nothing for 2020 either
    cur.execute(
        'INSERT INTO "HistoricalBalance" (id, "accountId", "balanceCents", "recordedAt") VALUES (%s, %s, %s, %s)',
        (str(uuid.uuid4()), account, 100_00, datetime.datetime(2020, 1, 1, 9, tzinfo=datetime.UTC)),
    )
    assert resolve_account_currency(cur, account, "USD") is None
    cur.execute('SELECT currency FROM "Account" WHERE id = %s', (account,))
    assert cur.fetchone()["currency"] == "EUR"
    assert _balances(cur, account) == [(100_00, None, None)]


def test_on_a_usd_instance_accounts_are_born_in_usd_and_eur_is_the_foreign_one(cur, monkeypatch):
    # v2.19: the base is the instance's, settled in InstanceConfig.
    monkeypatch.setattr(fx, "_fetch_daily_rates", lambda *a: pytest.fail("Yahoo was asked"))
    cur.execute('INSERT INTO "InstanceConfig" (id, "baseCurrency") VALUES (%s, %s) ON CONFLICT (id) DO UPDATE SET "baseCurrency" = EXCLUDED."baseCurrency"', ("singleton", "USD"))
    cur.execute('INSERT INTO "ExchangeRate" (base, currency, day, rate) VALUES (%s, %s, %s, %s) ON CONFLICT DO NOTHING', ("USD", "EUR", TODAY, 1.12))
    institution_id = f"test-inst-{uuid.uuid4().hex[:8]}"
    cur.execute('INSERT INTO "Institution" (id, name, "createdAt") VALUES (%s, %s, NOW())', (institution_id, f"Chase {institution_id}"))
    usd = upsert_account(cur, sync_id=f"woob:{institution_id}:a", name="Checking", account_type="CHECKING", institution_id=institution_id)
    cur.execute('SELECT currency FROM "Account" WHERE id = %s', (usd,))
    assert cur.fetchone()["currency"] == "USD"
    assert resolve_account_currency(cur, usd, "USD") == "USD"
    record_balance(cur, usd, 500_00, currency="USD")
    assert _balances(cur, usd) == [(500_00, None, None)]

    eur = upsert_account(cur, sync_id=f"woob:{institution_id}:b", name="Euro account", account_type="CHECKING", institution_id=institution_id)
    assert resolve_account_currency(cur, eur, "EUR") == "EUR"
    record_balance(cur, eur, 100_00, currency="EUR", rate=fx.rate_for_day(cur, "EUR", TODAY))
    assert _balances(cur, eur) == [(112_00, 100_00, 1.12)]
