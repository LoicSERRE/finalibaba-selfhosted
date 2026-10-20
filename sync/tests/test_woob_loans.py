"""Loans as Woob reports them (v2.19.1).

A student loan synced from LCL came through as a checking account at
-5 099 €, sitting in the user's cash: the type was guessed from the label
("PRÊT PERSONNEL ETUDES" matches no keyword) while Woob had said "Loan" all
along. The DB-backed part replays exactly that: an account first stored as
CHECKING with negative balances, then synced again under v2.19.1.
"""

import datetime
import enum
import os
import uuid
from decimal import Decimal

import pytest

import fx
import woob_loans


class _NotAvailable:
    """Woob's sentinel for a field the module could not fill: falsy, not None."""

    def __bool__(self):
        return False


NA = _NotAvailable()


class AccountType(enum.Enum):
    CHECKING = 1
    LOAN = 4
    CONSUMER_CREDIT = 18


class Account:
    def __init__(self, **fields):
        self.__dict__.update({"type": AccountType.CHECKING, "currency": "EUR", **fields})


class Loan(Account):
    pass


def test_a_woob_loan_is_a_loan_whatever_its_label():
    assert woob_loans.is_loan(Loan(label="PRÊT PERSONNEL ETUDES", type=AccountType.LOAN))
    # Classified by type even when the module returns a plain Account.
    assert woob_loans.is_loan(Account(label="Mon crédit conso", type=AccountType.CONSUMER_CREDIT))
    # A bank name in a label proves nothing.
    assert not woob_loans.is_loan(Account(label="COMPTE CREDIT MUTUEL", type=AccountType.CHECKING))


def test_loan_facts_reads_what_the_bank_gives_and_skips_what_it_does_not():
    loan = Loan(
        type=AccountType.LOAN,
        total_amount=Decimal("5000.00"),
        rate=Decimal("0.99"),
        next_payment_amount=Decimal("87.43"),
        next_payment_date=datetime.date(2026, 11, 5),
        maturity_date=NA,
    )
    assert woob_loans.loan_facts(loan) == {
        "borrowed_cents": 500_000,
        "rate_pct": 0.99,
        "next_payment_cents": 8_743,
        "next_payment_date": datetime.date(2026, 11, 5),
        "end_date": None,
    }
    assert woob_loans.loan_facts(Account(label="Courant")) is None


# ── Against PostgreSQL ────────────────────────────────────────────────────

psycopg2 = pytest.importorskip("psycopg2")
pytest.importorskip("psycopg2.extras")


@pytest.fixture
def cur(monkeypatch):
    url = os.environ.get("DATABASE_URL")
    if not url:
        pytest.skip("DATABASE_URL not set")
    try:
        conn = psycopg2.connect(url)
    except psycopg2.Error as e:  # pragma: no cover - environment dependent
        pytest.skip(f"database not reachable: {e}")
    monkeypatch.setattr(fx, "_settled_base", None)
    monkeypatch.delenv("BASE_CURRENCY", raising=False)
    try:
        cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        yield cursor
        cursor.close()
    finally:
        conn.rollback()
        conn.close()


def _account(cur, account_id):
    cur.execute(
        'SELECT type, "liabilityCents", "loanAmountCents", "loanTaeg", "loanNextPaymentCents", "loanEndDate" FROM "Account" WHERE id = %s',
        (account_id,),
    )
    return cur.fetchone()


def test_a_loan_synced_as_checking_is_retyped_and_its_debt_recorded(cur):
    import sync_woob

    institution_id = f"test-inst-{uuid.uuid4().hex[:8]}"
    cur.execute('INSERT INTO "Institution" (id, name, "createdAt") VALUES (%s, %s, NOW())', (institution_id, "LCL test"))
    # Before v2.19.1: stored as a checking account, balance as LCL reports it.
    first = sync_woob._sync_account(
        cur, institution_id, "LCL", Account(id="pret1", label="PRÊT PERSONNEL ETUDES", balance=Decimal("-5099.00"))
    )
    assert _account(cur, first["account_db_id"])["type"] == "CHECKING"

    loan = Loan(
        id="pret1",
        label="PRÊT PERSONNEL ETUDES",
        type=AccountType.LOAN,
        balance=Decimal("-5099.00"),
        total_amount=Decimal("5000.00"),
        rate=Decimal("0.99"),
        next_payment_amount=NA,
        next_payment_date=NA,
        maturity_date=datetime.date(2033, 9, 30),
    )
    second = sync_woob._sync_account(cur, institution_id, "LCL", loan)

    assert second["account_db_id"] == first["account_db_id"]
    row = _account(cur, second["account_db_id"])
    assert row["type"] == "LOAN"
    assert int(row["liabilityCents"]) == 509_900
    assert int(row["loanAmountCents"]) == 500_000
    assert row["loanTaeg"] == pytest.approx(0.99)
    assert row["loanNextPaymentCents"] is None
    assert row["loanEndDate"].date() == datetime.date(2033, 9, 30)
    # Its balance rows stay what was owed: negative.
    cur.execute('SELECT "balanceCents" FROM "HistoricalBalance" WHERE "accountId" = %s', (second["account_db_id"],))
    assert {int(r["balanceCents"]) for r in cur.fetchall()} == {-509_900}


