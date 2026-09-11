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
export type ManualEntryResult = { ok: true } | { ok: false; error: ManualEntryError | "not_found" | "not_manual" };

/**
 * A spend or top-up: one Transaction plus the balance movement it implies, both
 * writes or neither. One without the other gives a ledger that does not add up
 * to the figure above it, or a number that moves with nothing to explain it.
 */
export async function recordManualMovement(
  accountId: string,
  input: { amountCents: number; label: string; date: string; categoryId?: string | null },
): Promise<ManualEntryResult> {
  await assertManualAccountEligible(accountId);

  const problem = validateManualMovement(input);
  if (problem) return { ok: false, error: problem };

  const at = atNoonUtc(input.date);
  const delta = BigInt(Math.round(input.amountCents));

  const refusal = await prisma.$transaction(async (tx) => {
    const snapshots = await tx.historicalBalance.findMany({
      where: { accountId },
      select: { recordedAt: true, balanceCents: true },
    });

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
    await tx.historicalBalance.updateMany({
      where: { accountId, recordedAt: { gte: at } },
      data: { balanceCents: { increment: delta } },
    });

    if (anchor !== null) {
      await tx.historicalBalance.create({ data: { accountId, recordedAt: at, balanceCents: anchor } });
    }

    await tx.transaction.create({
      data: {
        accountId,
        syncId: `${MANUAL_SYNC_PREFIX}${randomUUID()}`,
        date: at,
        label: input.label.trim().slice(0, 500),
        amountCents: delta,
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
  await assertManualAccountEligible(accountId);

  if (!Number.isFinite(balanceCents)) return { ok: false, error: "amount_required" };

  const at = atNoonUtc(new Date().toISOString().slice(0, 10));
  const value = BigInt(Math.round(balanceCents));

  await prisma.$transaction(async (tx) => {
    // No unique constraint on (accountId, recordedAt), so this is a read then
    // a write rather than an upsert. Inside the transaction, so a second
    // correction on the same day cannot land a duplicate row for it.
    const existing = await tx.historicalBalance.findFirst({
      where: { accountId, recordedAt: at },
      select: { id: true },
    });
    if (existing) {
      await tx.historicalBalance.update({ where: { id: existing.id }, data: { balanceCents: value } });
    } else {
      await tx.historicalBalance.create({ data: { accountId, recordedAt: at, balanceCents: value } });
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
    select: { id: true, accountId: true, amountCents: true, date: true, syncId: true, categoryId: true },
  });
  if (!row) return { ok: false, error: "not_found" };

  // Ownership and eligibility, from the account the row actually belongs to
  // rather than anything the caller supplied.
  await assertManualAccountEligible(row.accountId);

  if (!isManualEntry(row.syncId)) return { ok: false, error: "not_manual" };

  await prisma.$transaction(async (tx) => {
    await tx.historicalBalance.updateMany({
      where: { accountId: row.accountId, recordedAt: { gte: row.date } },
      data: { balanceCents: { decrement: row.amountCents } },
    });
    await tx.transaction.delete({ where: { id: row.id } });
  });

  revalidateTransactions(row.accountId, [row.categoryId]);
  return { ok: true };
}
