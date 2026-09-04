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
from sync_woob import UnsupportedBankError


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
    """woob's Value object. complete_setup sets it; _mark_interactive and the
    resume path also read it, so get()/default are needed too."""

    def __init__(self, default=None):
        self.default = default
        self.value = default

    def set(self, v):
        self.value = v

    def get(self):
        return self.value


class FakeBackend:
    def __init__(self):
        self.name = "amundi"
        # Mirrors the real Amundi module's transient config: captcha_response,
        # request_information (interactive-mode flag, defaults None), and resume
        # (the decoupled-validation continuation key).
        self.config = {
            "captcha_response": FakeValue(),
            "request_information": FakeValue(default=None),
            "resume": FakeValue(default=None),
        }


class FakeWoob:
    def __init__(self):
        self.backend = FakeBackend()
        self.deinited = False

    def get_backend(self, _name):
        return self.backend

    def deinit(self):
        self.deinited = True


def _drive_setup(monkeypatch, raises, persisted=None):
    """Run setup_woob._try_connect with _iter_accounts raising from `raises`,
    an iterator so a retry can behave differently from the first attempt.

    Also stands in for the database: a successful connection now WRITES the
    accounts it fetched (see setup_woob._persist_connected), which would
    otherwise need DATABASE_URL here. Pass `persisted` to capture what was
    handed to persist_accounts."""
    def fake_iter(*_a, **_kw):
        outcome = next(raises)
        if outcome is not None:
            raise outcome
        return ["one account"]

    def fake_persist(_w, _backend, _iid, _name, accounts, *_a, **_kw):
        if persisted is not None:
            persisted.extend(accounts)
        return {"synced": list(accounts)}

    monkeypatch.setattr(setup_woob, "_iter_accounts", fake_iter)
    monkeypatch.setattr(setup_woob, "_fetch_institution", lambda _i: {"name": "Amundi"})
    monkeypatch.setattr(setup_woob, "persist_accounts", fake_persist)


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


def test_a_bank_wanting_phone_approval_after_the_captcha_is_resumable_not_fatal(monkeypatch):
    """Amundi answers a solved captcha with a phone approval, and both halves
    of that matter.

    The spent single-use token must not be re-sent on the retry (Woob would
    reject it), AND the approval must come back as a STATE rather than an
    exception. Raising was the shipped behaviour, and it made the bank
    impossible to connect at all: the UI correctly drops a spent captcha widget
    on any failure, so a raised approval sent the user back to the Connect
    button, and every retry restarted at a fresh captcha and a fresh phone
    prompt. Reported from a real Amundi account, where the captcha itself
    worked and the flow still never terminated.

    This test used to assert the raise. That was pinning an incident, not an
    invariant - the invariant is the empty field_ids on the line below, and it
    is unchanged."""
    from woob.capabilities.captcha import RecaptchaV2Question
    from woob.exceptions import AppValidation

    inst = "def"
    name = setup_woob._backend_name(inst)
    _drive_setup(monkeypatch, iter([RecaptchaV2Question(website_key="k", website_url="u"), AppValidation("approve")]))
    w = FakeWoob()

    setup_woob._try_connect(w, name)
    result = setup_woob.complete_setup(inst, code="token")

    assert result["status"] == "pending_approval", "an approval is a state to resume, not a failure"
    assert result["message"] == "approve", "the bank's own wording must reach the panel"
    assert not w.deinited, "the session must survive - the approval resumes THIS login"
    assert setup_woob._pending[name]["field_ids"] == [], "the spent token must not be re-sent on retry"

    setup_woob._pending.pop(name, None)


def test_the_captcha_then_approval_flow_converges(monkeypatch):
    """The full loop the real bug broke: the captcha is solved, the bank asks
    for a phone approval, the user approves and confirms, and THAT call
    connects.

    Asserted end to end rather than one step at a time because the defect was
    exactly that every individual step worked while the sequence could never
    terminate."""
    from woob.capabilities.captcha import RecaptchaV2Question
    from woob.exceptions import AppValidation

    inst = "ghi"
    name = setup_woob._backend_name(inst)
    _drive_setup(
        monkeypatch,
        iter([RecaptchaV2Question(website_key="k", website_url="u"), AppValidation("approve"), None]),
    )
    w = FakeWoob()

    assert setup_woob._try_connect(w, name)["status"] == "captcha_required"
    assert setup_woob.complete_setup(inst, code="token")["status"] == "pending_approval"

    # No code on this call: an approval has nothing to fill in, which is why
    # _try_connect stored an empty field_ids. A retry that still demanded one
    # would fail with "Code manquant" and strand the user on the approval
    # panel with a button that cannot work.
    final = setup_woob.complete_setup(inst)

    assert final["status"] == "already_connected"
    assert final["accounts"] == 1
    assert name not in setup_woob._pending, "a finished setup must release its session"


