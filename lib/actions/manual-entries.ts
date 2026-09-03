"use server";

import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { revalidateTransactions } from "@/lib/actions/revalidate";
import { assertManualAccountEligible } from "@/lib/actions/manual-account-guard";
import { autoCategorizeTransactions } from "@/lib/actions/auto-categorize";
import {
  anchorBalanceFor,
  atNoonUtc,
  isManualEntry,
  MANUAL_SYNC_PREFIX,
  validateManualMovement,
  type ManualEntryError,
} from "@/lib/domain/manual-entries";

/**
 * Editing an account nobody else writes to: a meal-voucher card, a cash
 * envelope, a bank the sync cannot reach.
 *
 * Every write here is guarded by assertManualAccountEligible, which refuses a
 * synced or GoCardless-linked account - a Server Action is reachable directly
 * whatever the UI renders, and letting one shift a bank's own recorded balances
 * is the one outcome that could destroy real history rather than just annoy.
 *
 * Failures come back as VALUES with stable keys, never thrown sentences:
 * Next replaces a thrown Server Action error with an opaque digest in
 * production, so a carefully worded message reaches the developer in dev and
 * nobody at all once deployed. This repo has paid for that twice already (see
 * CLAUDE.md). Authorization failures still throw, deliberately - someone
 * reaching for another person's account is not an expected error and must not
 * get a readable explanation.
 */
export type ManualEntryResult = { ok: true } | { ok: false; error: ManualEntryError | "not_found" | "not_manual" };

/**
 * Records a spend or a top-up: one Transaction, plus the balance movement it
 * implies.
 *
 * Both writes or neither. A Transaction without the balance shift shows a
 * ledger that does not add up to the figure printed above it; a balance shift
 * without the Transaction moves the number with nothing to explain it.
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

  await prisma.$transaction(async (tx) => {
    const snapshots = await tx.historicalBalance.findMany({
      where: { accountId },
      select: { recordedAt: true, balanceCents: true },
    });

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
  });

  // Only ever touches rows still sitting at categoryId null, so an explicit
  // pick above is left alone - same sweep importTransactions runs, for the
  // same reason: a label this account has already learned should not come
  // back uncategorised.
  await autoCategorizeTransactions(accountId);

  revalidateTransactions(accountId, [input.categoryId]);
  return { ok: true };
}

/**
 * "My card says 87,50 EUR, make it so." A snapshot, not a movement: it writes
 * no Transaction, because nothing happened that a budget should see - the
 * figure was simply wrong.
 *
 * Deliberately fixed to today rather than taking a date. Correcting a past day
 * would leave every later snapshot contradicting it, and the two ways out
 * (shift them, or let them disagree) are both surprising. A backdated fix is
 * what recordManualMovement is for, where the arithmetic is unambiguous.
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
 * Removes an entry this person typed in, and undoes what it did to the balance.
 *
 * Scoped to manual entries by syncId prefix, never any transaction on the
 * account: a CSV-imported or synced row never shifted a balance in the first
 * place, so "reversing" one would invent a movement that never existed.
 *
 * The anchor row the entry may have created is left behind on purpose. After
 * the shift it holds exactly the balance that preceded the entry, so it draws
 * no step on the chart - a harmless extra point, against the alternative of
 * deciding whether some later entry has since come to depend on it.
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
