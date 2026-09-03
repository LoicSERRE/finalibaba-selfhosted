"use server";

import { revalidateTransactions } from "@/lib/actions/revalidate";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { getViewer, assertTransactionsWritable, assertOwned } from "@/lib/auth-context";
import { assertManualAccountEligible } from "@/lib/actions/manual-account-guard";
import { autoCategorizeTransactions } from "@/lib/actions/auto-categorize";
import { normalizeLabelForCategorization, isGenericTransferLabel } from "@/lib/domain/auto-categorize";

type ImportRow = { date: string; label: string; amountCents: number };

export async function importTransactions(accountId: string, rows: ImportRow[]) {
  // assertManualAccountEligible below now also checks ownership, but the guard
  // is repeated here so this entry point can't be re-wired later to a
  // different eligibility check and silently lose it.
  if (rows.length === 0) return { imported: 0 };
  await assertManualAccountEligible(accountId);

  const data = rows.map((r) => ({
    accountId,
    syncId: `csv_${randomUUID()}`,
    // Noon UTC keeps the date stable across timezones instead of risking a
    // midnight-UTC day shift - same convention as importBalanceHistory.
    date: new Date(`${r.date}T12:00:00.000Z`),
    label: r.label.slice(0, 500),
    amountCents: BigInt(Math.round(r.amountCents)),
  }));

  const result = await prisma.transaction.createMany({ data });

  // Best-effort: a fresh import has no categorized history of its own yet
  // for genuinely new labels, but re-sweeping the account here still picks
  // up any label this account has already learned from earlier imports or
  // manual categorization - and it means the very next look at /budgets
  // doesn't show already-familiar merchants sitting in "uncategorized".
  await autoCategorizeTransactions(accountId);

  revalidateTransactions(accountId);

  return { imported: result.count };
}

export async function setTransactionCategory(
  transactionId: string,
  categoryId: string | null
): Promise<{ siblingCount: number }> {
  const viewer = await getViewer();
  await assertTransactionsWritable(viewer.id, [transactionId]);
  // The category has to be the viewer's own too - otherwise a transaction
  // could be filed under someone else's category, which would then count
  // toward that person's budget.
  if (categoryId) await assertOwned("category", categoryId, viewer.id);

  const before = await prisma.transaction.findUnique({
    where: { id: transactionId },
    select: { categoryId: true, label: true },
  });

  // Picking a single category from this plain dropdown is an explicit
  // "this transaction has exactly one category now" choice - it always
  // supersedes a prior split, same as choosing "Uncategorized" does. Split
  // rows are deleted in the same update, not left dangling for a category
  // the transaction no longer has splits for. See
  // lib/actions/transaction-splits.ts's setTransactionSplits for the
  // reverse direction.
  const [tx] = await prisma.$transaction([
    prisma.transaction.update({
      where: { id: transactionId },
      data: { categoryId },
      select: { accountId: true },
    }),
    prisma.transactionSplit.deleteMany({ where: { transactionId } }),
  ]);

  // Both the category it's leaving and the one it's joining, so the
  // /budgets/[categoryId] drill-down reflects the move in either direction.
  revalidateTransactions(tx.accountId, [before?.categoryId, categoryId]);

  // How many other transactions in this account share the same normalized
  // label but currently sit in a different category (including
  // uncategorized) - the UI offers to apply this correction to all of them
  // in one click, since a bad automatic categorization (a dictionary/MCC
  // false positive, or a self-learning miss) typically hits every
  // occurrence of a label at once, not just the one the user happened to
  // notice and fix. normalizeLabelForCategorization (not the plainer
  // normalizeLabel recurring-detection uses) also strips an embedded
  // calendar year, so e.g. "INTERETS 2025" and "INTERETS 2026" - a French
  // Livret's once-a-year interest credit, labeled with the current year -
  // still group as the same label. Same grouping as
  // applyCategoryToSimilarTransactions below.
  //
  // Never offered for a generic transfer label ("VIREMENT SEPA" and
  // friends - isGenericTransferLabel) - a real incident this exact
  // propagation feature caused: one transaction correctly categorized as
  // salary, propagated onto every other same-labeled transaction in the
  // account including real inter-account transfers, since the bank reuses
  // this boilerplate for both. See lib/domain/auto-categorize.ts's
  // GENERIC_TRANSFER_LABELS comment for the full incident.
  const label = before?.label ?? "";
  let siblingCount = 0;
  if (!isGenericTransferLabel(label)) {
    const normalized = normalizeLabelForCategorization(label);
    const others = await prisma.transaction.findMany({
      where: { accountId: tx.accountId, id: { not: transactionId } },
      select: { label: true, categoryId: true },
    });
    siblingCount = others.filter((o) => normalizeLabelForCategorization(o.label) === normalized && o.categoryId !== categoryId).length;
  }

  return { siblingCount };
}