def test_a_successful_setup_writes_the_accounts_it_fetched(monkeypatch):
    """The defect that made every earlier fix invisible: the setup connected,
    reported its account count, threw the list away, and left the database
    empty. A later sync could not recover them - Amundi's module refuses to
    start a login outside interactive mode once MFA is on, so re-fetching means
    a fresh captcha and a fresh phone notification, forever.

    The accounts must therefore be written while THIS session is alive."""
    from woob.capabilities.captcha import RecaptchaV2Question
    from woob.exceptions import AppValidation

    inst = "writes"
    name = setup_woob._backend_name(inst)
    written = []
    _drive_setup(
        monkeypatch,
        iter([RecaptchaV2Question(website_key="k", website_url="u"), AppValidation("approve"), None]),
        persisted=written,
    )
    w = FakeWoob()

    setup_woob._try_connect(w, name)
    setup_woob.complete_setup(inst, code="token")
    result = setup_woob.complete_setup(inst)

    assert result["status"] == "already_connected"
    assert written == ["one account"], "the fetched accounts must reach the database"
    assert result["synced"] == 1
    assert "_accounts" not in result, "the internal list must not leak into the HTTP response"


def test_resuming_an_approval_sets_resume_not_a_fresh_login(monkeypatch):
    """The bug behind issue #51: a phone approval that never completed.

    Woob only continues a decoupled validation when the `resume` config key
    carries a value. Without it, do_login falls through to init_login and
    restarts the whole flow - a fresh captcha and a fresh approval - so the
    connection sticks in "pending" no matter how many times the user approves.

    complete_setup with no code (the "I've approved it" click) must therefore
    set resume=True before retrying. This asserts exactly that, and that the
    retry then reaches the accounts."""
    from woob.exceptions import AppValidation

    inst = "approve"
    name = setup_woob._backend_name(inst)
    # captcha -> approval -> (resume) success
    _drive_setup(
        monkeypatch,
        iter([__import__("woob.capabilities.captcha", fromlist=["RecaptchaV2Question"]).RecaptchaV2Question(website_key="k", website_url="u"),
              AppValidation("approuve sur ton tel"),
              None]),
    )
    w = FakeWoob()
    backend = w.backend

    assert setup_woob._try_connect(w, name)["status"] == "captcha_required"
    assert setup_woob.complete_setup(inst, code="token")["status"] == "pending_approval"

    # Before the approval click, resume is untouched.
    assert backend.config["resume"].get() is None

    final = setup_woob.complete_setup(inst)  # the "I've approved it" click

    assert backend.config["resume"].get() is True, "resume must be set to continue the validation, not restart it"
    assert final["status"] == "already_connected"
    assert name not in setup_woob._pending


def test_setup_marks_the_session_interactive(monkeypatch):
    """request_information must be non-None before the first attempt, or Woob
    raises NeedInteractiveFor2FA instead of driving the real 2FA - the module's
    own base browser gates every decoupled validation on it."""
    from woob.capabilities.captcha import RecaptchaV2Question

    inst = "interactive"
    name = setup_woob._backend_name(inst)
    _drive_setup(monkeypatch, iter([RecaptchaV2Question(website_key="k", website_url="u")]))
    w = FakeWoob()

    # start_setup marks it; here we drive _try_connect after marking, mirroring
    # start_setup's own order.
    setup_woob._mark_interactive(w.backend)
    setup_woob._try_connect(w, name)

    assert w.backend.config["request_information"].get() == {}, "interactive mode must be flagged"
    setup_woob._pending.pop(name, None)


def test_action_needed_says_what_to_do_rather_than_declaring_defeat():
    """35 of the 95 CapBank modules can raise ActionNeeded, and for that whole
    family the bank is perfectly driveable - the user just has to accept a
    notice or complete a form on its site once. Telling them it "cannot be
    synced automatically" was false. The status stays `unsupported` (alert once,
    do not nag every 24h), only the wording changes."""
    from woob.exceptions import ActionNeeded

    _err, cur = _run(ActionNeeded("Veuillez vous connecter et accepter le message"), UnsupportedBankError)
    _id, _source, status, message, *_rest = cur.logs[0]
    assert status == "unsupported"
    assert "action de ta part" in message, "must say what to do"
    assert "Veuillez vous connecter" in message, "the bank's own wording must survive"
    assert "ne peut pas être synchronisée" not in message, "that claim was the bug"


def test_a_site_down_is_a_retryable_error_with_a_message_not_an_empty_crash():
    """Issue #54: La Banque Postale raised a bare BrowserUnavailable() with no
    message, so the generic handler wrote an EMPTY SyncLog and the UI showed a
    failure it could not explain. It must be status 'error' (retryable) AND
    carry a readable message even when the exception itself is empty."""
    from woob.exceptions import BrowserUnavailable

    _err, cur = _run(BrowserUnavailable(), RuntimeError)
    # params are (id, source, status, message, owner) - assert on content, the
    # robust way the rest of this file reads the log rather than by index.
    _id, _source, status, message, *_rest = cur.logs[0]
    assert status == "error", "site-down is transient and retryable, not unsupported/auth"
    assert message and message.strip(), "an empty message is exactly the #54 bug"
    assert "indisponible" in message.lower() or "maintenance" in message.lower()


def test_scraping_blocked_gets_its_own_wording():
    """ScrapingBlocked is a BrowserUnavailable subclass with a different cause,
    so it earns a different message - but still a retryable 'error'."""
    from woob.exceptions import ScrapingBlocked

    _err, cur = _run(ScrapingBlocked(), RuntimeError)
    _id, _source, status, message, *_rest = cur.logs[0]
    assert status == "error"
    assert "bloqué" in message.lower() or "détect" in message.lower()


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
