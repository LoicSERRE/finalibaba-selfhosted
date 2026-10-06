"""sync_activity: what the app's "sync in progress" badge now reads.

The badge used to guess, from SyncLog rows appearing, when a sync had ended;
these pin that the service's own answer is exact - including after a failure,
which is the case a guess gets wrong (a crashed sync writes no success row).
"""
import threading

import pytest

import sync_activity
from sync_activity import is_running, running, tracked, tracking


@pytest.fixture(autouse=True)
def _clean():
    sync_activity._reset_for_tests()
    yield
    sync_activity._reset_for_tests()


def test_a_key_is_running_only_inside_its_block():
    assert running() == []
    with tracking("all"):
        assert is_running("all")
        assert running() == ["all"]
    assert not is_running("all")
    assert running() == []


def test_a_failing_sync_still_stops_counting_as_running():
    # The case the old SyncLog guess got wrong: a crash writes no row, so the
    # badge waited out its timeout. Here the block's exit clears it regardless.
    with pytest.raises(RuntimeError), tracking("woob:inst-1"):
        raise RuntimeError("bank unreachable")
    assert not is_running("woob:inst-1")


def test_the_same_key_twice_stays_running_until_both_end():
    # The 30-min cron and a page-load trigger can overlap on one key.
    with tracking("all"):
        with tracking("all"):
            pass
        assert is_running("all"), "the first run is still going"
    assert not is_running("all")


def test_the_decorator_derives_per_institution_keys_from_arguments():
    seen = []

    @tracked(lambda inst_id, *_rest: f"woob:{inst_id}")
    def run_woob(inst_id, name, module):
        seen.append(running())

    run_woob("inst-7", "Ma banque", "lcl")
    assert seen == [["woob:inst-7"]]
    assert running() == []


def test_the_decorator_keeps_the_wrapped_function_name():
    @tracked("lcl")
    def _run_lcl():
        return "done"

    assert _run_lcl() == "done"
    assert _run_lcl.__name__ == "_run_lcl"


def test_it_is_safe_across_threads():
    start = threading.Barrier(8)

    def worker():
        start.wait()
        for _ in range(200):
            with tracking("all"):
                pass

    threads = [threading.Thread(target=worker) for _ in range(8)]
    for th in threads:
        th.start()
    for th in threads:
        th.join()
    assert running() == []
