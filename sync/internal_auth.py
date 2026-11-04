"""The bearer token both containers present to each other.

Python mirror of lib/services/internal-auth.ts - same HKDF inputs, so both
sides derive the same token from NEXTAUTH_SECRET with nothing new to
configure. Change one and the other together (tests/test_internal_auth.py
pins the value both must produce).

A token derived from the secret rather than the secret itself: it used to be
NEXTAUTH_SECRET verbatim in every Authorization header, so anything that ever
saw one of those requests - an APP_SERVICE_URL pointed at the wrong host, a
proxy logging headers - held the key that signs every session. The derived
value only opens these internal routes.

It gates both directions: app -> sync had no authentication at all, so any
container on the Docker network could start a bank sync or answer a pending
2FA step.
"""
import base64
import hmac
import os

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

_HKDF_SALT = b"finalibaba-internal-api"
_HKDF_INFO = b"bearer-v1"


def internal_api_token() -> str | None:
    """None when NEXTAUTH_SECRET is unset - callers then skip the call, and
    the gate below accepts nothing."""
    secret = os.environ.get("NEXTAUTH_SECRET")
    if not secret:
        return None
    raw = HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=_HKDF_SALT,
        info=_HKDF_INFO,
    ).derive(secret.encode("utf-8"))
    # Unpadded base64url, the exact string Node's toString("base64url") gives.
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def auth_headers() -> dict[str, str]:
    token = internal_api_token()
    return {"Authorization": f"Bearer {token}"} if token else {}


def is_authorized(authorization: str | None) -> bool:
    """Fails closed: no secret configured means no request is internal."""
    expected = internal_api_token()
    if not expected or not authorization or not authorization.startswith("Bearer "):
        return False
    return hmac.compare_digest(authorization[len("Bearer "):].encode(), expected.encode())
