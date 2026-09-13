"""Python mirror of lib/domain/crypto-at-rest.ts.

The sidecar reads the same credential columns the app writes, so the two must
agree on the wire format down to the byte. That agreement is the whole risk
here: a mismatch does not fail at build or at import, it fails at 3am when a
sync tries to log into a real bank with a password it decoded wrong. It is
therefore pinned from both directions - `sync/tests/test_crypto_at_rest.py`
decrypts a vector produced by the TypeScript side, and `__tests__` does the
reverse.

What this protects and what it does not is stated once, in the TypeScript
module. Short version: a leaked dump, a stolen disk, a backup file that ends
up somewhere it should not. Not the person running the server, because an
unattended 4am sync means the server can decrypt on its own.
"""

from __future__ import annotations

import os

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

# Must match the TypeScript constants exactly.
ENCRYPTED_PREFIX = "enc:v1:"
IV_BYTES = 12
KEY_BYTES = 32
TAG_BYTES = 16

_HKDF_SALT = b"finalibaba-at-rest"
_HKDF_INFO = b"encryption-key-v1"


def _resolve_key() -> bytes:
    """ENCRYPTION_KEY when set, otherwise derived from NEXTAUTH_SECRET.

    The fallback exists so an existing instance keeps working after an upgrade
    without a new mandatory variable. HKDF rather than the raw secret, so the
    encryption key is not the same bytes as the session-signing key.
    """
    import base64

    explicit = os.environ.get("ENCRYPTION_KEY")
    if explicit:
        key = base64.b64decode(explicit)
        if len(key) != KEY_BYTES:
            raise ValueError(
                f"ENCRYPTION_KEY must be {KEY_BYTES} base64-encoded bytes, got {len(key)}. "
                "Generate one with: openssl rand -base64 32"
            )
        return key

    fallback = os.environ.get("NEXTAUTH_SECRET")
    if not fallback:
        raise ValueError(
            "Cannot decrypt at rest: set ENCRYPTION_KEY (openssl rand -base64 32) "
            "or NEXTAUTH_SECRET."
        )
    return HKDF(
        algorithm=hashes.SHA256(),
        length=KEY_BYTES,
        salt=_HKDF_SALT,
        info=_HKDF_INFO,
    ).derive(fallback.encode("utf-8"))


def is_encrypted(value: str | None) -> bool:
    """True for a value this scheme wrote, False for anything still in clear."""
    return isinstance(value, str) and value.startswith(ENCRYPTED_PREFIX)


def encrypt_secret(plain: str | None) -> str | None:
    """Encrypts for storage. Already-encrypted input passes through unchanged."""
    import base64

    if plain is None or plain == "":
        return None
    if is_encrypted(plain):
        return plain

    iv = os.urandom(IV_BYTES)
    payload = AESGCM(_resolve_key()).encrypt(iv, plain.encode("utf-8"), None)
    return (
        f"{ENCRYPTED_PREFIX}{base64.b64encode(iv).decode()}:"
        f"{base64.b64encode(payload).decode()}"
    )


def decrypt_secret(stored: str | None) -> str | None:
    """Reads a value back.

    An unprefixed value is returned as-is: mid-migration that is the normal
    state of most rows, and raising would take a working instance down while
    the migration runs.

    A prefixed value that will not decrypt raises. Returning None instead would
    reach `sync_woob.py` as "this institution has no password configured" and
    the bank would simply stop syncing with nothing in the log explaining why -
    the exact shape of failure this repository keeps recording.
    """
    import base64

    if stored is None or stored == "":
        return None
    if not is_encrypted(stored):
        return stored

    body = stored[len(ENCRYPTED_PREFIX) :]
    separator = body.find(":")
    if separator == -1:
        raise ValueError("Malformed encrypted value: no IV separator.")

    iv = base64.b64decode(body[:separator])
    payload = base64.b64decode(body[separator + 1 :])
    if len(iv) != IV_BYTES or len(payload) < TAG_BYTES:
        raise ValueError("Malformed encrypted value: wrong IV or payload length.")

    try:
        return AESGCM(_resolve_key()).decrypt(iv, payload, None).decode("utf-8")
    # Re-raised below with the cause that actually helps: a rotated key.
    except Exception as exc:
        raise ValueError(
            "Could not decrypt a stored credential. This usually means ENCRYPTION_KEY "
            "(or the NEXTAUTH_SECRET it is derived from) changed since it was written."
        ) from exc
