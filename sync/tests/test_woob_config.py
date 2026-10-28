"""Module config beyond login/password, and where it must never end up.

Issue #135: the Crédit Agricole module declares a required `website` (which
regional bank), and only `login`/`password` were ever passed, so Woob refused
the backend before any request left the container. A dozen other modules were
in the same position (Banque Populaire's region, ING's date of birth, ...).

The fields are built here from real woob Value classes, shaped like the
modules' own CONFIG, rather than from the modules themselves: those are
downloaded at runtime, and these tests run offline.
"""

import json
import stat

import pytest
from woob.tools.backend import BackendConfig
from woob.tools.value import (
    Value,
    ValueBackendPassword,
    ValueBool,
    ValueDate,
    ValueTransient,
)

import sync_woob
import woob_config
from sync_woob import BackendConfigError, load_backend_or_explain

# The value a test must never find in a message or a log.
SECRET = "s3cret-value"


def cragr_like():
    return BackendConfig(
        Value(
            "website",
            label="Caisse Régionale",
            choices={"www.ca-alpesprovence.fr": "Alpes Provence", "www.ca-sudrhonealpes.fr": "Sud Rhône Alpes"},
        ),
        ValueBackendPassword("login", label="Identifiant à 11 chiffres", masked=False, regexp=r"\d{11}"),
        ValueBackendPassword("password", label="Code personnel à 6 chiffres", regexp=r"\d{6}"),
        ValueTransient("otp"),
    )


def ing_like():
    return BackendConfig(
        ValueBackendPassword("login", label="Numéro client", masked=False),
        ValueBackendPassword("password", label="Code secret"),
        ValueDate("birthday", required=True, label="Date de naissance", formats=("%d/%m/%Y",)),
        ValueBool("rotating", label="Renouveler", default=False),
        ValueBackendPassword("security_code", label="Code de sécurité"),
    )


def exchange_like():
    """No `login` at all - keyed by API keys, like binance."""
    return BackendConfig(
        Value("api_key", label="Api key"),
        ValueBackendPassword("secret_key", label="Secret Key"),
    )


# --- describe_fields --------------------------------------------------------


def test_the_region_is_described_as_a_required_choice():
    fields = {f["id"]: f for f in woob_config.describe_fields(cragr_like())}
    website = fields["website"]
    assert website["kind"] == "choice"
    assert website["required"] is True
    assert website["default"] is None
    assert {"value": "www.ca-sudrhonealpes.fr", "label": "Sud Rhône Alpes"} in website["choices"]


def test_transient_fields_belong_to_the_setup_not_the_form():
    assert "otp" not in [f["id"] for f in woob_config.describe_fields(cragr_like())]


def test_kinds_follow_the_value_classes():
    fields = {f["id"]: f for f in woob_config.describe_fields(ing_like())}
    assert fields["login"]["kind"] == "text"  # masked=False
    assert fields["password"]["kind"] == "secret"
    assert fields["birthday"]["kind"] == "date"
    assert fields["rotating"]["kind"] == "bool"
    assert fields["rotating"]["default"] == "n"
    assert fields["security_code"]["kind"] == "secret"


def test_a_secret_never_carries_a_default():
    config = BackendConfig(ValueBackendPassword("pin", label="PIN", default="0000"))
    assert woob_config.describe_fields(config)[0]["default"] is None


def test_the_description_is_plain_json():
    # It is returned as-is by the HTTP endpoint.
    json.dumps(woob_config.describe_fields(cragr_like()) + woob_config.describe_fields(ing_like()))


# --- build_params -----------------------------------------------------------


def test_the_stored_region_reaches_the_module():
    params = woob_config.build_params(cragr_like(), "12345678901", "123456", {"website": "www.ca-sudrhonealpes.fr"})
    assert params == {"login": "12345678901", "password": "123456", "website": "www.ca-sudrhonealpes.fr"}


def test_credentials_cannot_be_smuggled_through_the_extra_config():
    params = woob_config.build_params(cragr_like(), "real", "pw", {"login": "other", "password": "other"})
    assert params["login"] == "real"
    assert params["password"] == "pw"


def test_a_key_the_module_does_not_declare_is_dropped():
    params = woob_config.build_params(cragr_like(), "l", "p", {"_module": "evil", "otp": "1"})
    assert "_module" not in params
    assert "otp" not in params, "a transient field is never stored config"


def test_a_module_without_login_gets_none():
    params = woob_config.build_params(exchange_like(), None, None, {"api_key": "k", "secret_key": "s"})
    assert params == {"api_key": "k", "secret_key": "s"}


