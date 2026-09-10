"""Which stored row upsert_transaction() considers "already have this one".

These drive the real function against a fake cursor that records the queries
it is given and answers them from an in-memory set of stored rows, because
the defect being pinned is entirely about WHICH lookup matches - a mocked
"returns None" cursor cannot express it.

The case that matters is the second one. The pre-label id is label-blind by
construction, so both halves of a same-day/same-amount pair resolve to it.
Matching on that id alone meant the surviving row answered for its lost twin
as well, and the twin stayed suppressed on every future sync. Confirmed
against production after the first deployment: not one of ten known-missing
movements had come back.
"""

import datetime

from db import composite_sync_id, legacy_composite_sync_id, upsert_transaction

BASE = "woob:inst:0183"
DAY = datetime.date(2026, 4, 23)
ACCOUNT = "acc-db-id"


class FakeCursor:
    """Answers the SELECT shapes upsert_transaction uses, from `stored`.

    Each stored row is (sync_id, account_id, amount_cents, label, date).
    """

    def __init__(self, stored):
        self.stored = list(stored)
        self.inserted = []
        self.relabelled = []
        self._result = None
        self._rows = []

    def execute(self, sql, params):
        if sql.strip().startswith("INSERT"):
            self.inserted.append(params)
            self._result = None
        elif sql.strip().startswith("UPDATE"):
            new_label, row_id = params
            self.relabelled.append((row_id, new_label))
            self._result = None
        elif "syncId" in sql and "lower(btrim(label))" in sql:
            sync_id, label = params
            self._result = next(
                (r for r in self.stored if r[0] == sync_id and _norm(r[3]) == _norm(label)), None
            )
        elif "syncId" in sql:
            self._result = next((r for r in self.stored if r[0] == params[0]), None)
        else:  # the same-amount window
            account_id, amount, date, _ = params
            self._rows = [
                {"id": r[0], "label": r[3]}
                for r in self.stored
                if r[1] == account_id and r[2] == amount and abs((r[4] - date).days) <= 3
            ]

    def fetchone(self):
        return self._result

    def fetchall(self):
        return self._rows


def _norm(s):
    return " ".join(s.lower().split())


def _upsert(cur, label, *, amount=-30000, date=DAY, occurrence=1):
    upsert_transaction(
        cur,
        account_id=ACCOUNT,
        sync_id=composite_sync_id(BASE, date, amount, label, occurrence),
        date=date,
        label=label,
        amount_cents=amount,
        legacy_sync_id=legacy_composite_sync_id(BASE, date, amount),
        near_duplicate="label",
    )


def test_a_row_already_stored_under_its_legacy_id_is_not_re_inserted():
    """Otherwise the first sync after the id format changed would duplicate
    every LCL transaction an instance has ever stored."""
    stored = [(legacy_composite_sync_id(BASE, DAY, -30000), ACCOUNT, -30000, "VIREMENT INSTANTANE", DAY)]
    cur = FakeCursor(stored)

    _upsert(cur, "VIREMENT INSTANTANE")

    assert cur.inserted == []


def test_the_lost_twin_of_a_legacy_row_is_finally_inserted():
    """Same day, same amount, two DIFFERENT named counterparties - a
    genuinely distinct movement that the label-blind legacy lookup used to
    swallow. The real recovered case: a 500 EUR transfer to a livret and a
    500 EUR transfer to a broker on the same day."""
    stored = [(legacy_composite_sync_id(BASE, DAY, -30000), ACCOUNT, -30000, "VIR SEPA M LOIC SERRE", DAY)]
    cur = FakeCursor(stored)

    _upsert(cur, "VIR INST Compte Trade Republic")

    assert len(cur.inserted) == 1


def test_a_twin_whose_survivor_kept_a_placeholder_label_stays_lost():
    """The honest limit of doing this by label. When the row that displaced
    the twin is still shown under a placeholder, "one movement, restated"
    and "two movements, one unnamed" are the same two strings - and treating
    them as distinct is what produced duplicates every half hour. Losing the
    twin is the lesser error; it can still be entered by hand."""
    stored = [(legacy_composite_sync_id(BASE, DAY, -30000), ACCOUNT, -30000, "VIREMENT INSTANTANE", DAY)]
    cur = FakeCursor(stored)

    _upsert(cur, "VIR INST Compte Trade Republic")

    assert cur.inserted == []


