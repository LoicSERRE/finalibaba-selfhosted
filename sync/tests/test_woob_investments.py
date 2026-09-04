"""Turning a bank's reported fund lines into holdings.

72 of the 96 CapBank modules expose CapBankWealth, and this project asked none
of them for their positions - it stored a bare balance instead. That is how a
PEE arrived typed as a current account offering an "annual interest rate", a
field that means nothing for a fund (reported from a real Amundi connection).

What is asserted here is the mapping, because it is where a value can be
silently wrong rather than merely missing.
"""

from decimal import Decimal

from woob.capabilities.base import NotAvailable

import sync_woob


class Inv:
    """A Woob Investment, narrowed to the fields the mapping reads.

    Absent fields default to NotAvailable, NOT None, because that is what Woob
    actually does - and the difference is what made every real position get
    dropped: NotAvailable is not None, and str() of it is "Not available", so a
    None check passes and Decimal() then dies.
    """

    def __init__(self, label=NotAvailable, code=NotAvailable, quantity=NotAvailable,
                 unitvalue=NotAvailable, valuation=NotAvailable, unitprice=NotAvailable):
        self.label = label
        self.code = code
        self.quantity = quantity
        self.unitvalue = unitvalue
        self.valuation = valuation
        self.unitprice = unitprice


def test_a_normal_line_maps_to_a_holding():
    h = sync_woob._investment_to_holding(
        Inv(label="Amundi Actions Monde", code="FR0010153320", quantity=12.5, unitvalue=28.40, valuation=355.0)
    )
    assert h["ticker"] == "FR0010153320", "the ISIN is the stable identity"
    assert h["name"] == "Amundi Actions Monde"
    assert h["quantity"] == Decimal("12.5")
    assert h["last_price_cents"] == 2840


def test_the_label_is_the_fallback_identity_when_there_is_no_isin():
    h = sync_woob._investment_to_holding(Inv(label="FCPE Maison", quantity=3, unitvalue=10, valuation=30))
    assert h["ticker"] == "FCPE Maison"


# Funds routinely report a valuation and no share count. Dropping the line would
# understate the account; storing one unit priced at the valuation keeps the
# account total exact, which is the number that matters.
def test_a_line_without_a_quantity_keeps_the_account_total_exact():
    h = sync_woob._investment_to_holding(Inv(label="Fonds euro", code="X", valuation=1234.56))
    assert h["quantity"] == Decimal(1)
    assert h["last_price_cents"] == 123456


def test_a_cost_basis_is_derived_only_when_the_bank_gives_a_purchase_price():
    priced = sync_woob._investment_to_holding(Inv(label="A", code="A", quantity=10, unitvalue=20, unitprice=15))
    assert priced["cost_basis_cents"] == 15000

    unpriced = sync_woob._investment_to_holding(Inv(label="B", code="B", quantity=10, unitvalue=20))
    assert unpriced["cost_basis_cents"] is None, "never invent an acquisition cost"


def test_an_unvaluable_line_is_dropped_rather_than_stored_as_zero():
    """A zero-valued holding would quietly drag the account's total down - the
    same 'absent rendered as a legitimate zero' trap this codebase has hit
    before."""
    assert sync_woob._investment_to_holding(Inv(label="Inconnu", code="Z")) is None


def test_a_line_with_no_identity_at_all_is_dropped():
    assert sync_woob._investment_to_holding(Inv(valuation=100)) is None


def test_a_not_available_purchase_price_does_not_kill_the_line():
    """The real Amundi failure, in one assertion. unitprice came back as
    NotAvailable, `is not None` passed, and Decimal("Not available") raised
    ConversionSyntax - so a PEE whose positions Woob had returned correctly
    ended up with no holdings at all and stayed typed as a current account."""
    h = sync_woob._investment_to_holding(
        Inv(label="Amundi Label", code="FR001", quantity=10, unitvalue=20, unitprice=NotAvailable)
    )
    assert h is not None, "a missing purchase price must not drop the position"
    assert h["cost_basis_cents"] is None
    assert h["last_price_cents"] == 2000


def test_not_available_everywhere_optional_is_tolerated():
    h = sync_woob._investment_to_holding(
        Inv(label="Fonds", code=NotAvailable, quantity=NotAvailable, unitvalue=NotAvailable, valuation=500)
    )
    assert h["ticker"] == "Fonds", "falls back to the label when the ISIN is absent"
    assert h["quantity"] == Decimal(1)
    assert h["last_price_cents"] == 50000
