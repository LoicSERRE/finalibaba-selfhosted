"""Synthesised transaction ids for banks that supply none of their own.

The defect these pin was measured on a real production database, not
imagined: LCL through Woob returns no transaction id, so the id was built
from date + amount alone. Two transfers of the same amount on the same day
therefore produced the SAME id, and the second was refused as a duplicate it
never was. The account whose bank DOES supply ids held 142 same-day/same-
amount pairs over the same period; the id-less account held zero across its
entire history.

The consequence reached the user as something else entirely: the discarded
leg left its counterpart on the other account permanently unmatchable, so
internal transfers were counted as income.
"""

import datetime

from db import composite_sync_id, legacy_composite_sync_id

BASE = "woob:inst123:0183509"
DAY = datetime.date(2026, 4, 23)


def test_same_day_same_amount_different_labels_get_different_ids():
    """The exact real case: two 300 EUR transfers the same day, one to a
    livret and one to a broker. They read differently on the statement, and
    that is the only thing telling them apart."""
    a = composite_sync_id(BASE, DAY, -30000, "VIREMENT INSTANTANE", 1)
    b = composite_sync_id(BASE, DAY, -30000, "VIR INST Compte Trade Republic", 1)
    assert a != b


def test_identical_rows_are_separated_by_their_occurrence_number():
    """Same date, same amount, same label - nothing distinguishes them, so
    the position within the sync pass does."""
    first = composite_sync_id(BASE, DAY, -450, "CB BOULANGERIE", 1)
    second = composite_sync_id(BASE, DAY, -450, "CB BOULANGERIE", 2)
    assert first != second
    assert second.endswith(":2")


def test_id_is_stable_across_runs():
    """Recomputed from the same transaction, the id must not move - otherwise
    every sync re-inserts the entire history."""
    once = composite_sync_id(BASE, DAY, -30000, "VIREMENT INSTANTANE", 1)
    twice = composite_sync_id(BASE, DAY, -30000, "VIREMENT INSTANTANE", 1)
    assert once == twice


def test_label_fingerprint_ignores_case_and_spacing():
    """A bank that restates 'VIR  SEPA' as 'Vir Sepa' must not thereby mint a
    second id for a transaction already stored."""
    a = composite_sync_id(BASE, DAY, -30000, "VIR  SEPA   M LOIC", 1)
    b = composite_sync_id(BASE, DAY, -30000, "vir sepa m loic", 1)
    assert a == b


def test_new_id_differs_from_the_legacy_one_for_the_same_transaction():
    """Deliberate, and why upsert_transaction() looks the legacy id up
    separately: leaving the first occurrence bare so it kept matching would
    make the ids order-dependent, and a reordering would duplicate both rows."""
    legacy = legacy_composite_sync_id(BASE, DAY, -30000)
    current = composite_sync_id(BASE, DAY, -30000, "VIREMENT INSTANTANE", 1)
    assert legacy != current
    assert current.startswith(legacy)


def test_legacy_id_keeps_the_documented_shape():
    """Already-stored rows carry exactly this. If it ever changes, every LCL
    row in every existing install stops being recognised."""
    assert legacy_composite_sync_id(BASE, DAY, -30000) == f"{BASE}:2026-04-23:-30000"
