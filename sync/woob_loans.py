"""What a Woob module says about a loan account (v2.19.1).

Banks report a loan through Woob as a `Loan` (a subclass of `Account`) with a
negative balance - what is still owed - and, when the bank gives them, the
amount borrowed, the rate, the next instalment and the end date. Until
v2.19.1 none of that was read: the account type was guessed from the label
alone, so "PRÊT PERSONNEL ETUDES" matched no keyword, became a checking
account, and its -5 099 € sat in the user's cash. The type is now taken
from Woob's own classification, never from the label - "Crédit Mutuel" or
"Crédit Agricole" in an account name says nothing about it being a loan.
"""

import datetime
from decimal import Decimal

# AccountType values Woob uses for money owed (woob/capabilities/bank/base.py):
# LOAN, MORTGAGE, CONSUMER_CREDIT, REVOLVING_CREDIT. Woob's Enum is its own,
# not the stdlib one - its members are plain ints with no `.name`, so the
# v2.19.1 check by name never matched, and a module returning a plain Account
# typed as a loan (cragr, #148) had its debt counted as cash.
LOAN_TYPE_VALUES = frozenset({4, 17, 18, 19})


def _present(value):
    """A Woob field's value, or None for NotAvailable/NotLoaded/None.

    Woob's sentinels are falsy objects that are neither None nor a number,
    so anything that is not a real scalar of the expected kinds is absent.
    """
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float, Decimal, str, datetime.date)):
        return value
    return None


def is_loan(account) -> bool:
    if type(account).__name__ == "Loan":
        return True
    kind = getattr(account, "type", None)
    return isinstance(kind, int) and not isinstance(kind, bool) and kind in LOAN_TYPE_VALUES


def _cents(amount) -> int | None:
    value = _present(amount)
    if value is None or isinstance(value, (str, bool)):
        return None
    return int((Decimal(str(value)) * 100).to_integral_value())


def _date(value) -> datetime.date | None:
    value = _present(value)
    if isinstance(value, datetime.datetime):
        return value.date()
    return value if isinstance(value, datetime.date) else None


def loan_facts(account) -> dict | None:
    """The bank's figures for a loan account, or None when it is not one.

    Amounts are positive cents in the account's own currency; anything the
    module does not fill is None (and left as it was in the database).
    """
    if not is_loan(account):
        return None
    rate = _present(getattr(account, "rate", None))
    return {
        "borrowed_cents": _cents(getattr(account, "total_amount", None)),
        "rate_pct": float(rate) if isinstance(rate, (int, float, Decimal)) and not isinstance(rate, bool) else None,
        "next_payment_cents": _cents(getattr(account, "next_payment_amount", None)),
        "next_payment_date": _date(getattr(account, "next_payment_date", None)),
        "end_date": _date(getattr(account, "maturity_date", None)),
    }
