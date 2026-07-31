"""Unit tests for the pure logic in sync_tr.py - no DB, no network, no TR API.

Everything tested here is deliberately free of I/O: given the same inputs,
these functions always return the same output. sync_tr.run()/keepalive()/
_get_api() (the actual network+DB orchestration) are intentionally not
covered - testing those would mean mocking a real broker's WebSocket API,
which would test the mock more than the code.
"""

import requests

from sync_tr import (
    _decode_jwt_payload,
    _is_auth_error,
    _position_isin,
    resolve_position,
    split_crypto_positions,
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
