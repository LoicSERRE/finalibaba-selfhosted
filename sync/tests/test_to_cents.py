"""Rounding, not truncation, on every figure the sync stores.

`int(Decimal(...) * 100)` truncates, and always downward, so the error never
averages out. It bites hardest on a per-unit price, because the quantity then
multiplies it: a 0.78-cent loss on one share is 3.90 EUR across 500 of them,
and sync_woob.py wrote every one of its figures that way while sync_tr.py
documented the opposite rule in its own comments.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from decimal import Decimal

from db import to_cents


def test_a_per_unit_price_is_rounded_not_truncated():
    # The reported case: 500 shares at 134.5678 EUR.
    price_cents = to_cents("134.5678")
    assert price_cents == 13457  # int() gives 13456, losing 0.78 cents a share

    assert 500 * price_cents == 6_728_500
    assert 500 * int(Decimal("134.5678") * 100) == 6_728_000  # what it used to record


def test_it_rounds_half_to_even_like_the_display_layer():
    # Decimal's default, and what the TypeScript side's own Decimal.round()
    # does - so a stored figure and the one on screen agree rather than
    # drifting by a cent.
    assert to_cents("0.005") == 0
    assert to_cents("0.015") == 2
    assert to_cents("1.005") == 100


def test_it_takes_a_decimal_as_readily_as_a_string():
    # The cost basis arrives already multiplied out.
    assert to_cents(Decimal("12.3456") * Decimal(3)) == 3704


def test_a_negative_amount_rounds_by_magnitude_not_toward_zero():
    # A debit must not quietly become smaller than it was.
    assert to_cents("-12.345") == -1234  # half-to-even, not -1235 and not -1234.5
    assert to_cents("-12.346") == -1235
