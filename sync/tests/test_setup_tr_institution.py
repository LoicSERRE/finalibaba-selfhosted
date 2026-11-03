"""Unit tests for the per-institution Trade Republic setup flow (v2.1).

No network and no DB: `fetch_tr_institution`, `_get_api` and
`new_tr_api` are all patched, so what is under test is this module's own
control flow - which failures become a user-facing SetupError, when a code is
actually requested, and whether pending state stays keyed per institution.

That last one is the reason this file exists at all. `setup_woob.py`'s own
docstring explains the constraint both modules share: several institutions can
plausibly be mid-setup at the same time (two family members adding their
accounts on the same evening), so a module-level global would let one person's
login overwrite the other's half-finished one.
"""

import pytest

import setup_tr_institution
from setup_tr_institution import SetupError, complete_setup, start_setup

INST = "inst-1"
OTHER = "inst-2"


class FakeApi:
    """Stands in for pytr's TradeRepublicApi over the v2 login calls used here."""

    def __init__(self, countdown=60, weblogin_error=None, complete_error=None, needs_code=False):
        self._countdown = countdown
        self._weblogin_error = weblogin_error
        self._complete_error = complete_error
        self.weblogin_needs_authenticator = needs_code
        self.completed = False
        self.completed_with = None
        self._cookies_file = "/tmp/fake-cookies.txt"

    def initiate_weblogin(self):
        if self._weblogin_error:
            raise self._weblogin_error
        return self._countdown

    def complete_weblogin(self, verify_code=None):
        if self._complete_error:
            raise self._complete_error
        self.completed = True
        self.completed_with = verify_code


@pytest.fixture(autouse=True)
def _clean_pending():
    setup_tr_institution._pending.clear()
    yield
    setup_tr_institution._pending.clear()


@pytest.fixture
def env(monkeypatch, tmp_path):
    """Patch every boundary: DB read, session resume, and the cookie path.

    The cookie path in particular must not point at the real ~/.pytr, since
    start_setup creates the parent directory.
    """
    state = {
        "institution": {"name": "Trade Republic", "trPhone": "+33612345678", "trPin": "1234"},
        "resumes": False,
        "api": FakeApi(),
    }

    monkeypatch.setattr(
        setup_tr_institution, "fetch_tr_institution", lambda _id: state["institution"]
    )

    def fake_get_api(phone, pin, interactive=False, scope_institution_id=None):
        if not state["resumes"]:
            raise RuntimeError("no saved session")
        return object()

    monkeypatch.setattr(setup_tr_institution, "_get_api", fake_get_api)
    monkeypatch.setattr(
        setup_tr_institution, "tr_cookies_path", lambda inst: tmp_path / f"cookies.{inst}.txt"
    )

    monkeypatch.setattr(setup_tr_institution, "new_tr_api", lambda **kwargs: state["api"])
    return state


# ── credential guards ────────────────────────────────────────────────────────


def test_unknown_institution_is_a_user_facing_error(env):
    env["institution"] = None
    with pytest.raises(SetupError) as e:
        start_setup(INST)
    assert "introuvable" in e.value.user_message


@pytest.mark.parametrize(
    ("phone", "pin"),
    [(None, "1234"), ("+33612345678", None), (None, None), ("", "")],
)
def test_missing_credentials_ask_for_them_instead_of_calling_trade_republic(env, phone, pin):
    # Half-configured is the state an institution is in between being created
    # and having its credentials saved - it must produce a clear instruction,
    # not a login attempt that fails somewhere inside pytr.
    env["institution"] = {"name": "Trade Republic", "trPhone": phone, "trPin": pin}
    with pytest.raises(SetupError) as e:
        start_setup(INST)
    assert "Trade Republic" in e.value.user_message


# ── start_setup ──────────────────────────────────────────────────────────────


def test_a_resumable_session_needs_no_code_at_all(env):
    # Pushing a notification to someone's phone when their session is still
    # valid is pure noise - report the existing connection instead.
    env["resumes"] = True
    assert start_setup(INST) == {"status": "already_connected"}
    assert INST not in setup_tr_institution._pending


