"""Which branch a Woob login exception takes, and what it writes.

From issue #51: adding Amundi and syncing produced a raw traceback ending in
RecaptchaV2Question, and a SyncLog row whose message was a truncated exception
string.

The first fix classified a captcha as "unsupported" alongside BrowserRedirect
and ActionNeeded, reasoning that a captcha exists precisely to defeat
automation. True, and beside the point: the bank is refusing a ROBOT, and Woob
raises RecaptchaV2Question only because nothing supplied an answer. Fill
`captcha_response` and the login proceeds. So a captcha is auth_required - a
human can fix it - while the other two genuinely cannot be driven at all.

That distinction is the whole point of this file, which is why both halves are
asserted here rather than only the one that changed.

No network and no bank: only the branch taken and the row written.
"""

import pytest

import setup_woob
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


def _run(exc, expected):
    """Drive _fetch_accounts with _iter_accounts raising `exc`, asserting it
    comes back out as `expected`.

    The expected type is a parameter rather than a blanket `raises(Exception)`
    because the type IS the behaviour under test here - which bucket a given
    Woob exception lands in - so naming it at each call site is the assertion,
    not boilerplate around one."""
    cur, conn = FakeCursor(), FakeConn()
    original = sync_woob._iter_accounts

    def boom(*_args, **_kwargs):
        raise exc

    sync_woob._iter_accounts = boom
    try:
        with pytest.raises(expected) as caught:
            sync_woob._fetch_accounts(None, "b", "inst-1", "Amundi", cur, conn, "woob:inst-1")
        return caught.value, cur
    finally:
        sync_woob._iter_accounts = original


def test_a_captcha_gets_its_own_status_neither_auth_required_nor_unsupported():
    # The exact exception from the report, constructed the way the Amundi
    # module constructs it.
    #
    # Its own status because the two existing ones are each wrong in a
    # different direction: "unsupported" would hide the Connect button on a
    # bank that in fact works, and "auth_required" would have the failure
    # alert remind the user every 24h forever, since no scheduled run can
    # ever clear a captcha. See lib/domain/sync-status.ts.
    from woob.capabilities.captcha import RecaptchaV2Question

    exc, cur = _run(
        RecaptchaV2Question(website_key="k", website_url="https://amundi-ee.com"),
        sync_woob.AuthRequiredError,
    )

    written = " ".join(str(p) for p in cur.logs)
    assert "captcha_required" in written
    assert "unsupported" not in written
    # The control flow stays the 2FA one - only the recorded status differs.
    assert isinstance(exc, sync_woob.AuthRequiredError)
    assert not isinstance(exc, sync_woob.UnsupportedBankError)


def test_the_sync_log_message_is_readable_rather_than_a_traceback():
    # The half of issue #51 that was never about classification: whatever the
    # verdict, the user must not be shown a truncated Python exception.
    from woob.capabilities.captcha import RecaptchaV2Question

    _, cur = _run(RecaptchaV2Question(website_key="k", website_url="u"), sync_woob.AuthRequiredError)
    assert cur.logs, "a SyncLog row must still be written"
    written = " ".join(str(p) for p in cur.logs)
    assert "captcha" in written
    assert "Traceback" not in written
    assert "RecaptchaV2Question" not in written


@pytest.mark.parametrize(
    "factory",
    [
        lambda: __import__("woob.exceptions", fromlist=["BrowserRedirect"]).BrowserRedirect("go here"),
        lambda: __import__("woob.exceptions", fromlist=["ActionNeeded"]).ActionNeeded("do this on our site"),
    ],
)
def test_the_genuinely_undriveable_families_stay_unsupported(factory):
    # The guard on the other side: moving captchas out must not drag these
    # with them. Nothing a human clicks in Settings resolves a full browser
    # redirect or an action the bank wants done on its own site.
    exc, cur = _run(factory(), sync_woob.UnsupportedBankError)
    assert isinstance(exc, sync_woob.UnsupportedBankError)
    assert not isinstance(exc, sync_woob.AuthRequiredError)
    assert "unsupported" in " ".join(str(p) for p in cur.logs)


def test_a_real_2fa_prompt_still_means_auth_required():
    # The guard against over-reaching: a bank that CAN be connected after an
    # interactive setup must keep its own status, or this fix would break
    # every 2FA bank.
    from woob.exceptions import AppValidation

    exc, cur = _run(AppValidation("approve in the app"), sync_woob.AuthRequiredError)
    assert isinstance(exc, sync_woob.AuthRequiredError)
    assert "auth_required" in " ".join(str(p) for p in cur.logs)


def test_an_unexpected_error_is_still_an_error():
    # The other guard: a genuine crash must not be relabelled as "this bank
    # is unsupported", which would hide real breakage.
    exc, cur = _run(RuntimeError("module blew up"), RuntimeError)
    assert not isinstance(exc, sync_woob.UnsupportedBankError)
    assert not isinstance(exc, sync_woob.AuthRequiredError)
    assert "error" in " ".join(str(p) for p in cur.logs)


# --- the setup half: the captcha must be answerable, not just reported -------


