"""A bank backend that blips must not fail the whole scheduled sync.

Real production evidence, not a hypothetical: LCL returned a plain 502 three
separate times in one day, on a different endpoint each time (accounts,
cards, life insurance), and every one of those cleared on a manual retry
within about a minute. Left unretried, one such blip failed the whole
scheduled sync and fired a sync-failure alert for something that would have
worked seconds later.

ScrapingBlocked is the guard on the other side: it subclasses
BrowserUnavailable too, but means the bank detected and blocked automation -
retrying immediately is exactly the wrong response to that, so it must skip
the retry loop entirely.

No network and no bank: only _iter_accounts_with_retry's own control flow.
"""

import pytest

import sync_woob


def test_a_transient_bank_unavailable_error_is_retried_before_giving_up(monkeypatch):
    from woob.exceptions import BrowserUnavailable

    monkeypatch.setattr(sync_woob.time, "sleep", lambda _delay: None)
    calls = {"n": 0}

    def flaky(*_args, **_kwargs):
        calls["n"] += 1
        if calls["n"] < 3:
            raise BrowserUnavailable("502 Server Error: Bad Gateway")
        return ["ok"]

    monkeypatch.setattr(sync_woob, "_iter_accounts", flaky)

    result = sync_woob._iter_accounts_with_retry(None, "backend", "LCL")

    assert result == ["ok"]
    assert calls["n"] == 3, "must retry twice before succeeding on the third attempt"


def test_a_persistently_unavailable_backend_still_gives_up_eventually(monkeypatch):
    """The guard against the retry becoming an infinite loop: a bank that is
    genuinely down, not just blipping, must still surface as a failure."""
    from woob.exceptions import BrowserUnavailable

    monkeypatch.setattr(sync_woob.time, "sleep", lambda _delay: None)
    calls = {"n": 0}

    def always_down(*_args, **_kwargs):
        calls["n"] += 1
        raise BrowserUnavailable("502 Server Error: Bad Gateway")

    monkeypatch.setattr(sync_woob, "_iter_accounts", always_down)

    with pytest.raises(BrowserUnavailable):
        sync_woob._iter_accounts_with_retry(None, "backend", "LCL")

    assert calls["n"] == len(sync_woob._TRANSIENT_RETRY_DELAYS_S) + 1, (
        "must attempt once, then once per configured retry delay, no more"
    )


def test_scraping_blocked_is_not_retried(monkeypatch):
    """A detected-and-blocked automation attempt must not be retried seconds
    later - that looks more like a bot, not less."""
    from woob.exceptions import ScrapingBlocked

    calls = {"n": 0}

    def always_blocked(*_args, **_kwargs):
        calls["n"] += 1
        raise ScrapingBlocked()

    monkeypatch.setattr(sync_woob, "_iter_accounts", always_blocked)
    with pytest.raises(ScrapingBlocked):
        sync_woob._iter_accounts_with_retry(None, "backend", "Some Bank")

    assert calls["n"] == 1, "must not retry a detected block"


def test_a_non_transient_error_is_not_retried(monkeypatch):
    """The retry is scoped to BrowserUnavailable specifically - anything else
    (a genuine crash, an auth failure) must reach _fetch_accounts on the
    first attempt, unchanged from before this retry existed."""
    calls = {"n": 0}

    def boom(*_args, **_kwargs):
        calls["n"] += 1
        raise RuntimeError("module blew up")

    monkeypatch.setattr(sync_woob, "_iter_accounts", boom)

    with pytest.raises(RuntimeError):
        sync_woob._iter_accounts_with_retry(None, "backend", "Some Bank")

    assert calls["n"] == 1