def test_a_hand_recovered_row_is_still_protected():
    """Rows restored from a backup carry ids matching nothing computable, so
    only the same-amount/same-label window stands between them and being
    re-inserted. One real instance holds 84 of them."""
    stored = [("recovered_9f2c", ACCOUNT, -30000, "VIREMENT INSTANTANE", DAY)]
    cur = FakeCursor(stored)

    _upsert(cur, "VIREMENT INSTANTANE")

    assert cur.inserted == []


def test_the_window_still_absorbs_a_date_restated_by_a_day():
    """What that window is actually for: a synthesised id contains the date,
    so a bank moving an operation to its settlement date would otherwise mint
    a second id for a transaction already stored."""
    stored = [("recovered_9f2c", ACCOUNT, -30000, "PRLV SEPA CITE JARDINS", DAY)]
    cur = FakeCursor(stored)

    _upsert(cur, "PRLV SEPA CITE JARDINS", date=DAY + datetime.timedelta(days=1))

    assert cur.inserted == []


def test_the_window_no_longer_swallows_a_different_movement():
    """The data-loss bug itself: same amount three days apart, different
    label. Ten of these, ~3 850 EUR, were dropped on one real instance."""
    stored = [("recovered_9f2c", ACCOUNT, -30000, "VIR SEPA M LOIC SERRE", DAY)]
    cur = FakeCursor(stored)

    _upsert(cur, "VIR INST Compte Trade Republic", date=DAY + datetime.timedelta(days=3))

    assert len(cur.inserted) == 1


def test_a_source_that_describes_one_movement_twice_keeps_the_amount_window():
    """Trade Republic supplies real transaction ids, and that is NOT enough:
    a purchase inside a PEA emits both a "Kauforder" and a "PEA" event, same
    amount, same day, different ids. Switching the window off for it on the
    grounds that ids made it redundant put the account 3 000 EUR away from
    the balance the bank itself reported for that day. "amount" is the
    default for exactly this reason."""
    stored = [("tr:cash:abc", ACCOUNT, -175950, "Ferrari - PEA", DAY)]
    cur = FakeCursor(stored)

    upsert_transaction(
        cur,
        account_id=ACCOUNT,
        sync_id="tr:cash:def",
        date=DAY,
        label="Ferrari - Kauforder",
        amount_cents=-175950,
    )

    assert cur.inserted == []
    assert cur.relabelled == []


def test_a_restated_label_updates_the_row_instead_of_duplicating_it():
    """LCL shows a movement under a placeholder first, then restates it with
    the real counterparty. Requiring the labels to match treated the two as
    separate movements - three duplicates appeared in one production day."""
    stored = [("recovered_9f2c", ACCOUNT, 16101, "VIREMENT SEPA", DAY)]
    cur = FakeCursor(stored)

    _upsert(cur, "VIREMENT CAF DE L HERAULT", amount=16101)

    assert cur.inserted == []
    assert cur.relabelled == [("recovered_9f2c", "VIREMENT CAF DE L HERAULT")]


def test_two_real_movements_both_named_are_still_both_kept():
    """Neither label is a placeholder, so this is not a restatement - it is
    the transfer-to-a-livret / transfer-to-a-broker pair that the
    amount-only window used to swallow."""
    stored = [("recovered_9f2c", ACCOUNT, -50000, "VIR SEPA M LOIC SERRE", DAY)]
    cur = FakeCursor(stored)

    _upsert(cur, "VIR INST Compte Trade Republic", amount=-50000)

    assert len(cur.inserted) == 1
    assert cur.relabelled == []


def test_a_placeholder_never_overwrites_a_real_label():
    """The restatement only ever runs one way. A later sync re-reporting the
    placeholder must not undo the name already learned."""
    stored = [("recovered_9f2c", ACCOUNT, 16101, "VIREMENT CAF DE L HERAULT", DAY)]
    cur = FakeCursor(stored)

    _upsert(cur, "VIREMENT SEPA", amount=16101)

    assert cur.relabelled == []
    assert len(cur.inserted) == 1
