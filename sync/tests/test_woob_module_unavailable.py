"""A Woob module the image cannot load, and why the old guard never fired.

Reported from a real instance: connecting Caisse d'Epargne answered 500 four
times in a row, and the container log said

    Unable to load module "caissedepargne": Module requires python package
    "python-jose" but not installed.
    ...
    KeyError: 'inst_<the institution id>'

The code already looked like it handled this:

    try:
        w.load_backends(...)
    except Exception:
        raise SetupError("Echec du chargement du module Woob ...")

**`load_backends` does not raise.** Woob logs the failure and `continue`s to
the next backend, so the except never fired, and the very next line -
`w.get_backend(name)` - died on a KeyError that reached the user as a bare 500
with no explanation. A guard that trusts a function to raise is not a guard,
which is this project's most repeated defect in a new place.

The sync path was worse than silent: it reported "No accounts returned - check
credentials or run interactive setup", sending the user to re-type credentials
that were perfectly correct.

No network and no bank here: only whether the failure is detected and what it
says.
"""

import pytest

import sync_woob
from sync_woob import ModuleUnavailableError, load_backend_or_explain


class FakeModulesLoader:
    def __init__(self, error=None):
        self._error = error
        self.asked = []

    def get_or_load_module(self, name):
        self.asked.append(name)
        if self._error:
            raise self._error
        return object()


class FakeWoob:
    """Mimics the one behaviour that matters: load_backends never raises."""

    def __init__(self, *, load_error=None, registers=True):
        self.modules_loader = FakeModulesLoader(load_error)
        self.backend_instances = {}
        self._registers = registers
        self.load_calls = []

    def load_backends(self, modules=None, names=None, **kwargs):
        self.load_calls.append((modules, names))
        if self._registers:
            for n in names or []:
                self.backend_instances[n] = object()
        # Deliberately returns normally either way - this is what woob does,
        # and assuming otherwise is the bug this file exists for.
        return dict(self.backend_instances)


def _module_load_error(message):
    from woob.exceptions import ModuleLoadError

    return ModuleLoadError("caissedepargne", message)


def test_missing_python_package_is_reported_with_the_package_name():
    # The message has to carry the package, or the operator cannot act: the
    # only fix is adding it to sync/requirements.txt and rebuilding.
    w = FakeWoob(
        load_error=_module_load_error('Module requires python package "python-jose" but not installed.')
    )
    with pytest.raises(ModuleUnavailableError) as excinfo:
        load_backend_or_explain(w, "caissedepargne", "inst_abc")
    assert "python-jose" in str(excinfo.value)
    assert "caissedepargne" in str(excinfo.value)


def test_the_backend_is_never_used_when_the_module_failed():
    # The KeyError came from reaching get_backend anyway. Nothing must be
    # registered, and load_backends must not even be attempted.
    w = FakeWoob(load_error=_module_load_error("anything"))
    with pytest.raises(ModuleUnavailableError):
        load_backend_or_explain(w, "caissedepargne", "inst_abc")
    assert w.load_calls == []
    assert w.backend_instances == {}


def test_a_module_that_loads_but_registers_nothing_is_still_a_failure():
    # load_backends can return having registered nothing - a malformed or
    # incomplete backend config. Checked rather than assumed, because the
    # symptom downstream is the same KeyError.
    w = FakeWoob(registers=False)
    with pytest.raises(ModuleUnavailableError) as excinfo:
        load_backend_or_explain(w, "lcl", "inst_abc")
    assert "lcl" in str(excinfo.value)


def test_the_ordinary_case_still_loads_and_registers():
    # The guard must not become "never load anything", which a fix aimed only
    # at the failure would happily do.
    w = FakeWoob()
    load_backend_or_explain(w, "lcl", "inst_abc")
    assert w.modules_loader.asked == ["lcl"]
    assert w.load_calls == [(["lcl"], ["inst_abc"])]
    assert "inst_abc" in w.backend_instances


def test_an_unexpected_loader_error_is_still_explained_rather_than_raw():
    # Not every failure is ModuleLoadError - a corrupt download raises
    # whatever it raises. It must still reach the user as a sentence.
    w = FakeWoob(load_error=RuntimeError("repository index is corrupt"))
    with pytest.raises(ModuleUnavailableError) as excinfo:
        load_backend_or_explain(w, "bred", "inst_abc")
    assert "bred" in str(excinfo.value)


def test_the_sync_path_reports_unsupported_rather_than_blaming_credentials(monkeypatch):
    """The status a module-level failure writes to SyncLog.

    `auth_required` would send the user round a reconnect loop that cannot
    succeed, and `checkSyncFailures` level-triggers it every 24h. Nothing the
    user types fixes a package the image does not ship, so it is `unsupported`:
    alerted once, and the Connect button hidden.
    """
    written = {}

    monkeypatch.setattr(sync_woob.setup_locks, "is_setup_in_progress", lambda _i: False)
    monkeypatch.setattr(sync_woob, "_configure_woob", lambda *a, **k: None)
    monkeypatch.setattr(sync_woob, "make_woob", lambda: FakeWoob(load_error=_module_load_error('needs "chompjs"')))
    monkeypatch.setattr(sync_woob, "get_conn", lambda: _FakeConn())

    def fake_fail(cur, conn, source, status, msg):
        written.update(status=status, msg=msg)

    monkeypatch.setattr(sync_woob, "_fail", fake_fail)

    result = sync_woob.run("inst-1", "Caisse d'Epargne", "caissedepargne", "x", "y")

    assert result["error"] == "module_unavailable"
    assert written["status"] == "unsupported"
    assert "chompjs" in written["msg"]
    assert "credentials" not in written["msg"].lower()


class _FakeConn:
    def cursor(self, **kwargs):
        return object()

    def close(self):
        pass
