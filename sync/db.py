"""PostgreSQL helpers shared across sync scripts."""
import hashlib
import os
import uuid
from decimal import Decimal

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


def replace_holdings(cur, account_db_id: str, holdings: list[dict]) -> int:
    """Make an account's holdings match what the bank just reported.

    Builds on upsert_holding rather than repeating its SQL - this module is the
    shared helper layer, and Trade Republic already writes positions through it.
    What is added here is the part a full sync needs and a per-position write
    does not: lines that disappeared are deleted, so a sold fund cannot linger
    and keep inflating the account.

    Scoped to one account, and only ever called for a synced one, where the UI
    already hides manual holding edits.
    """
    seen = []
    for h in holdings:
        upsert_holding(
            cur,
            account_id=account_db_id,
            ticker=h["ticker"],
            name=h.get("name"),
            quantity=h["quantity"],
            last_price_cents=h["last_price_cents"],
            cost_basis_cents=h.get("cost_basis_cents"),
        )
        seen.append(h["ticker"])

    if seen:
        cur.execute(
            'DELETE FROM "Holding" WHERE "accountId" = %s AND ticker <> ALL(%s)',
            (account_db_id, seen),
        )
    return len(seen)


def mark_holdings_reported(cur, account_db_id: str):
    """Record that the bank just reported this account's lines, and clear any
    stale mark - a statement that carries lines is the confirmation a previous
    empty one was waiting for."""
    cur.execute(
        'UPDATE "Account" SET "holdingsReportedAt" = NOW(), "holdingsStaleSince" = NULL WHERE id = %s',
        (account_db_id,),
    )


def mark_holdings_stale(cur, account_db_id: str):
    """Record that the bank returned no lines for an account that has some.

    Only ever set once: the useful date is the FIRST statement that came back
    empty, not the most recent one, and moving it forward on every sync would
    make a months-old silence look like it started this morning. An account
    with no holdings is left alone - there is nothing to be unsure about.
    """
    cur.execute(
        'UPDATE "Account" SET "holdingsStaleSince" = NOW()'
        ' WHERE id = %s AND "holdingsStaleSince" IS NULL'
        ' AND EXISTS (SELECT 1 FROM "Holding" h WHERE h."accountId" = %s)',
        (account_db_id, account_db_id),
    )


def promote_account_to_investment(cur, account_db_id: str) -> bool:
    """Retype an account as INVESTMENT once the bank reported holdings for it.

    Only from CHECKING, which is infer_account_type's "nothing matched"
    fallback - never from SAVINGS or anything a keyword or a person chose, so
    this can correct a guess without overriding a decision. Holdings are a far
    better signal than a label: "PEE SOPRA STERIA GROUP" matches no keyword,
    but an account reporting fund lines is an investment account whatever it is
    called.
    """
    cur.execute(
        'UPDATE "Account" SET type = \'INVESTMENT\' WHERE id = %s AND type = \'CHECKING\'',
        (account_db_id,),
    )
    return cur.rowcount > 0


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


# The fixed-id user row the v2.0 migration creates and backfills everything to.
# Mirrors lib/domain/users.ts's OWNER_USER_ID.
OWNER_USER_ID = "user-owner"


def get_institution_id(cur, name: str, user_id: str = OWNER_USER_ID) -> str | None:
    """An institution by name, scoped to whoever owns it.

    Institution names are unique per USER, not globally (@@unique([userId,
    name])), so a member creating their own "Trade Republic" is perfectly
    legal - and an unscoped name lookup would then be a coin flip. This is
    only ever called by the .env-configured syncs, whose credentials belong to
    the instance owner, so the owner is the right default and the only value
    passed today.
    """
    cur.execute(
        'SELECT id FROM "Institution" WHERE name = %s AND "userId" = %s',
        (name, user_id),
    )
    row = cur.fetchone()
    return row["id"] if row else None


def institution_owner_id(cur, institution_id: str) -> str | None:
    """Who an institution belongs to. None if it no longer exists."""
    cur.execute('SELECT "userId" FROM "Institution" WHERE id = %s', (institution_id,))
    row = cur.fetchone()
    return row["userId"] if row else None


def _sync_log_owner(cur, source: str) -> str | None:
    """The user a SyncLog row belongs to, derived from its source string.

    Per-institution sources are "woob:<institutionId>", "tr:<institutionId>"
    and "tr-realtime:<institutionId>"; the .env ones are bare words ("lcl",
    "trade_republic", "trade_republic_realtime") and belong to the owner, which
    is the column default. Deriving it here rather than adding a parameter to
    every call site means the ~10 existing callers became correct without being
    touched, and a future one cannot forget it.

    Mirrors lib/domain/sync-sources.ts's sourceInstitutionId - the two must
    agree on which prefixes carry an institution id, since that is what decides
    whose SyncLog row a sync writes. "tr-realtime:" is a sibling prefix rather
    than a "tr:<id>:realtime" segment precisely because of the colon check
    below: a third segment reads as "not an institution id" here, so the nested
    shape would have silently filed every listener row under the owner.
    """
    for prefix in ("tr-realtime:", "woob:", "tr:"):
        if source.startswith(prefix):
            institution_id = source[len(prefix):]
            if institution_id and ":" not in institution_id:
                return institution_owner_id(cur, institution_id)
    return None


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


