"""The gate between the two containers (internal_auth.py).

Mirrors __tests__/internal-auth.test.ts: the token below is pinned in both,
since the app and the sync service derive it separately and a drift between
them refuses every internal call in both directions.
"""
import pytest

import internal_auth
from internal_auth import auth_headers, internal_api_token, is_authorized

SECRET = "s" * 43
# Derived from the dummy SECRET above, so it opens nothing.
TOKEN = "loE5GJCCqu2DXj9JVJCxDnqDVuu7_FnzwoJ210JJbL4"  # gitleaks:allow


@pytest.fixture(autouse=True)
def _secret(monkeypatch):
    monkeypatch.setenv("NEXTAUTH_SECRET", SECRET)


class TestToken:
    def test_matches_the_typescript_derivation(self):
        assert internal_api_token() == TOKEN

    def test_is_not_the_secret_itself(self):
        # The point of deriving it: the session-signing key stays off the wire.
        assert internal_api_token() != SECRET
        assert SECRET not in auth_headers()["Authorization"]

    def test_none_and_no_header_when_unset(self, monkeypatch):
        monkeypatch.delenv("NEXTAUTH_SECRET")
        assert internal_api_token() is None
        assert auth_headers() == {}


class TestIsAuthorized:
    def test_accepts_the_token(self):
        assert is_authorized(f"Bearer {TOKEN}")

    @pytest.mark.parametrize(
        "header",
        [
            None,
            "",
            "Bearer ",
            f"Bearer {SECRET}",
            f"Basic {TOKEN}",
            TOKEN,
            f"bearer {TOKEN}",
            f"Bearer {TOKEN[:20]}",
            f"Bearer {TOKEN}x",
        ],
    )
    def test_rejects(self, header):
        assert not is_authorized(header)

    def test_fails_closed_without_a_secret(self, monkeypatch):
        monkeypatch.delenv("NEXTAUTH_SECRET")
        assert not is_authorized(f"Bearer {TOKEN}")
        assert not is_authorized("Bearer ")


class TestServiceGate:
    """The middleware itself, called the way Starlette calls it. No HTTP
    client: starlette's TestClient needs httpx, which nothing else here does."""

    @staticmethod
    def _call(path: str, method: str = "GET", authorization: str | None = None) -> int:
        import asyncio

        from starlette.requests import Request
        from starlette.responses import Response

        from main import require_internal_token

        headers = [(b"authorization", authorization.encode())] if authorization is not None else []
        request = Request({"type": "http", "method": method, "path": path, "headers": headers, "query_string": b""})

        async def call_next(_request):
            return Response(status_code=200)

        return asyncio.run(require_internal_token(request, call_next)).status_code

    @pytest.mark.parametrize(
        ("method", "path"),
        [
            ("POST", "/sync/all/async"),
            ("POST", "/sync/institution/abc/setup/complete"),
            ("GET", "/status"),
            ("GET", "/woob/modules"),
            ("GET", "/realtime/status"),
        ],
    )
    def test_refuses_an_unauthenticated_call(self, method, path):
        assert self._call(path, method) == 401

    def test_refuses_the_raw_secret(self):
        assert self._call("/sync/running", authorization=f"Bearer {SECRET}") == 401

    def test_lets_the_token_through(self):
        assert self._call("/sync/running", authorization=f"Bearer {TOKEN}") == 200

    def test_healthcheck_stays_open(self):
        # docker-compose.yml's healthcheck calls it with no header.
        assert self._call("/health") == 200

    def test_a_path_that_merely_starts_like_health_is_gated(self):
        assert self._call("/health/../status") == 401
        assert self._call("/healthz") == 401

    def test_is_registered_on_the_app(self):
        # The function being correct is worthless if a refactor drops the
        # decorator: then nothing calls it.
        from main import app, require_internal_token
        assert any(m.kwargs.get("dispatch") is require_internal_token for m in app.user_middleware)


def test_module_has_no_other_secret_source():
    # Guards against a quick "fix" that reads a second variable on one side
    # only, which would silently desynchronise the two containers.
    import inspect
    assert inspect.getsource(internal_auth).count("os.environ.get(") == 1
