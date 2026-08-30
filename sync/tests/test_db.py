"""Unit tests for db.py's pure helpers - no DB, no network.

infer_account_type() used to be duplicated between sync_lcl.py and
sync_woob.py, and had already drifted apart before being consolidated here
(see db.py's own comment) - these cases lock in the real French regulated-
savings products a user reported being miscategorized, so the same drift
can't silently reappear.
"""

from db import infer_account_type


def test_recognizes_livret_a():
    assert infer_account_type("Livret A") == "SAVINGS"


def test_recognizes_ldds():
    assert infer_account_type("LDDS") == "SAVINGS"


def test_recognizes_lep_even_as_a_bare_acronym():
    # The real gap that caused the reported bug: a bank's raw label can be
    # just "LEP", with no "livret" substring for the older keyword list to
    # catch.
    assert infer_account_type("LEP") == "SAVINGS"
    assert infer_account_type("Compte LEP") == "SAVINGS"


def test_recognizes_livret_jeune():
    assert infer_account_type("Livret Jeune") == "SAVINGS"


def test_recognizes_pel_and_cel():
    assert infer_account_type("PEL") == "SAVINGS"
    assert infer_account_type("CEL") == "SAVINGS"


def test_recognizes_investment_keywords():
    assert infer_account_type("PEA Bourse") == "INVESTMENT"
    assert infer_account_type("Compte Titres") == "INVESTMENT"


def test_is_case_insensitive():
    assert infer_account_type("livret a") == "SAVINGS"
    assert infer_account_type("LIVRET A") == "SAVINGS"


def test_defaults_to_checking_for_an_unrecognized_label():
    assert infer_account_type("Compte Courant") == "CHECKING"


# ── upsert_account's native-id fallback, and why Trade Republic is exempt ─────
#
# The fallback matches on the trailing colon-delimited segment because for
# LCL/Woob that segment is a bank-generated native account id, unique per real
# account. Trade Republic's trailing segment is an account KIND, so without
# this exemption "tr:cash" and "tr:<institutionId>:cash" merge into one row by
# string coincidence - confirmed empirically against a real database before
# this guard existed, and it silently defeated v2.1's whole per-user
# namespacing.

from db import _is_trade_republic_sync_id


def test_trade_republic_ids_are_recognised_under_both_shapes():
    assert _is_trade_republic_sync_id("tr:cash")
    assert _is_trade_republic_sync_id("tr:pea")
    assert _is_trade_republic_sync_id("tr:inst-123:cash")
    assert _is_trade_republic_sync_id("tr:inst-123:crypto")


def test_bank_native_ids_still_use_the_fallback():
    # These are the ids the fallback exists for - it must keep matching them.
    assert not _is_trade_republic_sync_id("lcl:01835090481R")
    assert not _is_trade_republic_sync_id("woob:inst-1:01835090481R")


def test_unknown_tr_shapes_are_not_treated_as_trade_republic():
    # A suffix this app never writes, and a shape with too many segments:
    # neither should silently opt out of the dedup fallback.
    assert not _is_trade_republic_sync_id("tr:unknown")
    assert not _is_trade_republic_sync_id("tr:a:b:cash")