def _realign_owner(cur, account_id: str, institution_id: str) -> str:
    """Move an already-synced account back to whoever owns its institution.

    Repairs rows created before this module set "userId" at all, when every
    synced account silently landed on the instance owner. A member who
    connected their own Trade Republic ended up with accounts they could see
    the COUNT of in Settings and nothing else, anywhere - the count is
    unfiltered, every other read scopes to baseAccountIds(viewer).

    Self-healing on the next sync rather than a one-off script, because the
    invariant it restores is simply true: nothing in the app ever moves a
    synced account away from its institution's owner, so a mismatch can only
    be this bug. Co-ownership is unaffected - that lives in AccountCoOwner,
    not in this column.
    """
    owner_id = institution_owner_id(cur, institution_id)
    if owner_id:
        cur.execute(
            'UPDATE "Account" SET "userId" = %s WHERE id = %s AND "userId" <> %s',
            (owner_id, account_id, owner_id),
        )
    return account_id


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
        return _realign_owner(cur, row["id"], institution_id)

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
            return _realign_owner(cur, row["id"], institution_id)

    # A synced account belongs to whoever owns its institution.
    #
    # This column used to be left to its DB-level default, which is the
    # instance owner - correct while only the owner could sync anything, and
    # wrong the moment v2.1 let anyone connect their own Trade Republic. A
    # member's sync then created accounts owned by the ADMIN: Settings showed
    # "4 comptes" against their institution, because that count is unfiltered,
    # and every other page showed nothing, because they all scope to
    # baseAccountIds(viewer). Reported from a real instance exactly that way.
    owner_id = institution_owner_id(cur, institution_id)
    account_id = str(uuid.uuid4())
    cur.execute(
        """
        INSERT INTO "Account" (id, name, type, "institutionId", "userId", "syncId", "createdAt", "updatedAt")
        VALUES (%s, %s, %s, %s, COALESCE(%s, 'user-owner'), %s, NOW(), NOW())
        """,
        (account_id, name, account_type, institution_id, owner_id, sync_id),
    )
    return account_id


def to_cents(amount) -> int:
    """Cents from a decimal amount, ROUNDED rather than truncated.

    `int(Decimal(...) * 100)` truncates, and always downward: 500 shares at
    134.5678 EUR record 67 280 EUR instead of 67 283.90. Systematic, silent, and
    in one direction, so it never averages out. sync_tr.py already documented
    this rule against its own positions ("to_integral_value() (rounds,
    ROUND_HALF_EVEN) not int() (truncates)"); sync_woob.py did the opposite on
    every figure it wrote, which is exactly the divergence this module's own
    "do not duplicate inline" note exists to prevent.

    ROUND_HALF_EVEN is Decimal's default and matches the TypeScript display
    layer's own Decimal(...).round(), so a stored figure and the one on screen
    agree instead of drifting by a cent.
    """
    return int((Decimal(str(amount)) * 100).to_integral_value())


