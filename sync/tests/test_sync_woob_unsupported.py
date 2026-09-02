"""A bank this integration structurally cannot drive must say so.

From issue #51: adding Amundi and syncing produced a raw traceback ending in
RecaptchaV2Question, and a SyncLog row whose message was a truncated exception
string. setup_woob.py had classified captchas as "unsupported" since it was
written; the sync path had never learned the same lesson, so these landed in
the generic handler alongside genuine crashes.

No network and no bank here - the point under test is which branch of
_fetch_accounts a given Woob exception takes, and what it writes.
"""

import pytest

import sync_woob


class FakeCursor:
    """Records the SyncLog rows _fail writes, ignores everything else."""

    def __init__(self):
        self.logs = []

    def execute(self, sql, params=None):
        if "SyncLog" in sql:
            self.logs.append(params)

    def fetchone(self):
        # write_sync_log resolves the row's owner from the source string via
        # _sync_log_owner, which looks the institution up. None = fall back to
        # the column default, which is all this test needs.
        return None

    def close(self):
        pass


class FakeConn:
    """_fail rolls back, commits and closes - all no-ops here."""

    def rollback(self):
        pass

    def commit(self):
        pass

    def close(self):
        pass


def _run(exc):
    """Drive _fetch_accounts with _iter_accounts raising `exc`."""
    cur, conn = FakeCursor(), FakeConn()
    original = sync_woob._iter_accounts

    def boom(*_args, **_kwargs):
        raise exc

    sync_woob._iter_accounts = boom
    try:
        # Broad on purpose: which exception TYPE comes out is the assertion,
        # and each caller checks it.
        with pytest.raises(Exception) as caught:
            sync_woob._fetch_accounts(None, "b", "inst-1", "Amundi", cur, conn, "woob:inst-1")
        return caught.value, cur
    finally:
        sync_woob._iter_accounts = original


def test_a_captcha_is_reported_as_unsupported_not_as_a_crash():
    # The exact exception from the report, constructed the way the Amundi
    # module constructs it.
    from woob.capabilities.captcha import RecaptchaV2Question

    exc, _cur = _run(RecaptchaV2Question(website_key="k", website_url="https://amundi-ee.com"))

    assert isinstance(exc, sync_woob.UnsupportedBankError)
    assert "ne peut pas être synchronisée automatiquement" in str(exc)


def test_it_is_not_reported_as_auth_required():
    # auth_required means "reconnect and it will work", which would send the
    # user round a setup loop that cannot succeed against a captcha.
    from woob.capabilities.captcha import RecaptchaV2Question

    exc, _ = _run(RecaptchaV2Question(website_key="k", website_url="u"))
    assert not isinstance(exc, sync_woob.AuthRequiredError)


def test_the_sync_log_message_is_readable_rather_than_a_traceback():
    from woob.capabilities.captcha import RecaptchaV2Question

    _, cur = _run(RecaptchaV2Question(website_key="k", website_url="u"))
    assert cur.logs, "a SyncLog row must still be written"
    written = " ".join(str(p) for p in cur.logs)
    assert "unsupported" in written
    assert "Traceback" not in written


@pytest.mark.parametrize(
    "factory",
    [
        lambda: __import__("woob.exceptions", fromlist=["BrowserRedirect"]).BrowserRedirect("go here"),
        lambda: __import__("woob.exceptions", fromlist=["ActionNeeded"]).ActionNeeded("do this on our site"),
    ],
)
def test_the_other_undriveable_families_take_the_same_branch(factory):
    # setup_woob.py groups these three together; the sync path must agree,
    # or the two halves of the app disagree about the same bank.
    exc, _ = _run(factory())
    assert isinstance(exc, sync_woob.UnsupportedBankError)


def test_a_real_2fa_prompt_still_means_auth_required():
    # The guard against over-reaching: a bank that CAN be connected after an
    # interactive setup must keep its own status, or this fix would break
    # every 2FA bank.
    from woob.exceptions import AppValidation

    exc, cur = _run(AppValidation("approve in the app"))
    assert isinstance(exc, sync_woob.AuthRequiredError)
    assert "auth_required" in " ".join(str(p) for p in cur.logs)


def test_an_unexpected_error_is_still_an_error():
    # The other guard: a genuine crash must not be relabelled as "this bank
    # is unsupported", which would hide real breakage.
    exc, cur = _run(RuntimeError("module blew up"))
    assert not isinstance(exc, sync_woob.UnsupportedBankError)
    assert not isinstance(exc, sync_woob.AuthRequiredError)
    assert "error" in " ".join(str(p) for p in cur.logs)