@pytest.mark.parametrize("bad", ["line\nbreak", "nul\x00", "x" * (woob_config.MAX_VALUE_LENGTH + 1)])
def test_a_value_woob_must_not_receive_is_refused_by_field_name_only(bad):
    with pytest.raises(woob_config.InvalidConfigValue) as excinfo:
        woob_config.build_params(cragr_like(), "l", "p", {"website": bad})
    assert excinfo.value.field_id == "website"
    assert bad not in str(excinfo.value)


@pytest.mark.parametrize("bad", ["1990-02-30", "31/01/1990", "yesterday"])
def test_a_date_is_an_iso_calendar_date(bad):
    # woob 3.7 raises a TypeError, not a ConfigError, on 30 February.
    with pytest.raises(woob_config.InvalidConfigValue) as excinfo:
        woob_config.build_params(ing_like(), "l", "p", {"birthday": bad})
    assert excinfo.value.field_id == "birthday"


def test_a_real_date_passes():
    assert woob_config.build_params(ing_like(), "l", "p", {"birthday": "1990-01-31"})["birthday"] == "1990-01-31"


def test_a_control_character_in_the_password_is_refused_too():
    with pytest.raises(woob_config.InvalidConfigValue) as excinfo:
        woob_config.build_params(cragr_like(), "l", "p\r\n_module = x", {})
    assert excinfo.value.field_id == "password"


# --- parse_stored / credentials ---------------------------------------------


@pytest.mark.parametrize(
    "raw",
    [None, "", "not json", "[]", '{"website": 1}', '{"website": {"a": "b"}}', '{"Bad-Key": "x"}'],
)
def test_anything_but_a_flat_object_of_strings_is_ignored(raw):
    assert woob_config.parse_stored(raw) == {}


def test_a_stored_config_round_trips():
    assert woob_config.parse_stored('{"website": "www.ca-sudrhonealpes.fr"}') == {"website": "www.ca-sudrhonealpes.fr"}


def test_credentials_reads_the_four_columns():
    row = {
        "woobModule": "cragr",
        "woobLogin": "l",
        "woobPassword": "p",
        "woobConfig": '{"website": "www.ca-sudrhonealpes.fr"}',
    }
    assert woob_config.credentials(row) == ("cragr", "l", "p", {"website": "www.ca-sudrhonealpes.fr"})


def test_an_ignored_stored_config_does_not_log_its_content(caplog):
    woob_config.parse_stored(json.dumps({"website": {"nested": SECRET}}))
    assert SECRET not in caplog.text


# --- load_backend_or_explain ------------------------------------------------


class _Loaded:
    def __init__(self, config):
        self.klass = type("FakeModule", (), {"CONFIG": config})


class _Loader:
    def __init__(self, config):
        self._config = config

    def get_or_load_module(self, name):
        return _Loaded(self._config)


class RecordingWoob:
    """load_backend validating like Woob does: the real BackendConfig.load,
    so a missing required field raises the real ConfigError."""

    def __init__(self, config):
        self.modules_loader = _Loader(config)
        self.backend_instances = {}
        self.storage = object()
        self.requests = None  # what Value.load receives; unused by these fields
        self.calls = []
        self._config = config

    def load_backend(self, module, name, params=None, storage=None, **kwargs):
        self.calls.append({"module": module, "name": name, "params": params, "storage": storage})
        self._config.load(self, module, name, params or {}, nofail=False)
        self.backend_instances[name] = object()


def test_the_credit_agricole_case_now_loads():
    w = RecordingWoob(cragr_like())
    load_backend_or_explain(w, "cragr", "inst_x", "12345678901", "123456", {"website": "www.ca-sudrhonealpes.fr"})
    assert "inst_x" in w.backend_instances
    assert w.calls[0]["params"]["website"] == "www.ca-sudrhonealpes.fr"


def test_the_persistent_storage_is_passed_explicitly():
    # load_backend, unlike load_backends, does not default to the Woob's own
    # storage - without it the 2FA state of every bank would be lost again
    # (issue #51).
    w = RecordingWoob(cragr_like())
    load_backend_or_explain(w, "cragr", "inst_x", "12345678901", "123456", {"website": "www.ca-sudrhonealpes.fr"})
    assert w.calls[0]["storage"] is w.storage


