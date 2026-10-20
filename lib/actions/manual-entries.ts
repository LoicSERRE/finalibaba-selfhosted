"use server";

import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { revalidateTransactions } from "@/lib/actions/revalidate";
import { assertManualAccountEligible } from "@/lib/actions/manual-account-guard";
import { autoCategorizeTransactions } from "@/lib/actions/auto-categorize";
import {
  anchorBalanceFor,
  hasBalanceBefore,
  atNoonUtc,
  isManualEntry,
  MANUAL_SYNC_PREFIX,
  validateManualMovement,
  type ManualEntryError,
} from "@/lib/domain/manual-entries";
import { amountColumns, balanceColumns, isBaseCurrency, nativeOf, shiftSnapshots } from "@/lib/domain/currency";
import { rateToEurOn } from "@/lib/services/exchange-rate";

/**
 * Editing an account nobody else writes to. Every write is guarded by
 * assertManualAccountEligible: a Server Action is reachable whatever the UI
 * renders, and letting one shift a bank's own recorded balances destroys real
 * history rather than merely annoying.
 *
 * Failures come back as VALUES with stable keys - a thrown Server Action error
 * is an opaque digest in production. Authorization still throws: reaching for
 * someone else's account is not an expected error.
 */
export type ManualEntryResult =
  | { ok: true }
  | { ok: false; error: ManualEntryError | "not_found" | "not_manual" | "rate_unavailable" };

/**
 * Rows from `at` on, moved by a native amount. On an EUR account this is the
 * single atomic increment it always was; on a foreign one each row's EUR
 * value is recomputed from its shifted native figure and its own rate, one
 * row at a time (dev-docs/currencies.md: shifting the EUR values by one
 * converted amount would re-price every past day at today's rate).
 */
async function shiftFrom(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  accountId: string,
  currency: string,
  at: Date,
  delta: bigint,
) {
  if (isBaseCurrency(currency)) {
    await tx.historicalBalance.updateMany({
      where: { accountId, recordedAt: { gte: at } },
      data: { balanceCents: { increment: delta } },
    });
    return;
  }
  const rows = await tx.historicalBalance.findMany({
    where: { accountId, recordedAt: { gte: at } },
    select: { id: true, balanceCents: true, nativeBalanceCents: true, fxRate: true },
  });
  for (const row of shiftSnapshots(rows, delta)) {
    await tx.historicalBalance.update({
      where: { id: row.id },
      data: { balanceCents: row.balanceCents, nativeBalanceCents: row.nativeBalanceCents },
    });
  }
}

/**
 * A spend or top-up: one Transaction plus the balance movement it implies, both
 * writes or neither. One without the other gives a ledger that does not add up
 * to the figure above it, or a number that moves with nothing to explain it.
 */
export async function recordManualMovement(
  accountId: string,
  input: { amountCents: number; label: string; date: string; categoryId?: string | null },
): Promise<ManualEntryResult> {
  const { currency } = await assertManualAccountEligible(accountId);

  const problem = validateManualMovement(input);
  if (problem) return { ok: false, error: problem };

  const at = atNoonUtc(input.date);
  const delta = BigInt(Math.round(input.amountCents));
  // The amount is in the account's currency, converted at its own day's rate.
  const rate = await rateToEurOn(currency, at);
  if (rate === null) return { ok: false, error: "rate_unavailable" };

  const refusal = await prisma.$transaction(async (tx) => {
    const stored = await tx.historicalBalance.findMany({
      where: { accountId },
      select: { recordedAt: true, balanceCents: true, nativeBalanceCents: true },
    });
    // The arithmetic below runs on native figures - identical to the EUR
    // ones on an EUR account.
    const snapshots = stored.map((s) => ({ recordedAt: s.recordedAt, balanceCents: nativeOf(s) }));

    // Nothing is written before this check, so returning here is a clean exit
    // rather than a rollback. An account with no balance on or before this day
    // has no arithmetic to offer: deriving one from zero would state a balance
    // the app was never told.
    if (!hasBalanceBefore(snapshots, at)) return "no_prior_balance" as const;

    // Computed from the rows BEFORE the shift below, and only ever from those
    // strictly earlier than this entry - see anchorBalanceFor's own note on
    // why the latest row overall would be wrong for a backdated entry.
    const anchor = anchorBalanceFor(snapshots, at, delta);

    // Every belief held from this day onward was off by the amount, so they
    // all move together and the days before it do not.
    await shiftFrom(tx, accountId, currency, at, delta);

    if (anchor !== null) {
      await tx.historicalBalance.create({ data: { accountId, recordedAt: at, ...balanceColumns(currency, anchor, rate) } });
    }

    await tx.transaction.create({
      data: {
        accountId,
        syncId: `${MANUAL_SYNC_PREFIX}${randomUUID()}`,
        date: at,
        label: input.label.trim().slice(0, 500),
        ...amountColumns(currency, delta, rate),
        categoryId: input.categoryId || null,
      },
    });
    return null;
  });
  if (refusal) return { ok: false, error: refusal };

  // Only ever touches rows still sitting at categoryId null, so an explicit
  // pick above is left alone - same sweep importTransactions runs, for the
  // same reason: a label this account has already learned should not come
  // back uncategorised.
  await autoCategorizeTransactions(accountId);

  revalidateTransactions(accountId, [input.categoryId]);
  return { ok: true };
}

