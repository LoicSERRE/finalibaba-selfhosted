"""Unit tests for the per-institution Trade Republic setup flow (v2.1).

No network and no DB: `fetch_tr_institution`, `_get_api` and
`TradeRepublicApi` are all patched, so what is under test is this module's own
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
    """Stands in for pytr's TradeRepublicApi over the two calls used here."""

    def __init__(self, countdown=60, weblogin_error=None, complete_error=None):
        self._countdown = countdown
        self._weblogin_error = weblogin_error
        self._complete_error = complete_error
        self.completed_with = None
        self._cookies_file = "/tmp/fake-cookies.txt"

    def initiate_weblogin(self):
        if self._weblogin_error:
            raise self._weblogin_error
        return self._countdown

    def complete_weblogin(self, code):
        if self._complete_error:
            raise self._complete_error
        self.completed_with = code


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

    import pytr.api

    monkeypatch.setattr(pytr.api, "TradeRepublicApi", lambda **kwargs: state["api"])
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


def test_requests_a_code_and_reports_how_long_it_stays_valid(env):
    env["api"] = FakeApi(countdown=60)
    result = start_setup(INST)
    assert result["status"] == "code_required"
    # +1 so a UI counting down never claims 0s while the code is still good.
    assert result["countdown"] == 61
    assert INST in setup_tr_institution._pending


def test_falls_back_to_a_default_countdown_when_trade_republic_reports_none(env):
    env["api"] = FakeApi(countdown=None)
    assert start_setup(INST)["countdown"] == 181


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


def test_a_rejected_code_keeps_the_attempt_alive_so_it_can_be_retyped(env):
    env["api"] = FakeApi(complete_error=RuntimeError("bad code"))
    start_setup(INST)
    with pytest.raises(SetupError):
        complete_setup(INST, "0000")
    # A typo must not force the whole flow to start over and push a new code.
    assert INST in setup_tr_institution._pending


def test_a_valid_code_connects_and_clears_the_attempt(env):
    api = FakeApi()
    env["api"] = api
    start_setup(INST)
    assert complete_setup(INST, "1234") == {"status": "connected"}
    assert api.completed_with == "1234"
    assert INST not in setup_tr_institution._pending


# ── per-institution isolation ────────────────────────────────────────────────


def test_two_institutions_can_be_mid_setup_at_once(env):
    first, second = FakeApi(), FakeApi()
    env["api"] = first
    start_setup(INST)
    env["api"] = second
    start_setup(OTHER)

    # Completing one must not consume or disturb the other's pending login.
    complete_setup(INST, "1111")
    assert first.completed_with == "1111"
    assert second.completed_with is None
    assert OTHER in setup_tr_institution._pending

    complete_setup(OTHER, "2222")
    assert second.completed_with == "2222"