// Propagates a just-corrected category to every other transaction in the
// same account sharing the same normalized label - fixes the common
// aftermath of a bad automatic categorization (dictionary/MCC false
// positive, or a self-learning miss): without this, undoing it meant
// correcting each occurrence by hand. The label match is computed
// server-side from the source transaction, not client-supplied ids - same
// trust boundary as bulkAssignCategory above - and scoped per-account for
// the same reason self-learning/recurring-detection already group this way
// (label is raw bank-feed text specific to one institution's formatting).
export async function applyCategoryToSimilarTransactions(
  transactionId: string,
  categoryId: string | null
): Promise<{ updated: number }> {
  const viewer = await getViewer();
  await assertTransactionsWritable(viewer.id, [transactionId]);
  if (categoryId) await assertOwned("category", categoryId, viewer.id);

  const source = await prisma.transaction.findUnique({
    where: { id: transactionId },
    select: { accountId: true, label: true },
  });
  if (!source) return { updated: 0 };
  // Guards the server action directly, not just its own UI trigger (which
  // never offers this for a generic label per setTransactionCategory's
  // siblingCount above) - Server Actions are reachable regardless of what
  // rendered, same reasoning as every other eligibility guard in this app.
  if (isGenericTransferLabel(source.label)) return { updated: 0 };

  const normalized = normalizeLabelForCategorization(source.label);
  const candidates = await prisma.transaction.findMany({
    where: { accountId: source.accountId, id: { not: transactionId } },
    select: { id: true, label: true },
  });
  const ids = candidates.filter((c) => normalizeLabelForCategorization(c.label) === normalized).map((c) => c.id);
  if (ids.length === 0) return { updated: 0 };

  // Same reasoning as setTransactionCategory above - a sibling caught by
  // this propagation could itself already be a split transaction, and
  // assigning it a single category here must supersede that split, not
  // leave stale TransactionSplit rows alongside a now-non-null categoryId.
  const [result] = await prisma.$transaction([
    prisma.transaction.updateMany({ where: { id: { in: ids } }, data: { categoryId } }),
    prisma.transactionSplit.deleteMany({ where: { transactionId: { in: ids } } }),
  ]);

  revalidateTransactions(source.accountId, [categoryId]);

  return { updated: result.count };
}

// Assigns one category to a batch of transactions at once - the ids come
// from a server-computed label group (see app/budgets/page.tsx), not from
// client input, so no re-validation of "do these ids actually share a
// label" is needed here.
export async function bulkAssignCategory(transactionIds: string[], categoryId: string | null) {
  if (transactionIds.length === 0) return { updated: 0 };

  // Every id in the batch must resolve inside the viewer's own accounts -
  // this is the one action taking an arbitrary caller-supplied id array, so
  // a single forged id riding along with legitimate ones is exactly the
  // shape to guard against.
  const viewer = await getViewer();
  await assertTransactionsWritable(viewer.id, transactionIds);
  if (categoryId) await assertOwned("category", categoryId, viewer.id);

  const accountIds = await prisma.transaction.findMany({
    where: { id: { in: transactionIds } },
    select: { accountId: true },
    distinct: ["accountId"],
  });

  // Same reasoning as setTransactionCategory/applyCategoryToSimilarTransactions
  // above - this batch's own real-world call site (the /budgets
  // uncategorized-groups picker) never includes an already-split
  // transaction in practice, but a Server Action is directly invocable
  // regardless of what's rendered, so this stays defensive here too.
  const [result] = await prisma.$transaction([
    prisma.transaction.updateMany({ where: { id: { in: transactionIds } }, data: { categoryId } }),
    prisma.transactionSplit.deleteMany({ where: { transactionId: { in: transactionIds } } }),
  ]);

  for (const { accountId } of accountIds) revalidateTransactions(accountId, [categoryId]);

  return { updated: result.count };
}
