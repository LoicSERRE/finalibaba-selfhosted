"use server";

import { revalidateTransactions } from "@/lib/actions/revalidate";
import { prisma } from "@/lib/db/prisma";
import { getViewer, assertTransactionsWritable, assertOwned } from "@/lib/auth-context";
import { parseCents } from "@/lib/utils/format";
import { validateSplitLines } from "@/lib/domain/transaction-splits";

export interface SplitLineForm {
  categoryId: string | null;
  // Euro string from the client (e.g. "12.50"), same convention as every
  // other money-amount Server Action in this codebase (recordSale,
  // createIncomeEvent, ...) - never a raw bigint across the Server Action
  // boundary. The sign is inferred from the parent transaction: a debit
  // splits into negative line amounts, a credit into positive ones, so the
  // UI only ever asks for a magnitude per line, not a sign per line.
  amountEuro: string;
}

async function revalidateForTransaction(accountId: string, categoryIdsAffected: (string | null)[]) {
  revalidateTransactions(accountId, categoryIdsAffected);
}

// Splits one transaction across 2+ categories - each line's amount must sum
// exactly to the transaction's own amountCents (validateSplitLines).
// Replaces any existing splits for this transaction (delete-then-create in
// one $transaction, so a partial write is never visible) and nulls the
// parent's own categoryId - a split transaction's category info lives
// entirely in TransactionSplit rows from this point on. See CLAUDE.md's
// "Split transactions" for why every "categoryId: null" query elsewhere
// that means "genuinely uncategorized" also needs a "splits: { none: {} }"
// guard, so this transaction doesn't silently get swept back into
// automatic single-category assignment.
export async function setTransactionSplits(transactionId: string, lines: SplitLineForm[]): Promise<void> {
  const viewer = await getViewer();
  await assertTransactionsWritable(viewer.id, [transactionId]);
  // Each line's category must belong to the viewer - a split is the one
  // place several categories are written at once, so every one of them
  // needs checking, not just the first.
  for (const categoryId of new Set(lines.map((l) => l.categoryId).filter((c): c is string => !!c))) {
    await assertOwned("category", categoryId, viewer.id);
  }

  const tx = await prisma.transaction.findUniqueOrThrow({
    where: { id: transactionId },
    select: { accountId: true, amountCents: true, categoryId: true },
  });

  const parsedLines = lines.map((l) => ({
    categoryId: l.categoryId,
    // A debit transaction's magnitude entered by the user must become a
    // negative line amount, and a credit's a positive one - the sign is
    // never asked from the UI, only inferred here from the parent.
    amountCents: (tx.amountCents < BigInt(0) ? BigInt(-1) : BigInt(1)) * parseCents(l.amountEuro),
  }));

  const result = validateSplitLines(parsedLines, tx.amountCents);
  if (!result.valid) throw new Error(`Invalid split: ${result.error}`);

  const oldSplitCategoryIds = await prisma.transactionSplit.findMany({
    where: { transactionId },
    select: { categoryId: true },
  });

  await prisma.$transaction([
    prisma.transactionSplit.deleteMany({ where: { transactionId } }),
    prisma.transactionSplit.createMany({
      data: parsedLines.map((l) => ({ transactionId, categoryId: l.categoryId, amountCents: l.amountCents })),
    }),
    prisma.transaction.update({ where: { id: transactionId }, data: { categoryId: null } }),
  ]);

  await revalidateForTransaction(tx.accountId, [
    tx.categoryId,
    ...oldSplitCategoryIds.map((s) => s.categoryId),
    ...parsedLines.map((l) => l.categoryId),
  ]);
}

// Reverts a split transaction back to plain single-category assignment
// (or uncategorized) - deletes every TransactionSplit row for it. Kept
// separate from setTransactionCategory in lib/actions/transactions.ts
// (which also calls this) so the split-dialog's own "remove split" action
// doesn't need to go through the plain category <select> at all.
export async function clearTransactionSplits(transactionId: string): Promise<void> {
  const viewer = await getViewer();
  await assertTransactionsWritable(viewer.id, [transactionId]);

  const existing = await prisma.transactionSplit.findMany({
    where: { transactionId },
    select: { categoryId: true },
  });
  if (existing.length === 0) return;

  const tx = await prisma.transaction.findUniqueOrThrow({ where: { id: transactionId }, select: { accountId: true } });

  await prisma.transactionSplit.deleteMany({ where: { transactionId } });
  await revalidateForTransaction(tx.accountId, [...existing.map((s) => s.categoryId)]);
}