class FakeValue:
    """woob's Value object: complete_setup only ever calls .set() on it."""

    def __init__(self):
        self.value = None

    def set(self, v):
        self.value = v


class FakeBackend:
    def __init__(self):
        self.name = "amundi"
        self.config = {"captcha_response": FakeValue()}


class FakeWoob:
    def __init__(self):
        self.backend = FakeBackend()
        self.deinited = False

    def get_backend(self, _name):
        return self.backend

    def deinit(self):
        self.deinited = True


def _drive_setup(monkeypatch, raises):
    """Run setup_woob._try_connect with _iter_accounts raising from `raises`,
    an iterator so a retry can behave differently from the first attempt."""
    def fake_iter(*_a, **_kw):
        outcome = next(raises)
        if outcome is not None:
            raise outcome
        return ["one account"]

    monkeypatch.setattr(setup_woob, "_iter_accounts", fake_iter)


def test_setup_offers_the_captcha_instead_of_declaring_defeat(monkeypatch):
    from woob.capabilities.captcha import RecaptchaV2Question

    _drive_setup(monkeypatch, iter([RecaptchaV2Question(website_key="site-key-1", website_url="https://amundi-ee.com")]))
    w = FakeWoob()
    result = setup_woob._try_connect(w, "inst_x")

    assert result["status"] == "captcha_required"
    # The site key is what makes the widget renderable at all - without it the
    # UI has nothing to show and correctly falls back to "unsupported".
    assert result["website_key"] == "site-key-1"
    assert result["website_url"] == "https://amundi-ee.com"
    # The session must survive: solving the captcha resumes THIS login, it does
    # not start a new one.
    assert not w.deinited
    assert setup_woob._pending["inst_x"]["field_ids"] == ["captcha_response"]

    setup_woob._pending.pop("inst_x", None)


def test_the_solved_token_reaches_the_bank_through_the_config_field(monkeypatch):
    """The whole mechanism in one assertion: complete_setup must put the token
    the human produced into `captcha_response`, which is the only thing that
    stops the Amundi module raising again."""
    from woob.capabilities.captcha import RecaptchaV2Question

    inst = "abc"
    name = setup_woob._backend_name(inst)
    _drive_setup(monkeypatch, iter([RecaptchaV2Question(website_key="k", website_url="u"), None]))
    w = FakeWoob()

    setup_woob._try_connect(w, name)
    result = setup_woob.complete_setup(inst, code="03AGdBq26-solved-token")

    assert w.backend.config["captcha_response"].value == "03AGdBq26-solved-token"
    assert result["status"] == "already_connected"
    assert result["accounts"] == 1


def test_a_bank_wanting_phone_approval_after_the_captcha_stops_resending_it(monkeypatch):
    """Amundi can ask for a phone approval once the captcha clears. The retry
    must not re-send the spent single-use token - Woob would reject it."""
    from woob.capabilities.captcha import RecaptchaV2Question
    from woob.exceptions import AppValidation

    inst = "def"
    name = setup_woob._backend_name(inst)
    _drive_setup(monkeypatch, iter([RecaptchaV2Question(website_key="k", website_url="u"), AppValidation("approve")]))
    w = FakeWoob()

    setup_woob._try_connect(w, name)
    with pytest.raises(setup_woob.SetupError):
        setup_woob.complete_setup(inst, code="token")

    assert setup_woob._pending[name]["field_ids"] == [], "the spent token must not be re-sent on retry"
    setup_woob._pending.pop(name, None)


@pytest.mark.parametrize(
    "factory",
    [
        lambda: __import__("woob.exceptions", fromlist=["BrowserRedirect"]).BrowserRedirect("go here"),
        lambda: __import__("woob.exceptions", fromlist=["ActionNeeded"]).ActionNeeded("do this on our site"),
    ],
)
def test_setup_still_declares_the_undriveable_families_unsupported(monkeypatch, factory):
    _drive_setup(monkeypatch, iter([factory()]))
    w = FakeWoob()

    result = setup_woob._try_connect(w, "inst_y")

    assert result["status"] == "unsupported"
    # Nothing to resume, so the session is torn down rather than leaked.
    assert w.deinited


def test_a_refused_captcha_is_not_reported_as_a_successful_connection(monkeypatch):
    """main.py hands complete_setup's return straight back as a 200, so a
    result that merely says "captcha needed again" must raise instead of
    flowing through - otherwise a token that expired (they last about two
    minutes) reports a connection that never happened."""
    from woob.capabilities.captcha import RecaptchaV2Question

    inst = "ghi"
    name = setup_woob._backend_name(inst)
    q = RecaptchaV2Question(website_key="k", website_url="u")
    _drive_setup(monkeypatch, iter([q, q]))
    w = FakeWoob()

    setup_woob._try_connect(w, name)
    with pytest.raises(setup_woob.SetupError) as caught:
        setup_woob.complete_setup(inst, code="expired-token")

    assert "aptcha" in str(caught.value.user_message)
    # Retrying needs a fresh challenge, so the spent session is dropped rather
    # than left behind for a retry that cannot succeed.
    assert name not in setup_woob._pending
