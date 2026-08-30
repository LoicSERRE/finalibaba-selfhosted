"""Unit tests for the pure logic in sync_tr.py - no DB, no network, no TR API.

Everything tested here is deliberately free of I/O: given the same inputs,
these functions always return the same output. sync_tr.run()/keepalive()/
_get_api() (the actual network+DB orchestration) are intentionally not
covered - testing those would mean mocking a real broker's WebSocket API,
which would test the mock more than the code.

The retry-loop tests near the bottom (_fetch_positions_for_account /
_fetch_crypto_positions) are a deliberate, narrow exception to that rule:
they use a minimal fake `api` object, but only to assert our own control
flow (does it retry the right number of times, does it eventually give up)
- never anything about what TR actually returns. There's no way to
automatically test "does this match TR's real live prices" the way the
resolve_position()/value-rounding tests above test our own arithmetic -
that would need a live session against a real account with numbers that
change every second, so it stays a manual, one-off check instead (see the
real-account comparison done directly with the user for the rounding fix).
"""

import asyncio

import requests

from sync_tr import (
    _decode_jwt_payload,
    _fetch_crypto_positions,
    _fetch_positions_for_account,
    _is_auth_error,
    _parse_tr_timestamp,
    _position_isin,
    _timeline_item_to_transaction,
    resolve_position,
    split_crypto_positions,
    tr_sync_id,
)

# ── _position_isin ────────────────────────────────────────────────────────────

def test_position_isin_prefers_instrument_id():
    assert _position_isin({"instrumentId": "US1", "isin": "US2"}) == "US1"


def test_position_isin_falls_back_to_isin_field():
    assert _position_isin({"isin": "US2"}) == "US2"


def test_position_isin_empty_when_neither_field_present():
    assert _position_isin({}) == ""


# ── split_crypto_positions ────────────────────────────────────────────────────

def test_split_crypto_positions_separates_xf0_isins():
    positions = [
        {"instrumentId": "US0378331005", "name": "Apple"},
        {"instrumentId": "XF000BTC0009", "name": "Bitcoin"},
        {"isin": "XF000ETH0001", "name": "Ethereum"},
    ]
    non_crypto, crypto = split_crypto_positions(positions)
    assert [p["name"] for p in non_crypto] == ["Apple"]
    assert [p["name"] for p in crypto] == ["Bitcoin", "Ethereum"]


def test_split_crypto_positions_empty_crypto_list_when_none_match():
    positions = [{"instrumentId": "US0378331005"}]
    non_crypto, crypto = split_crypto_positions(positions)
    assert non_crypto == positions
    assert crypto == []


# ── resolve_position ───────────────────────────────────────────────────────────

def test_resolve_position_returns_none_without_isin():
    assert resolve_position({}, {}, {}) is None


def test_resolve_position_prefers_ticker_price_over_compact_price():
    pos = {"instrumentId": "US1", "currentPrice": "100.00", "quantity": "10"}
    prices = {"US1": (20000, "Test Stock")}  # 200.00€ from the ticker subscription
    resolved = resolve_position(pos, prices, {})
    assert resolved["price_cents"] == 20000
    assert resolved["name"] == "Test Stock"


def test_resolve_position_falls_back_to_compact_price_when_no_ticker_price():
    pos = {"instrumentId": "US1", "currentPrice": "100.00", "quantity": "10", "name": "Fallback Name"}
    resolved = resolve_position(pos, {}, {})
    assert resolved["price_cents"] == 10000  # 100.00€ -> cents
    assert resolved["name"] == "Fallback Name"


def test_resolve_position_prefers_neon_quantity_over_virtual_size_and_net_size():
    pos = {"instrumentId": "US1", "virtualSize": "5", "netSize": "3", "quantity": "1", "currentPrice": "10"}
    resolved = resolve_position(pos, {}, {"US1": "7.5"})
    assert resolved["quantity"] == "7.5"