def test_a_missing_region_names_the_field_by_its_label():
    w = RecordingWoob(cragr_like())
    with pytest.raises(BackendConfigError) as excinfo:
        load_backend_or_explain(w, "cragr", "inst_x", "12345678901", "123456", {})
    assert "Caisse Régionale" in str(excinfo.value)
    assert "inst_x" not in w.backend_instances


class QuotingValue(Value):
    """A field whose validation quotes what it rejected - woob's ConfigError
    wraps that message as-is, and modules ship their own Value checks."""

    def check_valid(self, v):
        raise ValueError(f"{v!r} is not a valid code")


def test_a_rejected_value_is_never_quoted_back():
    # The user sees the field's label, and only that.
    config = BackendConfig(
        ValueBackendPassword("login", label="Identifiant", masked=False),
        ValueBackendPassword("password", label="Mot de passe"),
        QuotingValue("security_code", label="Code de sécurité"),
    )
    w = RecordingWoob(config)
    with pytest.raises(BackendConfigError) as excinfo:
        load_backend_or_explain(w, "ccf", "inst_x", "l", "p", {"security_code": SECRET})
    assert "Code de sécurité" in str(excinfo.value)
    assert SECRET not in str(excinfo.value)
    assert excinfo.value.__cause__ is None and excinfo.value.__suppress_context__


def test_an_invalid_stored_value_never_reaches_woob():
    w = RecordingWoob(cragr_like())
    with pytest.raises(BackendConfigError):
        load_backend_or_explain(w, "cragr", "inst_x", "12345678901", "123456\n", {"website": "www.ca-sudrhonealpes.fr"})
    assert w.calls == []


def test_the_sync_path_files_a_config_error_as_reconnectable(monkeypatch):
    """`auth_required`, not `unsupported`: unlike a missing Python package,
    the user can fix this from Settings, and the Connect button must stay."""
    written = {}
    monkeypatch.setattr(sync_woob.setup_locks, "is_setup_in_progress", lambda _i: False)
    monkeypatch.setattr(sync_woob, "update_woob_repositories", lambda: None)
    monkeypatch.setattr(sync_woob, "make_woob", lambda: RecordingWoob(cragr_like()))
    monkeypatch.setattr(sync_woob, "get_conn", lambda: _FakeConn())
    monkeypatch.setattr(sync_woob, "_fail", lambda cur, conn, source, status, msg: written.update(status=status, msg=msg))

    result = sync_woob.run("inst-1", "Crédit Agricole", "cragr", "12345678901", "123456", {})

    assert result["error"] == "config_invalid"
    assert written["status"] == "auth_required"
    assert "Caisse Régionale" in written["msg"]


def test_nothing_is_written_to_woobs_backends_file(monkeypatch, tmp_path):
    """The credentials used to be copied there in clear. The loader must not
    need the file at all."""
    backends = tmp_path / "backends"
    monkeypatch.setattr(woob_config, "_BACKENDS_FILE", backends)
    w = RecordingWoob(cragr_like())
    load_backend_or_explain(w, "cragr", "inst_x", "12345678901", "123456", {"website": "www.ca-sudrhonealpes.fr"})
    assert not backends.exists()
    assert not hasattr(sync_woob, "_configure_woob")


class _FakeConn:
    def cursor(self, **kwargs):
        return object()

    def close(self):
        pass


# --- purge_legacy_backends --------------------------------------------------


LEGACY = (
    "[lcl]\n_module = lcl\nlogin = env-user\npassword = env-pw\n"
    "[inst_cm123abc]\n_module = cragr\nlogin = 12345678901\npassword = 123456\n"
    "[inst_cm456def]\n_module = bnporc\nlogin = u\npassword = p\n"
)


def test_the_institution_sections_left_by_earlier_versions_are_removed(tmp_path):
    path = tmp_path / "backends"
    path.write_text(LEGACY)
    assert woob_config.purge_legacy_backends(path) == 2
    text = path.read_text()
    assert "123456" not in text and "inst_" not in text
    assert "[lcl]\n_module = lcl\nlogin = env-user\npassword = env-pw\n" == text, "the .env LCL section stays"
    assert stat.S_IMODE(path.stat().st_mode) == 0o600


def test_the_purge_is_a_no_op_once_done(tmp_path):
    path = tmp_path / "backends"
    path.write_text("[lcl]\n_module = lcl\n")
    before = path.stat().st_mtime_ns
    assert woob_config.purge_legacy_backends(path) == 0
    assert path.stat().st_mtime_ns == before


def test_no_backends_file_is_fine(tmp_path):
    assert woob_config.purge_legacy_backends(tmp_path / "missing") == 0