def test_a_new_loan_is_created_as_one_and_a_positive_balance_still_means_owed(cur):
    import sync_woob

    institution_id = f"test-inst-{uuid.uuid4().hex[:8]}"
    cur.execute('INSERT INTO "Institution" (id, name, "createdAt") VALUES (%s, %s, NOW())', (institution_id, "Bank test"))
    loan = Loan(id="immo", label="Prêt immobilier", type=AccountType.LOAN, balance=Decimal("120000.00"), total_amount=NA, rate=NA,
                next_payment_amount=NA, next_payment_date=NA, maturity_date=NA)
    summary = sync_woob._sync_account(cur, institution_id, "Bank", loan)
    row = _account(cur, summary["account_db_id"])
    assert row["type"] == "LOAN"
    assert int(row["liabilityCents"]) == 12_000_000
    cur.execute('SELECT "balanceCents" FROM "HistoricalBalance" WHERE "accountId" = %s', (summary["account_db_id"],))
    assert int(cur.fetchone()["balanceCents"]) == -12_000_000


def test_a_non_loan_account_is_never_retyped(cur):
    import sync_woob

    institution_id = f"test-inst-{uuid.uuid4().hex[:8]}"
    cur.execute('INSERT INTO "Institution" (id, name, "createdAt") VALUES (%s, %s, NOW())', (institution_id, "Bank test"))
    overdrawn = Account(id="cc", label="COMPTE CREDIT MUTUEL", balance=Decimal("-120.00"))
    summary = sync_woob._sync_account(cur, institution_id, "Bank", overdrawn)
    assert _account(cur, summary["account_db_id"])["type"] == "CHECKING"


def test_terms_the_user_set_survive_the_next_sync_and_live_figures_do_not(cur):
    # v2.19.2: the bank fills the contract's terms only while they are empty;
    # what is owed and the next instalment are always the bank's.
    import sync_woob

    institution_id = f"test-inst-{uuid.uuid4().hex[:8]}"
    cur.execute('INSERT INTO "Institution" (id, name, "createdAt") VALUES (%s, %s, NOW())', (institution_id, "LCL test"))

    def loan(balance, rate, next_payment):
        return Loan(id="pret1", label="PRÊT", type=AccountType.LOAN, balance=Decimal(balance), total_amount=Decimal(5000),
                    rate=Decimal(rate), next_payment_amount=Decimal(next_payment), next_payment_date=NA,
                    maturity_date=datetime.date(2032, 10, 31))

    summary = sync_woob._sync_account(cur, institution_id, "LCL", loan("-5099", "0.99", "4.13"))
    account_id = summary["account_db_id"]
    # The user corrects the rate and the end date, and completes a duration.
    cur.execute(
        'UPDATE "Account" SET "loanTaeg" = 1.2, "loanEndDate" = %s, "loanDurationMonths" = 72 WHERE id = %s',
        (datetime.date(2032, 9, 30), account_id),
    )
    sync_woob._sync_account(cur, institution_id, "LCL", loan("-5100", "0.99", "4.20"))

    row = _account(cur, account_id)
    assert row["loanTaeg"] == pytest.approx(1.2)
    assert row["loanEndDate"].date() == datetime.date(2032, 9, 30)
    assert int(row["liabilityCents"]) == 510_000
    assert int(row["loanNextPaymentCents"]) == 420
    cur.execute('SELECT "loanDurationMonths" FROM "Account" WHERE id = %s', (account_id,))
    assert cur.fetchone()["loanDurationMonths"] == 72