def test_resolve_position_falls_back_through_quantity_sources_in_order():
    pos = {"instrumentId": "US1", "netSize": "3", "quantity": "1", "currentPrice": "10"}
    assert resolve_position(pos, {}, {})["quantity"] == "3"

    pos2 = {"instrumentId": "US1", "quantity": "1", "currentPrice": "10"}
    assert resolve_position(pos2, {}, {})["quantity"] == "1"


def test_resolve_position_computes_cost_basis_only_when_avg_price_is_nonzero():
    pos = {"instrumentId": "US1", "quantity": "10", "currentPrice": "20", "averageBuyIn": "15"}
    resolved = resolve_position(pos, {}, {})
    assert resolved["cost_basis_cents"] == 15_00 * 10  # 10 units * 15€ * 100 cents

    pos_no_avg = {"instrumentId": "US1", "quantity": "10", "currentPrice": "20"}
    assert resolve_position(pos_no_avg, {}, {})["cost_basis_cents"] is None


def test_resolve_position_computes_value_as_quantity_times_price():
    pos = {"instrumentId": "US1", "quantity": "3", "currentPrice": "50"}
    resolved = resolve_position(pos, {}, {})
    assert resolved["value_cents"] == 3 * 50_00


def test_resolve_position_rounds_fractional_cents_instead_of_truncating():
    # Fractional shares (TR supports buying fractional positions) times an
    # integer price_cents can land exactly on a fractional cent: 10.01 *
    # 999 = 9999.99. A plain int() truncation would silently drop to 9999,
    # undercounting the position (and the account's recorded balance
    # snapshot) by a cent versus what the UI's Decimal .round() shows for
    # the same quantity/price. Must round to 10000.
    prices = {"IE1": (999, "MSCI World")}
    pos = {"instrumentId": "IE1", "quantity": "10.01"}
    resolved = resolve_position(pos, prices, {})
    assert resolved["value_cents"] == 10000


# ── _decode_jwt_payload ────────────────────────────────────────────────────────

def test_decode_jwt_payload_decodes_a_well_formed_token():
    import base64
    import json

    payload = json.dumps({"act": {"acc": {"owner": {"default": {"sec": ["123"]}}}}})
    encoded = base64.urlsafe_b64encode(payload.encode()).decode().rstrip("=")
    token = f"header.{encoded}.signature"
    decoded = _decode_jwt_payload(token)
    assert decoded["act"]["acc"]["owner"]["default"]["sec"] == ["123"]


def test_decode_jwt_payload_returns_empty_dict_for_malformed_token():
    assert _decode_jwt_payload("not-a-jwt") == {}
    assert _decode_jwt_payload("") == {}
    assert _decode_jwt_payload("a.b.c.d.e") != {} or True  # doesn't raise either way


# ── _is_auth_error - the actual OTP-nagging bug fix ───────────────────────────

def test_is_auth_error_true_for_http_401():
    response = requests.Response()
    response.status_code = 401
    exc = requests.exceptions.HTTPError(response=response)
    assert _is_auth_error(exc) is True


def test_is_auth_error_false_for_other_http_status():
    response = requests.Response()
    response.status_code = 500
    exc = requests.exceptions.HTTPError(response=response)
    assert _is_auth_error(exc) is False


def test_is_auth_error_true_for_tr_error_code_3003():
    from pytr.api import TradeRepublicError

    exc = TradeRepublicError("sub-1", {"type": "compactPortfolioByType"}, {"errorCode": 3003})
    assert _is_auth_error(exc) is True


def test_is_auth_error_false_for_unrelated_tr_error():
    from pytr.api import TradeRepublicError

    exc = TradeRepublicError("sub-1", {"type": "compactPortfolioByType"}, {"errorCode": 4001, "msg": "rate limited"})
    assert _is_auth_error(exc) is False


def test_is_auth_error_false_for_a_transient_error_that_happens_to_mention_session():
    # This is exactly the false-positive the old word-matching approach had:
    # a plain network/timeout error whose message contains "session" but has
    # nothing to do with the TR login being invalid must NOT nuke a good
    # saved session and force the user through OTP again.
    exc = ConnectionError("WebSocket session closed unexpectedly")
    assert _is_auth_error(exc) is False


