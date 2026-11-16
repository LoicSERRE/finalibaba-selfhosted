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


class _Loaded:
    """What get_or_load_module returns: a module whose CONFIG is read for the
    params. An empty BackendConfig declares nothing, so no param is passed."""

    def __init__(self):
        from woob.tools.backend import BackendConfig

        self.klass = type("FakeModule", (), {"CONFIG": BackendConfig()})


class FakeModulesLoader:
    def __init__(self, error=None):
        self._error = error
        self.asked = []

    def get_or_load_module(self, name):
        self.asked.append(name)
        if self._error:
            raise self._error
        return _Loaded()


class FakeModuleInfo:
    def __init__(self, installed):
        self.installed = installed

    def is_installed(self):
        return self.installed


class FakeRepositories:
    """Woob's repository index: which modules exist and which are on disk.
    `events` is shared with the loader-facing log so the order install ->
    patch -> load can be asserted."""

    def __init__(self, events, *, installed=True, known=True, install_error=None):
        self._events = events
        self._info = FakeModuleInfo(installed) if known else None
        self._install_error = install_error

    def get_module_info(self, _name):
        return self._info

    def install(self, info):
        if self._install_error:
            raise self._install_error
        self._events.append("install")
        info.installed = True


class FakeWoob:
    """Mimics what matters: the module loader that raises, and a backend
    registration that has to be checked rather than assumed."""

    def __init__(self, *, load_error=None, registers=True, installed=True, install_error=None):
        self.events = []
        self.modules_loader = FakeModulesLoader(load_error)
        self.repositories = FakeRepositories(self.events, installed=installed, install_error=install_error)
        self.backend_instances = {}
        self.storage = object()
        self._registers = registers
        self.load_calls = []

    def load_backend(self, module, name, params=None, storage=None, **kwargs):
        self.load_calls.append((module, name))
        if self._registers:
            self.backend_instances[name] = object()


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
        load_backend_or_explain(w, "caissedepargne", "inst_abc", "x", "y")
    assert "python-jose" in str(excinfo.value)
    assert "caissedepargne" in str(excinfo.value)


def test_the_backend_is_never_used_when_the_module_failed():
    # The KeyError came from reaching get_backend anyway. Nothing must be
    # registered, and load_backend must not even be attempted.
    w = FakeWoob(load_error=_module_load_error("anything"))
    with pytest.raises(ModuleUnavailableError):
        load_backend_or_explain(w, "caissedepargne", "inst_abc", "x", "y")
    assert w.load_calls == []
    assert w.backend_instances == {}


def test_a_module_that_loads_but_registers_nothing_is_still_a_failure():
    # A backend call that returns having registered nothing is still a
    # failure. Checked rather than assumed, because the symptom downstream is
    # the same KeyError.
    w = FakeWoob(registers=False)
    with pytest.raises(ModuleUnavailableError) as excinfo:
        load_backend_or_explain(w, "lcl", "inst_abc", "x", "y")
    assert "lcl" in str(excinfo.value)


def test_the_ordinary_case_still_loads_and_registers():
    # The guard must not become "never load anything", which a fix aimed only
    # at the failure would happily do.
    w = FakeWoob()
    load_backend_or_explain(w, "lcl", "inst_abc", "x", "y")
    assert w.modules_loader.asked == ["lcl"]
    assert w.load_calls == [("lcl", "inst_abc")]
    assert "inst_abc" in w.backend_instances


def test_a_module_missing_from_a_fresh_container_is_installed_then_patched_then_loaded(monkeypatch):
    # Production after a redeploy: modules live outside every volume, nothing
    # names them in Woob's backends file any more, so `woob config update`
    # installed none, and get_or_load_module raised "Module lcl is not
    # installed" for a perfectly configured bank. The patch must land before
    # the import, or the LCL 410 fix never applies again.
    import woob_patches

    w = FakeWoob(installed=False)
    monkeypatch.setattr(woob_patches, "apply", lambda m: w.events.append(f"patch {m}") or "ok")
    original = w.modules_loader.get_or_load_module
    w.modules_loader.get_or_load_module = lambda m: (w.events.append("load"), original(m))[1]

    load_backend_or_explain(w, "lcl", "lcl", "x", "y")

    assert w.events == ["install", "patch lcl", "load"]
    assert "lcl" in w.backend_instances


def test_an_installed_module_is_neither_downloaded_nor_repatched(monkeypatch):
    import woob_patches

    w = FakeWoob(installed=True)
    monkeypatch.setattr(woob_patches, "apply", lambda m: w.events.append(f"patch {m}"))
    load_backend_or_explain(w, "lcl", "lcl", "x", "y")
    assert w.events == []


def test_a_failed_download_is_explained_and_nothing_is_loaded():
    from woob.exceptions import ModuleInstallError

    w = FakeWoob(installed=False, install_error=ModuleInstallError("network unreachable"))
    with pytest.raises(ModuleUnavailableError) as excinfo:
        load_backend_or_explain(w, "lcl", "lcl", "x", "y")
    assert "lcl" in str(excinfo.value) and "network unreachable" in str(excinfo.value)
    assert w.modules_loader.asked == []
    assert w.load_calls == []


def test_the_lcl_patch_rewrites_the_bourse_call_once(tmp_path):
    import woob_patches

    browser = tmp_path / "3.7" / "woob_modules" / "lcl" / "browser.py"
    browser.parent.mkdir(parents=True)
    browser.write_text(
        "class B:\n    def iter_accounts(self):\n"
        "        if self.go_bourse_website() and self.connexion_bourse():\n            pass\n"
    )
    pattern = str(tmp_path / "*" / "woob_modules" / "lcl" / "browser.py")

    assert "applied" in woob_patches.patch_lcl_bourse_410(pattern)
    patched = browser.read_text()
    assert "except Exception:" in patched and "if _bourse_ok and self.connexion_bourse():" in patched
    compile(patched, str(browser), "exec")  # still valid Python
    assert woob_patches.patch_lcl_bourse_410(pattern) == "already applied"
    assert browser.read_text() == patched


def test_an_unexpected_loader_error_is_still_explained_rather_than_raw():
    # Not every failure is ModuleLoadError - a corrupt download raises
    # whatever it raises. It must still reach the user as a sentence.
    w = FakeWoob(load_error=RuntimeError("repository index is corrupt"))
    with pytest.raises(ModuleUnavailableError) as excinfo:
        load_backend_or_explain(w, "bred", "inst_abc", "x", "y")
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
    monkeypatch.setattr(sync_woob, "update_woob_repositories", lambda: None)
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
