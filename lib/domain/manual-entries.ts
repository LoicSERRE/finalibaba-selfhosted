/**
 * Manual entries on an account nobody else writes to.
 *
 * A meal-voucher card, a cash envelope, a bank the sync cannot reach: these
 * accounts have no external source of truth, so the only way their balance
 * moves is a person saying so. This module holds the arithmetic for that, with
 * no I/O, so the one part that is easy to get wrong is testable on its own.
 *
 * **The fact everything here follows from**: for a fiat account the balance on
 * screen is `history[0].balanceCents` - the most recent HistoricalBalance row
 * (see lib/domain/account-detail.ts). It is NEVER re-derived by summing
 * transactions. So recording "I spent 12 EUR" has to write BOTH a Transaction
 * (or budgets, categorisation and recurring detection never see it) AND a
 * balance snapshot (or the figure on screen does not move). Writing only one of
 * the two produces the two failures worth naming: a balance that changes with
 * no explanation, or a list of movements that does not add up to the balance
 * printed above it.
 *
 * **Why a past date shifts the rows after it.** A snapshot is what the app
 * believed the balance was on that day. Learning about a movement on the 7th
 * means every belief held from the 7th onward was too high (or too low) by that
 * amount, so they all move by the same delta and the days before it do not.
 * Rewriting recorded history would be indefensible on a synced account, where
 * the rows came from a bank; here they only ever came from this same person,
 * which is exactly why the eligibility guard restricts all of this to accounts
 * with no sync.
 */

/** One HistoricalBalance row, narrowed to what the arithmetic needs. */
export type BalanceSnapshot = { recordedAt: Date; balanceCents: bigint };

/** Every manual write lands at noon UTC, the convention CSV import already
 *  uses, so a date never shifts a day under a negative UTC offset. */
export function atNoonUtc(isoDate: string): Date {
  return new Date(`${isoDate}T12:00:00.000Z`);
}

/**
 * The balance a new anchor row at `at` must carry, or null when a row already
 * sits on that exact instant and will be shifted instead.
 *
 * Split out from the caller because it is the only genuinely error-prone step:
 * the anchor is built from the balance *strictly before* the entry, never from
 * the latest row overall, which would be wrong for any backdated entry.
 */
export function anchorBalanceFor(
  snapshots: readonly BalanceSnapshot[],
  at: Date,
  deltaCents: bigint,
): bigint | null {
  const stamp = at.getTime();
  if (snapshots.some((s) => s.recordedAt.getTime() === stamp)) return null;

  let previous = BigInt(0);
  let previousAt = -Infinity;
  for (const s of snapshots) {
    const t = s.recordedAt.getTime();
    if (t < stamp && t > previousAt) {
      previous = s.balanceCents;
      previousAt = t;
    }
  }
  return previous + deltaCents;
}

export type ManualMovementInput = {
  /** Signed: negative is a spend, positive is a top-up. Never zero. */
  amountCents: number;
  label: string;
  /** YYYY-MM-DD. */
  date: string;
};

export type ManualEntryError = "amount_required" | "label_required" | "future_date" | "invalid_date";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Returns the first problem with a movement, or null.
 *
 * Keys rather than sentences, so both locales render it and a Server Action can
 * hand it back as a value - Next replaces a thrown Server Action error with an
 * opaque digest in production, which this repo has already paid for twice.
 */
export function validateManualMovement(input: ManualMovementInput): ManualEntryError | null {
  if (!ISO_DATE_RE.test(input.date) || Number.isNaN(atNoonUtc(input.date).getTime())) return "invalid_date";
  // A future-dated entry would immediately become the account's displayed
  // balance, since history[0] is simply the newest row - the same reason CSV
  // balance import rejects one.
  if (input.date > new Date().toISOString().slice(0, 10)) return "future_date";
  if (!Number.isFinite(input.amountCents) || Math.round(input.amountCents) === 0) return "amount_required";
  if (input.label.trim().length === 0) return "label_required";
  return null;
}

/**
 * `Transaction.syncId` prefix marking a row this person typed in themselves.
 *
 * It is what makes a manual entry reversible: deleting one has to undo its
 * effect on the balance, and doing that to a CSV-imported row would be wrong,
 * because CSV import deliberately never touches HistoricalBalance (the two
 * importers are separate on purpose - see "CSV import" in CLAUDE.md). Same
 * shape as the `csv_` prefix that importer already uses.
 */
export const MANUAL_SYNC_PREFIX = "manual_";

export function isManualEntry(syncId: string | null | undefined): boolean {
  return typeof syncId === "string" && syncId.startsWith(MANUAL_SYNC_PREFIX);
}