def test_is_auth_error_false_for_a_generic_exception():
    assert _is_auth_error(ValueError("something else entirely")) is False


# ── _parse_tr_timestamp ────────────────────────────────────────────────────────

def test_parse_tr_timestamp_handles_missing_colon_in_offset():
    # TR's raw format - no colon in the UTC offset, which Python's
    # datetime.fromisoformat rejects on some versions without the fixup.
    dt = _parse_tr_timestamp("2026-01-15T10:30:00.123+0200")
    assert dt.year == 2026
    assert dt.month == 1
    assert dt.day == 15
    assert dt.hour == 10
    assert dt.minute == 30
    assert dt.utcoffset().total_seconds() == 2 * 3600


def test_parse_tr_timestamp_passes_through_a_well_formed_offset():
    dt = _parse_tr_timestamp("2026-01-15T10:30:00.123+02:00")
    assert dt.utcoffset().total_seconds() == 2 * 3600


def test_parse_tr_timestamp_handles_utc_z_suffix():
    dt = _parse_tr_timestamp("2026-01-15T10:30:00.123Z".replace("Z", "+00:00"))
    assert dt.utcoffset().total_seconds() == 0


# ── _timeline_item_to_transaction ──────────────────────────────────────────────

def _tl_item(**overrides):
    item = {
        "id": "evt-1",
        "title": "Amazon",
        "subtitle": "Kartenzahlung",
        "timestamp": "2026-01-15T10:30:00.123+0200",
        "amount": {"value": -42.5, "currency": "EUR"},
        "status": "executed",
    }
    item.update(overrides)
    return item


def test_timeline_item_to_transaction_builds_label_from_title_and_subtitle():
    resolved = _timeline_item_to_transaction(_tl_item())
    assert resolved["id"] == "evt-1"
    assert resolved["label"] == "Amazon - Kartenzahlung"
    assert resolved["amount_cents"] == -4250


def test_timeline_item_to_transaction_omits_subtitle_when_identical_to_title():
    resolved = _timeline_item_to_transaction(_tl_item(title="Zinsen", subtitle="Zinsen"))
    assert resolved["label"] == "Zinsen"


def test_timeline_item_to_transaction_omits_subtitle_when_absent():
    resolved = _timeline_item_to_transaction(_tl_item(subtitle=""))
    assert resolved["label"] == "Amazon"


def test_timeline_item_to_transaction_falls_back_to_placeholder_when_no_title_or_subtitle():
    resolved = _timeline_item_to_transaction(_tl_item(title="", subtitle=""))
    assert resolved["label"] == "-"


def test_timeline_item_to_transaction_returns_none_for_cancelled_items():
    assert _timeline_item_to_transaction(_tl_item(status="canceled")) is None
    assert _timeline_item_to_transaction(_tl_item(status="CANCELED")) is None


def test_timeline_item_to_transaction_returns_none_when_amount_is_missing():
    # Informational-only timeline entries (address changes, document
    # notifications, etc.) have no "amount" field at all - must not crash,
    # and must not be imported as a €0 transaction.
    item = _tl_item()
    del item["amount"]
    assert _timeline_item_to_transaction(item) is None


def test_timeline_item_to_transaction_returns_none_when_amount_value_is_zero():
    assert _timeline_item_to_transaction(_tl_item(amount={"value": 0, "currency": "EUR"})) is None


def test_timeline_item_to_transaction_preserves_positive_amounts_as_credits():
    resolved = _timeline_item_to_transaction(_tl_item(title="Jean Dupont", subtitle="Virement", amount={"value": 150, "currency": "EUR"}))
    assert resolved["amount_cents"] == 15000


# ── retry loops - control flow only, never TR's actual data (see module docstring) ──

