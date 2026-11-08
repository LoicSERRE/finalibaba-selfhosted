"""Classifying what a bank login can fail with.

Built after measuring the catalogue rather than after another bug report. The
counts that motivated it, over the 95 CapBank modules:

    BrowserIncorrectPassword   61   was unclassified
    AssertionError             40   was unclassified
    BrowserUserBanned          18   was unclassified
    BrowserPasswordExpired     17   was unclassified
    AuthMethodNotImplemented   16   was unclassified

So the single most likely failure - wrong credentials - reached the generic
handler, and since BrowserIncorrectPassword carries no message the SyncLog row
came out empty and the UI had nothing to show.
"""

import importlib.util

import pytest

import woob_errors


def _classify(exc):
    result = woob_errors.classify(exc)
    assert result is not None, f"{type(exc).__name__} must be classified"
    return result


def test_wrong_credentials_say_so_and_stay_fixable():
    """The 61-module case. auth_required rather than error: the user can fix it,
    and the next run then succeeds."""
    from woob.exceptions import BrowserIncorrectPassword

    status, message = _classify(BrowserIncorrectPassword())
    assert status == "auth_required"
    assert message.strip(), "an empty message is the whole bug this prevents"
    assert "dentifiants" in message


# BrowserUserBanned SUBCLASSES BrowserIncorrectPassword, so a table matched in
# the wrong order would tell a locked-out user to check their password - and
# retrying is exactly what prolongs the lockout.
def test_a_temporary_lockout_is_not_reported_as_a_bad_password():
    from woob.exceptions import BrowserUserBanned

    status, message = _classify(BrowserUserBanned("trop de tentatives"))
    assert status == "error"
    assert "bloqué" in message.lower()
    assert "dentifiants" not in message


# BrowserPasswordExpired and AuthMethodNotImplemented both subclass ActionNeeded
# and mean different things - one the user can fix, the other nobody can.
@pytest.mark.parametrize(
    ("factory", "expected_status", "needle"),
    [
        (lambda: __import__("woob.exceptions", fromlist=["BrowserPasswordExpired"]).BrowserPasswordExpired(),
         "auth_required", "expiré"),
        (lambda: __import__("woob.exceptions", fromlist=["AuthMethodNotImplemented"]).AuthMethodNotImplemented("x"),
         "unsupported", "authentification"),
    ],
)
def test_the_action_needed_subclasses_keep_their_own_meaning(factory, expected_status, needle):
    status, message = _classify(factory())
    assert status == expected_status
    assert needle in message.lower()


def test_action_needed_itself_still_says_what_to_do():
    from woob.exceptions import ActionNeeded

    status, message = _classify(ActionNeeded("Veuillez accepter le message d'information"))
    assert status == "unsupported"
    assert "action de ta part" in message
    assert "Veuillez accepter" in message, "the bank's own wording is the useful half"


def test_scraping_blocked_is_distinguished_from_a_site_being_down():
    from woob.exceptions import BrowserUnavailable, ScrapingBlocked

    blocked_status, blocked = _classify(ScrapingBlocked())
    down_status, down = _classify(BrowserUnavailable())
    assert blocked_status == down_status == "error", "both are transient, both retryable"
    assert blocked != down, "but they have different causes, so different wording"


def test_a_module_that_gives_up_blames_the_bank_not_the_user():
    """40 modules raise AssertionError and 25 NotImplementedError when a bank's
    response is not what they expect. That means the bank moved, so the message
    must not send the user hunting through their own settings."""
    for exc in (AssertionError("Unhandled error message during login: boom"), NotImplementedError()):
        status, message = _classify(exc)
        assert status == "error"
        assert "changé son site" in message


def _raise_from(path):
    """Raise the AttributeError of issue #183 from a file at `path`, so the
    traceback's innermost frame points there."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("def do_login():\n    page = None\n    return page.get_captcha_site_key()\n")
    spec = importlib.util.spec_from_file_location("fake_module_browser", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    try:
        module.do_login()
    except AttributeError as e:
        return e
    raise AssertionError("do_login must raise")


def test_a_module_that_lands_on_a_page_it_does_not_know_blames_the_bank(tmp_path):
    """Issue #183: CIC Épargne Salariale moved domains, the module's login URL no
    longer matched, and the user got "'NoneType' object has no attribute
    'get_captcha_site_key'". Raised inside a Woob module, that means the same
    thing as an AssertionError there: the bank changed under the module."""
    exc = _raise_from(tmp_path / "modules" / "3.7" / "woob_modules" / "cmes" / "browser.py")
    status, message = _classify(exc)
    assert status == "error"
    assert "changé son site" in message


def test_the_same_error_in_our_own_code_keeps_its_traceback(tmp_path):
    """Outside a module it is a bug of ours, not the bank's: left unclassified so
    the caller logs the full traceback."""
    assert woob_errors.classify(_raise_from(tmp_path / "app" / "sync_woob.py")) is None


def test_an_unrelated_exception_is_left_to_the_caller():
    """None, not a guess: the caller keeps its fallback, and an unknown failure
    still reaches the logs with a full traceback."""
    assert woob_errors.classify(ValueError("boom")) is None
