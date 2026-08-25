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