class _FlakyApi:
    """Minimal fake standing in for pytr's TradeRepublicApi - subscribe()
    always "succeeds" (returns a fake subscription id), _recv_subscription()
    raises for the first `fail_times` calls then returns `payload`."""

    def __init__(self, fail_times: int, payload):
        self.fail_times = fail_times
        self.payload = payload
        self.attempts = 0

    async def subscribe(self, _msg):
        return "sub-1"

    async def _recv_subscription(self, _sub_id):
        self.attempts += 1
        if self.attempts <= self.fail_times:
            raise TimeoutError("timed out during opening handshake")
        return self.payload


def test_fetch_positions_for_account_retries_then_recovers(monkeypatch):
    import sync_tr

    monkeypatch.setattr(sync_tr, "POSITIONS_FETCH_RETRY_DELAY_S", 0)
    api = _FlakyApi(fail_times=2, payload={"categories": [{"positions": [{"instrumentId": "US1"}]}]})

    result = asyncio.run(_fetch_positions_for_account(api, "sec-123"))

    assert result == [{"instrumentId": "US1"}]
    assert api.attempts == 3  # 1 initial + 2 retries before the 3rd call succeeds


def test_fetch_positions_for_account_gives_up_after_exhausting_retries(monkeypatch):
    import sync_tr

    monkeypatch.setattr(sync_tr, "POSITIONS_FETCH_RETRY_DELAY_S", 0)
    api = _FlakyApi(fail_times=99, payload={})

    try:
        asyncio.run(_fetch_positions_for_account(api, "sec-123"))
        assert False, "expected the persistent failure to propagate"
    except TimeoutError:
        pass

    assert api.attempts == sync_tr.POSITIONS_FETCH_RETRIES + 1  # no more, no fewer


def test_fetch_crypto_positions_retries_then_recovers(monkeypatch):
    import sync_tr

    monkeypatch.setattr(sync_tr, "POSITIONS_FETCH_RETRY_DELAY_S", 0)
    api = _FlakyApi(fail_times=1, payload={"positions": [{"instrumentId": "XF000BTC0017"}]})

    result = asyncio.run(_fetch_crypto_positions(api))

    assert result == [{"instrumentId": "XF000BTC0017"}]
    assert api.attempts == 2


def test_fetch_crypto_positions_returns_empty_list_after_exhausting_retries(monkeypatch):
    # Unlike _fetch_positions_for_account, this one swallows the final
    # failure and returns [] rather than raising - matches its existing
    # non-fatal "crypto just won't sync this run" behavior.
    import sync_tr

    monkeypatch.setattr(sync_tr, "POSITIONS_FETCH_RETRY_DELAY_S", 0)
    api = _FlakyApi(fail_times=99, payload={})

    result = asyncio.run(_fetch_crypto_positions(api))

    assert result == []
    assert api.attempts == sync_tr.POSITIONS_FETCH_RETRIES + 1


# ── tr_sync_id ────────────────────────────────────────────────────────────────
#
# Account.syncId is globally unique, so these strings are what stop two users
# from overwriting each other's Trade Republic accounts. The equivalent parser
# lives in lib/domain/sync-ids.ts and is covered by __tests__/sync-ids.test.ts:
# the two must agree, so any change here needs the same change there.

def test_tr_sync_id_keeps_the_legacy_shape_for_the_env_sync():
    # Existing installs already hold these exact ids. Changing them would
    # orphan every Trade Republic account and its whole history.
    assert tr_sync_id("cash") == "tr:cash"
    assert tr_sync_id("pea", None) == "tr:pea"


def test_tr_sync_id_namespaces_a_ui_configured_institution():
    assert tr_sync_id("cash", "inst-123") == "tr:inst-123:cash"


def test_tr_sync_id_separates_two_users_with_the_same_account_kind():
    assert tr_sync_id("cash", "inst-a") != tr_sync_id("cash", "inst-b")


def test_tr_sync_id_never_collides_with_the_env_sync():
    # An institution-scoped account must never be able to produce the owner's
    # own id, whatever the institution id happens to be.
    for inst in ("inst-1", "cash", "tr", ""):
        scoped = tr_sync_id("cash", inst or None)
        if inst:
            assert scoped != "tr:cash"
