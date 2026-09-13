"""The sidecar must read exactly what the app wrote, and the reverse.

A format mismatch between the two languages does not fail at import or at
build. It fails when a scheduled sync hands a bank a password it decoded
wrong, which looks like an ordinary auth error. So the interop direction is
tested against real values produced by the other runtime, not against a
hand-written string that could drift with the implementation it was copied
from.
"""

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from crypto_at_rest import (
    ENCRYPTED_PREFIX,
    decrypt_secret,
    encrypt_secret,
    is_encrypted,
)

REPO = Path(__file__).resolve().parents[2]
KEY = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8="  # 32 bytes, base64


@pytest.fixture(autouse=True)
def _key(monkeypatch):
    monkeypatch.setenv("ENCRYPTION_KEY", KEY)
    monkeypatch.delenv("NEXTAUTH_SECRET", raising=False)


def _node(script: str, env_extra: dict | None = None, drop: tuple = ()) -> str:
    """Runs a snippet against the real TypeScript module.

    `drop` really removes a variable: merging a dict that merely lacks a key
    leaves the inherited one in place, which silently had Node using the
    explicit key while Python used the derived one - the mismatch looked like
    a broken HKDF and was a broken test.
    """
    env = {**os.environ, **(env_extra or {})}
    for name in drop:
        env.pop(name, None)
    result = subprocess.run(
        ["node", "--input-type=module", "-e", script],
        capture_output=True, text=True, cwd=REPO, env=env, check=False,
    )
    if result.returncode != 0:
        pytest.skip(f"node unavailable or module not loadable: {result.stderr[:200]}")
    return result.stdout.strip()


class TestRoundTrip:
    def test_returns_exactly_what_went_in(self):
        for secret in ["hunter2", "accents éàü", "0000", "x" * 500]:
            assert decrypt_secret(encrypt_secret(secret)) == secret

    def test_plaintext_never_visible_in_the_stored_value(self):
        stored = encrypt_secret("SuperSecretBankPassword")
        assert "SuperSecretBankPassword" not in stored
        assert stored.startswith(ENCRYPTED_PREFIX)

    def test_same_input_encrypts_differently_each_time(self):
        a, b = encrypt_secret("same"), encrypt_secret("same")
        assert a != b
        assert decrypt_secret(a) == decrypt_secret(b) == "same"


class TestMigrationSafety:
    def test_does_not_double_wrap(self):
        once = encrypt_secret("pin1234")
        assert encrypt_secret(once) == once

    def test_unmigrated_plaintext_reads_through(self):
        assert decrypt_secret("still-in-clear") == "still-in-clear"
        assert is_encrypted("still-in-clear") is False

    def test_empty_and_absent_map_to_none(self):
        for empty in (None, ""):
            assert encrypt_secret(empty) is None
            assert decrypt_secret(empty) is None


class TestFailsLoudly:
    def test_wrong_key_raises_rather_than_returning_none(self, monkeypatch):
        stored = encrypt_secret("bank-password")
        monkeypatch.setenv("ENCRYPTION_KEY", "H" * 42 + "=")
        with pytest.raises(ValueError):
            decrypt_secret(stored)

    def test_tampered_payload_is_rejected(self):
        import base64

        stored = encrypt_secret("bank-password")
        iv, payload = stored[len(ENCRYPTED_PREFIX) :].split(":", 1)
        raw = bytearray(base64.b64decode(payload))
        raw[0] ^= 0xFF
        tampered = f"{ENCRYPTED_PREFIX}{iv}:{base64.b64encode(bytes(raw)).decode()}"
        with pytest.raises(ValueError):
            decrypt_secret(tampered)


class TestCrossLanguage:
    """The property the whole scheme rests on."""

    def test_python_reads_what_typescript_wrote(self):
        out = _node(
            "import {encryptSecret} from './lib/domain/crypto-at-rest.ts';"
            "console.log(encryptSecret('mot-de-passe-banque-éàü'));"
        )
        assert out.startswith(ENCRYPTED_PREFIX)
        assert decrypt_secret(out) == "mot-de-passe-banque-éàü"

    def test_typescript_reads_what_python_wrote(self):
        stored = encrypt_secret("pin-trade-republic-1234")
        out = _node(
            "import {decryptSecret} from './lib/domain/crypto-at-rest.ts';"
            f"console.log(decryptSecret({json.dumps(stored)}));"
        )
        assert out == "pin-trade-republic-1234"

    def test_both_derive_the_same_key_from_NEXTAUTH_SECRET(self, monkeypatch):
        # The fallback path is what an upgrading instance actually uses, so it
        # needs the same cross-language guarantee as the explicit key.
        # monkeypatch throughout: hand-rolled os.environ save/restore around an
        # autouse monkeypatch fixture is how the first version of this test
        # ended up disagreeing with a manual run of the very same steps.
        secret = "an-existing-instance-secret"
        out = _node(
            "import {encryptSecret} from './lib/domain/crypto-at-rest.ts';"
            "console.log(encryptSecret('derived-key-probe'));",
            env_extra={"NEXTAUTH_SECRET": secret},
            drop=("ENCRYPTION_KEY",),
        )
        monkeypatch.delenv("ENCRYPTION_KEY", raising=False)
        monkeypatch.setenv("NEXTAUTH_SECRET", secret)
        assert decrypt_secret(out) == "derived-key-probe"
