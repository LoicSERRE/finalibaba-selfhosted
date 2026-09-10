"""Telling a portfolio movement apart from household spending.

A broker's cash account is a CHECKING account - money sits there and a card
spends it - so every debit on it counted as spending. Measured on a real
instance: one month showed 8 EUR of spending on the actual bank account
against -3 233 EUR on the brokerage account, almost all of it two share
purchases, which made "reste à vivre" describe nothing. Across its whole
history, 323 of the rows the app asked the user to categorise were orders.

The account cannot simply be excluded: the same one carries 293 rows of real
card spending (supermarkets, restaurants), so the line has to be drawn per
transaction.
"""

from sync_tr import is_securities_movement


def test_recognises_a_trade_from_trade_republics_own_event_type():
    assert is_securities_movement({"eventType": "TRADE_INVOICE"}, "Ferrari - Kauforder")
    assert is_securities_movement({"eventType": "SAVINGS_PLAN_EXECUTED"}, "whatever")


def test_recognises_a_trade_from_its_label_when_no_event_type_is_present():
    """The only signal rows already stored carry - eventType was never
    captured for them, and a re-sync will not revisit a syncId it knows."""
    for label in (
        "Ferrari - Kauforder",
        "Air Liquide - Verkaufsorder",
        "Bitcoin - Sparplan ausgeführt",
        "Bitcoin - Saveback",
        "MSCI World Swap PEA EUR (Acc) - PEA",
    ):
        assert is_securities_movement({}, label), label


def test_real_card_spending_on_the_same_account_is_not_a_securities_movement():
    """Every one of these is a real row from the brokerage account of a live
    instance. Misclassifying them would hide genuine spending."""
    for label in (
        "Amazon",
        "Burger King",
        "Welbee's Supermarket",
        "Marrobbio Restaurant",
        "The Pub Knokke-Heist",
        "Google One",
    ):
        assert not is_securities_movement({}, label), label


def test_transfers_are_not_securities_movements():
    """They have their own mechanism - see internal-transfer detection."""
    assert not is_securities_movement({}, "M LOIC SERRE - Fertig")
    assert not is_securities_movement({"eventType": "ACCOUNT_TRANSFER_INCOMING"}, "M LOIC SERRE - Fertig")


def test_dividends_and_interest_stay_in_the_budget():
    """Deliberate: they are real income the user may want counted, and are
    separately recordable as an IncomeEvent."""
    assert not is_securities_movement({"eventType": "INTEREST_PAYOUT"}, "Zinsen")
    assert not is_securities_movement({}, "Apple - Bardividende")


def test_an_unknown_event_type_falls_back_to_the_label():
    """TR has already changed its vocabulary under this project once, so an
    unrecognised event type must not silently disable the classification."""
    assert is_securities_movement({"eventType": "SOMETHING_NEW"}, "Ferrari - Kauforder")
    assert not is_securities_movement({"eventType": "SOMETHING_NEW"}, "Burger King")
