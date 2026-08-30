"""PostgreSQL helpers shared across sync scripts."""
import os
import uuid

import psycopg2
import psycopg2.extras


def get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])


# Keyword -> AccountType, matched as a case-insensitive substring of the raw
# bank-reported account label (Woob has no structured "is this a savings
# account" field of its own to read instead). Previously duplicated between
# sync_lcl.py and sync_woob.py, and had already drifted apart - sync_woob.py
# had picked up "savings" and the investment-account keywords, sync_lcl.py
# hadn't - a real bug found from a user report (some of their own real
# savings accounts, LEP in particular, were landing in "Liquidités" instead
# of "Épargne" on the dashboard's allocation chart). "lep" is the concrete
# gap that caused it: a Livret d'Épargne Populaire's raw bank label is
# often just "LEP" with no "livret" substring for the existing keyword to
# catch. Consolidated here as the single shared source both scripts import,
# so the two lists can't silently diverge again the way they just did.
ACCOUNT_TYPE_KEYWORDS = {
    "livret": "SAVINGS",
    "épargne": "SAVINGS",
    "ldd": "SAVINGS",
    "ldds": "SAVINGS",
    "pel": "SAVINGS",
    "cel": "SAVINGS",
    "lep": "SAVINGS",
    "savings": "SAVINGS",
    "bourse": "INVESTMENT",
    "pea": "INVESTMENT",
    "cto": "INVESTMENT",
    "titre": "INVESTMENT",
    "actions": "INVESTMENT",
}


def infer_account_type(label: str) -> str:
    """Guess an AccountType from a raw bank-reported account label.

    Defaults to CHECKING when nothing matches - the same "not detected as
    something more specific" fallback this always had, not a new behavior.
    """
    label_lower = label.lower()
    for keyword, account_type in ACCOUNT_TYPE_KEYWORDS.items():
        if keyword in label_lower:
            return account_type
    return "CHECKING"


def get_woob_institutions(cur) -> list[dict]:
    """Return all institutions with Woob credentials configured."""
    cur.execute(
        'SELECT id, name, "woobModule", "woobLogin", "woobPassword" FROM "Institution" '
        'WHERE "woobModule" IS NOT NULL AND "woobLogin" IS NOT NULL'
    )
    return cur.fetchall()


def get_tr_institutions(cur) -> list[dict]:
    """Institutions with UI-configured Trade Republic credentials (v2.1).

    The counterpart to get_woob_institutions above. The two sets are disjoint
    by construction: an institution carries one provider's credentials or the
    other's, so the Woob filter (woobModule IS NOT NULL) already excludes
    these, and this one excludes those.

    Says nothing about the TR_PHONE/TR_PIN connection configured in the
    environment - that one belongs to the instance owner, has no Institution
    row driving it, and keeps being synced by its own code path.
    """
    cur.execute(
        'SELECT id, name FROM "Institution" '
        'WHERE "trPhone" IS NOT NULL AND "trPin" IS NOT NULL'
    )
    return cur.fetchall()


def get_institution_id(cur, name: str) -> str | None:
    cur.execute('SELECT id FROM "Institution" WHERE name = %s', (name,))
    row = cur.fetchone()
    return row["id"] if row else None


# Trade Republic account kinds - mirrors sync_tr.py's ACC_TYPE_MAP suffixes and
# lib/domain/sync-ids.ts's TR_ACCOUNT_SUFFIXES. Kept here rather than imported
# from sync_tr to avoid a circular import: sync_tr already imports this module.
_TR_SUFFIXES = ("cash", "cto", "pea", "crypto")


def _is_trade_republic_sync_id(sync_id: str) -> bool:
    """Both TR shapes: "tr:<kind>" and "tr:<institutionId>:<kind>"."""
    if not sync_id.startswith("tr:"):
        return False
    parts = sync_id[len("tr:"):].split(":")
    return len(parts) <= 2 and parts[-1] in _TR_SUFFIXES