/**
 * "My card says 87,50 EUR, make it so." A snapshot and no Transaction, because
 * nothing happened a budget should see - the figure was simply wrong.
 *
 * Fixed to TODAY: correcting a past day leaves every later snapshot
 * contradicting it, and both ways out are surprising. A backdated fix is what
 * recordManualMovement is for.
 */
export async function setManualBalance(accountId: string, balanceCents: number): Promise<ManualEntryResult> {
  const { currency } = await assertManualAccountEligible(accountId);

  if (!Number.isFinite(balanceCents)) return { ok: false, error: "amount_required" };

  const at = atNoonUtc(new Date().toISOString().slice(0, 10));
  const rate = await rateToEurOn(currency, at);
  if (rate === null) return { ok: false, error: "rate_unavailable" };
  const value = balanceColumns(currency, BigInt(Math.round(balanceCents)), rate);

  await prisma.$transaction(async (tx) => {
    // No unique constraint on (accountId, recordedAt), so this is a read then
    // a write rather than an upsert. Inside the transaction, so a second
    // correction on the same day cannot land a duplicate row for it.
    const existing = await tx.historicalBalance.findFirst({
      where: { accountId, recordedAt: at },
      select: { id: true },
    });
    if (existing) {
      await tx.historicalBalance.update({ where: { id: existing.id }, data: value });
    } else {
      await tx.historicalBalance.create({ data: { accountId, recordedAt: at, ...value } });
    }
  });

  revalidateTransactions(accountId);
  return { ok: true };
}

/**
 * Removes an entry and undoes what it did to the balance. Scoped by syncId
 * prefix, never any transaction on the account: a CSV or synced row never
 * shifted a balance, so reversing one invents a movement that never happened.
 *
 * The anchor row is left behind - after the shift it holds exactly the
 * preceding balance and draws no step, which beats deciding whether a later
 * entry has come to depend on it.
 */
export async function deleteManualEntry(transactionId: string): Promise<ManualEntryResult> {
  const row = await prisma.transaction.findUnique({
    where: { id: transactionId },
    select: { id: true, accountId: true, amountCents: true, nativeAmountCents: true, date: true, syncId: true, categoryId: true },
  });
  if (!row) return { ok: false, error: "not_found" };

  // Ownership and eligibility, from the account the row actually belongs to
  // rather than anything the caller supplied.
  const { currency } = await assertManualAccountEligible(row.accountId);

  if (!isManualEntry(row.syncId)) return { ok: false, error: "not_manual" };

  await prisma.$transaction(async (tx) => {
    await shiftFrom(tx, row.accountId, currency, row.date, -(row.nativeAmountCents ?? row.amountCents));
    await tx.transaction.delete({ where: { id: row.id } });
  });

  revalidateTransactions(row.accountId, [row.categoryId]);
  return { ok: true };
}
