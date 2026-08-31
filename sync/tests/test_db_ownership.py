"""Who a synced row belongs to, against a real PostgreSQL database.

These use a live connection on purpose. The bug they pin was invisible to
every other kind of test: db.py writes Account and SyncLog with raw SQL and
explicit column lists, so the missing "userId" was not a wrong value anyone
could assert on - it was an absent column silently taking its DB-level
default, which is the instance owner. Nothing but a real INSERT shows that.

Skipped when no database is reachable, so the normal `pytest` run stays
offline; DATABASE_URL is set in CI and in local dev.
"""

import os
import uuid

import pytest

psycopg2 = pytest.importorskip("psycopg2")
# Needed explicitly: psycopg2.extras is a submodule, not pulled in by the
# parent import. It only worked by accident of db.py importing it first.
pytest.importorskip("psycopg2.extras")

from db import (
    OWNER_USER_ID,
    get_institution_id,
    institution_owner_id,
    upsert_account,
    write_sync_log,
)


def _connect():
    url = os.environ.get("DATABASE_URL")
    if not url:
        pytest.skip("DATABASE_URL not set")
    try:
        return psycopg2.connect(url)
    except psycopg2.Error as e:  # pragma: no cover - environment dependent
        pytest.skip(f"database not reachable: {e}")


@pytest.fixture
def cur():
    """A cursor on a transaction that is always rolled back.

    Nothing these tests write ever survives, so they can run against a real
    development database without disturbing it.
    """
    conn = _connect()
    try:
        cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        yield cursor
        cursor.close()
    finally:
        conn.rollback()
        conn.close()


@pytest.fixture
def member(cur):
    """A second user, and an institution belonging to them."""
    user_id = f"test-member-{uuid.uuid4().hex[:8]}"
    cur.execute(
        """
        INSERT INTO "User" (id, username, role, "createdAt", "totpEnabled", "appLockEnabled")
        VALUES (%s, %s, 'MEMBER', NOW(), false, false)
        """,
        (user_id, f"member-{user_id}"),
    )
    institution_id = f"test-inst-{uuid.uuid4().hex[:8]}"
    cur.execute(
        """
        INSERT INTO "Institution" (id, name, "userId", "createdAt")
        VALUES (%s, %s, %s, NOW())
        """,
        (institution_id, f"Trade Republic {institution_id}", user_id),
    )
    return {"user_id": user_id, "institution_id": institution_id}


def _account_owner(cur, account_id: str) -> str:
    cur.execute('SELECT "userId" FROM "Account" WHERE id = %s', (account_id,))
    return cur.fetchone()["userId"]


def test_a_synced_account_belongs_to_the_institutions_owner(cur, member):
    # The reported bug: this landed on the instance owner instead, so the
    # member saw the account COUNT in Settings (unfiltered) and nothing on any
    # other page (all scoped to baseAccountIds).
    account_id = upsert_account(
        cur,
        sync_id=f"tr:{member['institution_id']}:cash",
        name="Compte espèces",
        account_type="CHECKING",
        institution_id=member["institution_id"],
    )

    assert _account_owner(cur, account_id) == member["user_id"]
    assert _account_owner(cur, account_id) != OWNER_USER_ID


def test_re_syncing_returns_the_same_account_rather_than_a_second_one(cur, member):
    kwargs = {
        "sync_id": f"tr:{member['institution_id']}:cash",
        "name": "Compte espèces",
        "account_type": "CHECKING",
        "institution_id": member["institution_id"],
    }
    first = upsert_account(cur, **kwargs)
    second = upsert_account(cur, **kwargs)

    assert first == second


def test_an_account_stranded_on_the_owner_is_moved_back_on_the_next_sync(cur, member):
    # Repairs rows already created by the broken version, which is the state
    # every instance that connected a member's bank before this fix is in.
    kwargs = {
        "sync_id": f"tr:{member['institution_id']}:cash",
        "name": "Compte espèces",
        "account_type": "CHECKING",
        "institution_id": member["institution_id"],
    }
    account_id = upsert_account(cur, **kwargs)
    cur.execute('UPDATE "Account" SET "userId" = %s WHERE id = %s', (OWNER_USER_ID, account_id))
    assert _account_owner(cur, account_id) == OWNER_USER_ID

    assert upsert_account(cur, **kwargs) == account_id
    assert _account_owner(cur, account_id) == member["user_id"]


def test_a_sync_log_belongs_to_the_institutions_owner(cur, member):
    # getSyncStatus() filters by userId, so a log written against the owner
    # never appears on the member's own Settings page - no status icon, and no
    # way for the Connect prompt to see that a session expired.
    write_sync_log(cur, f"tr:{member['institution_id']}", "auth_required", "Session absente")

    cur.execute(
        'SELECT "userId" FROM "SyncLog" WHERE source = %s',
        (f"tr:{member['institution_id']}",),
    )
    assert cur.fetchone()["userId"] == member["user_id"]


def test_an_env_sync_log_still_belongs_to_the_owner(cur):
    # "lcl"/"trade_republic" name no institution; those credentials are the
    # instance owner's, so the column default is right.
    source = f"lcl-test-{uuid.uuid4().hex[:8]}"
    write_sync_log(cur, source, "success", "1 compte")

    cur.execute('SELECT "userId" FROM "SyncLog" WHERE source = %s', (source,))
    assert cur.fetchone()["userId"] == OWNER_USER_ID


def test_get_institution_id_does_not_pick_a_members_institution(cur, member):
    # Institution names are unique per USER, so a member may legitimately own
    # one called "Trade Republic". An unscoped lookup would let the owner's
    # .env sync write into it.
    name = f"Shared Name {uuid.uuid4().hex[:8]}"
    cur.execute(
        'UPDATE "Institution" SET name = %s WHERE id = %s',
        (name, member["institution_id"]),
    )

    assert get_institution_id(cur, name) is None
    assert get_institution_id(cur, name, member["user_id"]) == member["institution_id"]


def test_institution_owner_id_is_none_for_an_unknown_institution(cur):
    assert institution_owner_id(cur, "does-not-exist") is None