def record_balance(cur, account_id: str, balance_cents: int):
    # Only insert a new entry if the balance actually changed
    # id breaks the tie, same as every app-side read of this table: recordedAt
    # is not unique, so two rows on one instant otherwise left "the latest
    # balance" up to whatever order the database happened to return.
    cur.execute(
        'SELECT "balanceCents" FROM "HistoricalBalance" WHERE "accountId" = %s'
        ' ORDER BY "recordedAt" DESC, id DESC LIMIT 1',
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


def upsert_holding(cur, *, account_id: str, ticker: str, name: str, quantity: str, last_price_cents: int, cost_basis_cents: int | None = None):
    cur.execute(
        'SELECT id FROM "Holding" WHERE "accountId" = %s AND ticker = %s',
        (account_id, ticker),
    )
    row = cur.fetchone()
    if row:
        cur.execute(
            """
            UPDATE "Holding" SET name=%s, quantity=%s, "lastPriceCents"=%s,
                   -- Only ever fills a cost basis, never erases one: the bank
                   -- does not always report a purchase price, and the user may
                   -- have typed it in themselves.
                   "costBasisCents"=COALESCE(%s, "costBasisCents"), "updatedAt"=NOW()
            WHERE id=%s
            """,
            (name, quantity, last_price_cents, cost_basis_cents, row["id"]),
        )
    else:
        cur.execute(
            """
            INSERT INTO "Holding" (id, "accountId", ticker, name, quantity, "lastPriceCents", "costBasisCents", "createdAt", "updatedAt")
            VALUES (%s, %s, %s, %s, %s, %s, %s, NOW(), NOW())
            """,
            (str(uuid.uuid4()), account_id, ticker, name, quantity, last_price_cents, cost_basis_cents),
        )


def legacy_composite_sync_id(base: str, date, amount_cents: int) -> str:
    """The pre-label synthesised id, kept only so already-stored rows are still
    recognised. Never written for a new row."""
    return f"{base}:{date.isoformat()}:{amount_cents}"


def composite_sync_id(base: str, date, amount_cents: int, label: str, occurrence: int) -> str:
    """A synthesised id for a bank that gives us no transaction id of its own.

    Date and amount alone are NOT unique: two transfers of the same amount on
    the same day collide, and the second one was being refused as a duplicate
    it never was. Measured on a real instance - the account whose bank DOES
    supply ids held 142 same-day/same-amount pairs, while the id-less account
    held zero across its whole history, which is not luck.

    The label discriminates the common real case (two transfers the same day
    to different destinations read differently on the statement), and
    `occurrence` covers the rest by numbering repeats within one sync pass.

    The label fingerprint is appended for EVERY occurrence, including the
    first, even though that means no new id matches an already-stored one -
    upsert_transaction() looks the legacy id up separately for exactly that
    reason. The alternative, leaving the first occurrence bare so it keeps
    matching, would make the ids order-dependent: whichever of two same-day
    transactions the bank happened to return first would claim the bare id,
    and a reordering on the next run would swap both ids and duplicate both
    rows. Order-independence is worth one extra lookup.

    `occurrence` remains order-dependent, but only ever applies to two rows
    sharing a date, an amount AND a label, which nothing can tell apart.
    """
    suffix = f":{_label_fingerprint(label)}" if label else ""
    if occurrence > 1:
        suffix += f":{occurrence}"
    return f"{base}:{date.isoformat()}:{amount_cents}{suffix}"


def _label_fingerprint(label: str) -> str:
    """8 hex chars of the normalised label, to tell two same-day, same-amount
    movements apart inside a syncId.

    SHA-1 on purpose, and it must stay SHA-1. This is a content fingerprint,
    never a signature: it authenticates nothing, guards no secret, and is
    truncated to 32 bits anyway, so collision resistance was never the
    property being bought. Semgrep flags it as an insecure hash (triaged
    2026-09-12, its only finding on this repo).

    Switching to SHA-256 is the dangerous "fix". The output goes into
    Transaction.syncId, which is PERSISTED, so a different digest gives the
    same movement a different id, and the next sync inserts it again beside
    the row already there. Duplicate transactions are what v2.9.2, v2.9.3 and
    v2.9.4 were each spent on.
    """
    # nosemgrep: python.lang.security.insecure-hash-algorithms.insecure-hash-algorithm-sha1
    return hashlib.sha1(_normalise_label(label).encode("utf-8")).hexdigest()[:8]


def _normalise_label(label: str) -> str:
    return " ".join(label.lower().split())


# The placeholder labels LCL shows before an operation settles, after which
# the same movement is restated with its real counterparty. Mirrors
# GENERIC_TRANSFER_LABELS in lib/domain/auto-categorize.ts, which was written
# from the same observation on the same bank - keep the two lists in step.
#
# Measured, not assumed: on a production account, a 161,01 EUR benefit
# payment arrived as "VIREMENT SEPA" and came back as "VIREMENT CAF DE L
# HERAULT" on the next sync, and two 600 EUR transfers did the same the day
# before. Every earlier month held exactly one row per such payment, which is
# how we know these are restatements and not second movements.
_GENERIC_TRANSFER_LABELS = frozenset({"virement sepa", "virement instantane"})


def is_generic_transfer_label(label: str) -> bool:
    return _normalise_label(label) in _GENERIC_TRANSFER_LABELS


def _stored_row(row, key, index):
    """psycopg2 returns a dict or a tuple depending on the cursor factory."""
    return row[key] if isinstance(row, dict) else row[index]


def _already_stored(cur, sync_id: str, legacy_sync_id: str | None, label: str) -> bool:
    """Exact-id dedup: the bank's own id, or the pre-label composite one.

    The legacy lookup ALSO compares the label, which is the difference between
    the recovery working and half working: the legacy id is label-blind by
    construction, so both halves of a colliding same-day pair resolve to it and
    the surviving row answered for its lost twin as well.
    """
    cur.execute('SELECT id FROM "Transaction" WHERE "syncId" = %s', (sync_id,))
    if cur.fetchone():
        return True
    if not legacy_sync_id:
        return False
    cur.execute(
        'SELECT id FROM "Transaction" WHERE "syncId" = %s AND lower(btrim(label)) = lower(btrim(%s))',
        (legacy_sync_id, label),
    )
    return cur.fetchone() is not None


def _absorbed_by_nearby(cur, *, account_id, amount_cents, date, label, near_duplicate) -> bool:
    """Whether a movement already stored under a DIFFERENT id covers this one.

    Needed because a synthesised id contains the transaction's DATE, and a bank
    restates that date once an operation settles - yielding a new id for a row
    already stored. See upsert_transaction for the three modes.
    """
    if near_duplicate == "off":
        return False

    cur.execute(
        """
        SELECT id, label FROM "Transaction"
        WHERE "accountId" = %s
          AND "amountCents" = %s
          AND date BETWEEN (%s::timestamptz - INTERVAL '3 days') AND (%s::timestamptz + INTERVAL '3 days')
        ORDER BY date
        """,
        (account_id, amount_cents, date, date),
    )
    nearby = cur.fetchall()
    if not nearby:
        return False

    # A source that supplies real ids but describes one movement with several
    # of them: the amount window alone is the answer, labels differ by design.
    if near_duplicate == "amount":
        return True

    for row in nearby:
        if _normalise_label(_stored_row(row, "label", 1)) == _normalise_label(label):
            return True  # same movement, restated on an adjacent date

    # Same movement, described better: adopt the real counterparty rather than
    # storing it a second time.
    for row in nearby:
        stored_label = _stored_row(row, "label", 1)
        if is_generic_transfer_label(stored_label) and not is_generic_transfer_label(label):
            cur.execute(
                'UPDATE "Transaction" SET label = %s WHERE id = %s',
                (label, _stored_row(row, "id", 0)),
            )
            return True
    return False


def upsert_transaction(
    cur,
    *,
    account_id: str,
    sync_id: str,
    date,
    label: str,
    amount_cents: int,
    legacy_sync_id: str | None = None,
    near_duplicate: str = "amount",
    is_securities_movement: bool = False,
    source_event_type: str | None = None,
):
    """Insert a transaction unless it is already stored.

    Dedup is exact whenever the bank supplies a transaction id. Everything else
    exists for sources that supply NONE (LCL through Woob), where the id is
    synthesised from the row's own fields - see composite_sync_id.

    `near_duplicate` picks how hard to look for a movement already stored under
    a different id. Three modes, because two source families fail in opposite
    directions:

      "label"  - id-less sources. Same amount AND label within three days.
      "amount" - sources that supply ids but describe one movement with
                 several of them. Same amount within three days, label ignored.
                 The default.
      "off"    - nothing but the id.

    Trade Republic needs "amount", which cost a release to learn: a purchase
    inside a PEA emits both a "Kauforder" and a "PEA" event, same amount, same
    day, different ids. Measured against the bank's own balance, the account
    moved -325,41 EUR while the stored rows summed to -3 470,52 with the window
    off.

    The window must NOT fire on amount alone for an id-less source: that
    version dropped ten real movements totalling ~3 850 EUR on one instance, a
    300 EUR transfer to a livret suppressing a 300 EUR transfer to a broker
    three days later. Requiring the labels to match without the restatement
    rule was the opposite regression, three duplicates in one production day.

    **Accepted residue**: two transactions with the same amount AND label
    within three days on an id-less source still merge, as does a genuine
    second movement arriving while the first still shows a placeholder label.
    Telling those apart needs an identity the bank does not give us.
    """
    if _already_stored(cur, sync_id, legacy_sync_id, label):
        return
    if _absorbed_by_nearby(
        cur,
        account_id=account_id,
        amount_cents=amount_cents,
        date=date,
        label=label,
        near_duplicate=near_duplicate,
    ):
        return

    cur.execute(
        """
        INSERT INTO "Transaction" (id, "accountId", "syncId", date, label, "amountCents",
                                   "isSecuritiesMovement", "sourceEventType", "createdAt")
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, NOW())
        """,
        (str(uuid.uuid4()), account_id, sync_id, date, label, amount_cents, is_securities_movement,
         source_event_type),
    )


def write_sync_log(cur, source: str, status: str, message: str | None = None):
    # Same omission as upsert_account had, with the same consequence:
    # getSyncStatus() filters by userId, so a member's own sync status was
    # written against the owner and never appeared on their Settings page -
    # no status icon, and no way for the Connect prompt to know a session had
    # expired. NULL falls back to the column default, the owner, which is
    # correct for every .env-configured source.
    cur.execute(
        """
        INSERT INTO "SyncLog" (id, source, status, message, "userId", "createdAt")
        VALUES (%s, %s, %s, %s, COALESCE(%s, 'user-owner'), NOW())
        """,
        (str(uuid.uuid4()), source, status, message, _sync_log_owner(cur, source)),
    )
