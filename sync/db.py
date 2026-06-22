"""PostgreSQL helpers shared across sync scripts."""
import os
import uuid
import psycopg2
import psycopg2.extras


def get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])


def get_institution_id(cur, name: str) -> str | None:
    cur.execute('SELECT id FROM "Institution" WHERE name = %s', (name,))
    row = cur.fetchone()
    return row["id"] if row else None


def get_woob_institutions(cur) -> list[dict]:
    """Return all institutions with Woob credentials configured."""
    cur.execute(
        'SELECT id, name, "woobModule", "woobLogin", "woobPassword" FROM "Institution" '
        'WHERE "woobModule" IS NOT NULL AND "woobLogin" IS NOT NULL'
    )
    return cur.fetchall()


def upsert_account(cur, *, sync_id: str, name: str, account_type: str, institution_id: str) -> str:
    """Create account if not exists, return its DB id."""
    cur.execute('SELECT id FROM "Account" WHERE "syncId" = %s', (sync_id,))
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
        return  # likely a pending/cleared duplicate — skip

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