def test_asks_for_an_approval_in_the_app_and_says_how_long_it_stays_open(env):
    env["api"] = FakeApi(countdown=61)
    assert start_setup(INST) == {"status": "pending_approval", "countdown": 61}
    assert INST in setup_tr_institution._pending


def test_asks_for_the_authenticator_code_when_the_account_has_one(env):
    env["api"] = FakeApi(countdown=61, needs_code=True)
    assert start_setup(INST)["status"] == "code_required"


def test_falls_back_to_a_default_countdown_when_trade_republic_reports_none(env):
    env["api"] = FakeApi(countdown=None)
    assert start_setup(INST)["countdown"] == 121


def test_a_refused_login_becomes_a_user_facing_error_and_leaves_nothing_pending(env):
    env["api"] = FakeApi(weblogin_error=RuntimeError("TOO_MANY_REQUESTS"))
    with pytest.raises(SetupError) as e:
        start_setup(INST)
    assert "Trade Republic" in e.value.user_message
    assert INST not in setup_tr_institution._pending


def test_restarting_replaces_the_previous_attempt_rather_than_stacking(env):
    first = FakeApi()
    env["api"] = first
    start_setup(INST)
    second = FakeApi()
    env["api"] = second
    start_setup(INST)
    assert setup_tr_institution._pending[INST]["api"] is second


# ── complete_setup ───────────────────────────────────────────────────────────


def test_completing_without_a_started_attempt_tells_the_user_to_restart(env):
    with pytest.raises(SetupError) as e:
        complete_setup(INST, "1234")
    assert "relance" in e.value.user_message.lower()


def test_an_approval_in_the_app_connects_with_no_code(env):
    api = FakeApi()
    env["api"] = api
    start_setup(INST)
    assert complete_setup(INST) == {"status": "connected"}
    assert api.completed and api.completed_with is None
    assert INST not in setup_tr_institution._pending


def test_a_valid_authenticator_code_connects_and_clears_the_attempt(env):
    api = FakeApi(needs_code=True)
    env["api"] = api
    start_setup(INST)
    assert complete_setup(INST, "123456") == {"status": "connected"}
    assert api.completed_with == "123456"
    assert INST not in setup_tr_institution._pending


def test_an_authenticator_login_without_its_code_asks_for_it(env):
    env["api"] = FakeApi(needs_code=True)
    start_setup(INST)
    with pytest.raises(SetupError):
        complete_setup(INST)
    assert INST in setup_tr_institution._pending


def test_a_rejected_code_keeps_the_attempt_alive_so_it_can_be_retyped(env):
    env["api"] = FakeApi(needs_code=True, complete_error=ValueError("bad code"))
    start_setup(INST)
    with pytest.raises(SetupError):
        complete_setup(INST, "000000")
    # A typo must not force the whole flow to start over.
    assert INST in setup_tr_institution._pending


@pytest.mark.parametrize("error", [TimeoutError(), ValueError("Unexpected login process status: 'REJECTED'")])
def test_an_approval_that_never_comes_ends_the_attempt(env, error):
    env["api"] = FakeApi(complete_error=error)
    start_setup(INST)
    with pytest.raises(SetupError) as e:
        complete_setup(INST)
    assert "relance" in e.value.user_message
    # That login process is over on Trade Republic's side: only a new one can work.
    assert INST not in setup_tr_institution._pending


# ── per-institution isolation ────────────────────────────────────────────────


def test_two_institutions_can_be_mid_setup_at_once(env):
    first, second = FakeApi(needs_code=True), FakeApi(needs_code=True)
    env["api"] = first
    start_setup(INST)
    env["api"] = second
    start_setup(OTHER)

    # Completing one must not consume or disturb the other's pending login.
    complete_setup(INST, "111111")
    assert first.completed_with == "111111"
    assert second.completed_with is None
    assert OTHER in setup_tr_institution._pending

    complete_setup(OTHER, "222222")
    assert second.completed_with == "222222"
