"""PostgreSQL helpers shared across sync scripts."""
import hashlib
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
):
    """Insert transaction if not already stored.

    Dedup is exact whenever the bank gives us a transaction id: `sync_id`
    carries it and nothing else is consulted. The rest of this function only
    exists for sources that give us NO id (LCL through Woob is the one that
    matters), where the id has to be synthesised from the transaction's own
    fields - see composite_sync_id().

    `legacy_sync_id` is the pre-label composite id. Rows stored before that
    format changed still carry it, so it is looked up as well, or the first
    sync after the change would re-insert an account's entire history.

    That lookup ALSO matches on the label, which is not defensive detail - it
    is the difference between the fix working and only half working. The
    legacy id is label-blind by construction, so both halves of a colliding
    same-day pair resolve to it: matching on the id alone meant the surviving
    row answered for its lost twin too, and the twin stayed suppressed
    forever. Verified against production after the first deployment - not one
    of the ten known-missing movements had come back, because each one kept
    matching the legacy id of the row that had displaced it. Comparing the
    label lets the twin through while the row that genuinely IS the stored
    one still matches.

    `near_duplicate` picks how hard to look for a movement already stored
    under a different id, and the three modes exist because two sources fail
    in opposite directions:

      "label"  - id-less sources (LCL through Woob). Same amount AND same
                 label within three days, plus the restatement rule below.
      "amount" - sources that DO supply ids but describe one cash movement
                 with several of them. Same amount within three days, label
                 ignored. The default, because it is the older, safer
                 behaviour.
      "off"    - nothing but the id.

    Trade Republic needs "amount", which cost a release to learn. Reasoning
    that a real transaction id makes the window pure downside there, it was
    switched off - and a purchase inside a PEA turned out to emit both a
    "Kauforder" and a "PEA" event, same amount, same day, different ids.
    Measured against the bank's own balance for one day: the account moved
    -325,41 EUR, the transactions summed to -334,14 EUR with the window on
    and -3 470,52 EUR with it off.

    What the window protects against is a real mechanism: a
    synthesised id contains the transaction's DATE, and a bank can restate
    that date by a day once the operation settles, which yields a different
    id for a transaction already stored. It deliberately no longer fires on
    amount alone.

    That amount-only version was a silent data-loss bug, measured against a
    real production database: a 300 EUR transfer to a livret suppressed a
    300 EUR transfer to a broker made three days later, because it never
    looked at the label. Ten movements totalling ~3 850 EUR had been dropped
    that way on one instance, and each one left its counterpart on the other
    account permanently unmatchable, which is what made internal transfers
    show up as income. It also contradicted this project's own stated rule
    for CSV import, that two legitimately different transactions can share a
    fingerprint and must not be auto-merged.

    A restatement is absorbed rather than merged away: when that window finds
    a row still carrying one of LCL's placeholder labels and the incoming row
    names a real counterparty, the stored row's LABEL is updated in place. It
    is the same movement, described better.

    Requiring the labels to match without that step was itself a regression,
    caught one day after deploying it by comparing two production dumps: a
    161,01 EUR benefit payment and two 600 EUR transfers had each gained a
    twin, because "VIREMENT SEPA" and its restatement are the same movement
    under two names. Three duplicates in a single day, accumulating every
    half hour - which is why the amount-only window, wrong as it was about
    genuinely distinct movements, was not simply removable.

    Accepted, documented residue: two transactions with the SAME amount AND
    the same label within three days, on a source with no bank id, still
    merge - as does a genuine second movement arriving while the first is
    still shown under a placeholder label. Distinguishing those needs an
    identity the bank does not give us.
    """
    cur.execute('SELECT id FROM "Transaction" WHERE "syncId" = %s', (sync_id,))
    if cur.fetchone():
        return

    if legacy_sync_id:
        cur.execute(
            'SELECT id FROM "Transaction" WHERE "syncId" = %s AND lower(btrim(label)) = lower(btrim(%s))',
            (legacy_sync_id, label),
        )
        if cur.fetchone():
            return

    if near_duplicate != "off":
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

        if near_duplicate == "amount":
            if nearby:
                return  # one movement the source describes more than once
            nearby = []

        for row in nearby:
            stored_label = row["label"] if isinstance(row, dict) else row[1]
            if _normalise_label(stored_label) == _normalise_label(label):
                return  # same movement, restated on an adjacent date

        # Same movement, described better: adopt the real counterparty rather
        # than storing it a second time.
        for row in nearby:
            stored_id = row["id"] if isinstance(row, dict) else row[0]
            stored_label = row["label"] if isinstance(row, dict) else row[1]
            if is_generic_transfer_label(stored_label) and not is_generic_transfer_label(label):
                cur.execute('UPDATE "Transaction" SET label = %s WHERE id = %s', (label, stored_id))
                return

    cur.execute(
        """
        INSERT INTO "Transaction" (id, "accountId", "syncId", date, label, "amountCents", "createdAt")
        VALUES (%s, %s, %s, %s, %s, %s, NOW())
        """,
        (str(uuid.uuid4()), account_id, sync_id, date, label, amount_cents),
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