def upsert_account(cur, *, sync_id: str, name: str, account_type: str, institution_id: str) -> str:
    """Create account if not exists, return its DB id.

    Two different sync sources can legitimately describe the same real bank
    account under different syncId prefixes - sync_lcl.py writes
    f"lcl:{account.id}", sync_woob.py writes
    f"woob:{institution_id}:{account.id}" - both carry the same
    Woob-generated native account id as their trailing colon-delimited
    segment (confirmed empirically: "lcl:01835090481R" and
    "woob:<id>:01835090481R" for the same real LCL account). Without a
    fallback here, each source creates its own row for the same account -
    the exact incident that shipped as v1.11.2's warning banner and
    v1.11.3's manual cleanup tool, and cost a real user their transaction
    history once already (recovered by hand from a backup). Matching on
    that trailing native id, scoped to the same institution, closes it at
    the root instead of relying on UI warnings alone.

    Deliberately never rewrites an existing row's syncId once matched this
    way - whichever source's row was created first stays canonical under
    its original syncId. That keeps this idempotent regardless of sync
    order: a source whose row lost the race still sees its own exact
    syncId as "not found" on every future run and falls through to this
    same native-id match again, rather than ever creating a second
    duplicate.
    """
    cur.execute('SELECT id FROM "Account" WHERE "syncId" = %s', (sync_id,))
    row = cur.fetchone()
    if row:
        return row["id"]

    # The fallback below matches on the trailing colon-delimited segment, which
    # for LCL/Woob is a bank-generated native account id: unique per real
    # account, which is what makes the match sound.
    #
    # Trade Republic's ids do not work that way. Their trailing segment is an
    # account KIND ("cash", "pea", "cto", "crypto"), so "tr:cash" and
    # "tr:<institutionId>:cash" both end in "cash" and the fallback merges them
    # into one row by pure string coincidence - confirmed empirically, the
    # scoped upsert silently returned the env-synced account's id instead of
    # creating its own. Skipping the fallback for these keeps the per-user
    # namespacing from v2.1 meaning anything at all.
    if _is_trade_republic_sync_id(sync_id):
        native_id = None
    else:
        native_id = sync_id.rsplit(":", 1)[-1]

    if native_id is not None:
        cur.execute(
            'SELECT id FROM "Account" WHERE "institutionId" = %s AND "syncId" LIKE %s',
            (institution_id, f"%:{native_id}"),
        )
        row = cur.fetchone()
        if row:
            return row["id"]

    account_id = str(uuid.uuid4())
    cur.execute(
        """
        INSERT INTO "Account" (id, name, type, "institutionId", "syncId", "createdAt", "updatedAt")
        VALUES (%s, %s, %s, %s, %s, NOW(), NOW())
        """,
        (account_id, name, account_type, institution_id, sync_id),
    )
    return account_id


def record_balance(cur, account_id: str, balance_cents: int):
    # Only insert a new entry if the balance actually changed
    cur.execute(
        'SELECT "balanceCents" FROM "HistoricalBalance" WHERE "accountId" = %s ORDER BY "recordedAt" DESC LIMIT 1',
        (account_id,),
    )
    row = cur.fetchone()
    if row and int(row["balanceCents"]) == balance_cents:
        return
    cur.execute(
        """
        INSERT INTO "HistoricalBalance" (id, "accountId", "balanceCents", "recordedAt")
        VALUES (%s, %s, %s, NOW())
        """,
        (str(uuid.uuid4()), account_id, balance_cents),
    )


def upsert_holding(cur, *, account_id: str, ticker: str, name: str, quantity: str, last_price_cents: int):
    cur.execute(
        'SELECT id FROM "Holding" WHERE "accountId" = %s AND ticker = %s',
        (account_id, ticker),
    )
    row = cur.fetchone()
    if row:
        cur.execute(
            """
            UPDATE "Holding" SET name=%s, quantity=%s, "lastPriceCents"=%s, "updatedAt"=NOW()
            WHERE id=%s
            """,
            (name, quantity, last_price_cents, row["id"]),
        )
    else:
        cur.execute(
            """
            INSERT INTO "Holding" (id, "accountId", ticker, name, quantity, "lastPriceCents", "createdAt", "updatedAt")
            VALUES (%s, %s, %s, %s, %s, %s, NOW(), NOW())
            """,
            (str(uuid.uuid4()), account_id, ticker, name, quantity, last_price_cents),
        )


def upsert_transaction(cur, *, account_id: str, sync_id: str, date, label: str, amount_cents: int):
    """Insert transaction if not already stored (idempotent via syncId or near-duplicate check).

    Woob returns each LCL transaction twice: once as "pending" (generic label, date J)
    and once as "cleared" (full label, date J+1). We skip the new entry if an existing
    transaction on the same account with the same amount exists within a ±3-day window.
    The first one stored (cleared, with the full label) wins.
    """
    cur.execute('SELECT id FROM "Transaction" WHERE "syncId" = %s', (sync_id,))
    if cur.fetchone():
        return

    # Near-duplicate check: same account + amount within ±3 days
    cur.execute(
        """
        SELECT id FROM "Transaction"
        WHERE "accountId" = %s
          AND "amountCents" = %s
          AND date BETWEEN (%s::timestamptz - INTERVAL '3 days') AND (%s::timestamptz + INTERVAL '3 days')
        LIMIT 1
        """,
        (account_id, amount_cents, date, date),
    )
    if cur.fetchone():
        return  # likely a pending/cleared duplicate - skip

    cur.execute(
        """
        INSERT INTO "Transaction" (id, "accountId", "syncId", date, label, "amountCents", "createdAt")
        VALUES (%s, %s, %s, %s, %s, %s, NOW())
        """,
        (str(uuid.uuid4()), account_id, sync_id, date, label, amount_cents),
    )


def write_sync_log(cur, source: str, status: str, message: str | None = None):
    cur.execute(
        """
        INSERT INTO "SyncLog" (id, source, status, message, "createdAt")
        VALUES (%s, %s, %s, %s, NOW())
        """,
        (str(uuid.uuid4()), source, status, message),
    )
