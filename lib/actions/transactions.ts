"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { assertCsvImportEligible } from "@/lib/actions/csv-import-guard";
import { autoCategorizeTransactions } from "@/lib/actions/auto-categorize";
import { normalizeLabel } from "@/lib/domain/recurring";

type ImportRow = { date: string; label: string; amountCents: number };

export async function importTransactions(accountId: string, rows: ImportRow[]) {
  if (rows.length === 0) return { imported: 0 };
  await assertCsvImportEligible(accountId);

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

  revalidatePath(`/accounts/${accountId}`);
  revalidatePath("/accounts");
  revalidatePath("/");
  revalidatePath("/budgets");

  return { imported: result.count };
}

export async function setTransactionCategory(
  transactionId: string,
  categoryId: string | null
): Promise<{ siblingCount: number }> {
  const before = await prisma.transaction.findUnique({
    where: { id: transactionId },
    select: { categoryId: true, label: true },
  });

  const tx = await prisma.transaction.update({
    where: { id: transactionId },
    data: { categoryId },
    select: { accountId: true },
  });

  revalidatePath(`/accounts/${tx.accountId}`);
  revalidatePath("/budgets");
  // TransactionCategorySelect is also used on the /budgets/[categoryId]
  // drill-down page (recategorizing a transaction away from there should
  // make it disappear from that list without a manual refresh) - revalidate
  // both the category it's leaving and the one it's joining, since either
  // could be the page currently being viewed.
  if (before?.categoryId) revalidatePath(`/budgets/${before.categoryId}`);
  if (categoryId) revalidatePath(`/budgets/${categoryId}`);

  // How many other transactions in this account share the same normalized
  // label but currently sit in a different category (including
  // uncategorized) - the UI offers to apply this correction to all of them
  // in one click, since a bad automatic categorization (a dictionary/MCC
  // false positive, or a self-learning miss) typically hits every
  // occurrence of a label at once, not just the one the user happened to
  // notice and fix. Same per-account normalizeLabel grouping as
  // applyCategoryToSimilarTransactions below.
  const normalized = normalizeLabel(before?.label ?? "");
  const others = await prisma.transaction.findMany({
    where: { accountId: tx.accountId, id: { not: transactionId } },
    select: { label: true, categoryId: true },
  });
  const siblingCount = others.filter((o) => normalizeLabel(o.label) === normalized && o.categoryId !== categoryId).length;

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
  const source = await prisma.transaction.findUnique({
    where: { id: transactionId },
    select: { accountId: true, label: true },
  });
  if (!source) return { updated: 0 };

  const normalized = normalizeLabel(source.label);
  const candidates = await prisma.transaction.findMany({
    where: { accountId: source.accountId, id: { not: transactionId } },
    select: { id: true, label: true },
  });
  const ids = candidates.filter((c) => normalizeLabel(c.label) === normalized).map((c) => c.id);
  if (ids.length === 0) return { updated: 0 };

  const result = await prisma.transaction.updateMany({
    where: { id: { in: ids } },
    data: { categoryId },
  });

  revalidatePath(`/accounts/${source.accountId}`);
  revalidatePath("/budgets");
  if (categoryId) revalidatePath(`/budgets/${categoryId}`);

  return { updated: result.count };
}

// Assigns one category to a batch of transactions at once - the ids come
// from a server-computed label group (see app/budgets/page.tsx), not from
// client input, so no re-validation of "do these ids actually share a
// label" is needed here.
export async function bulkAssignCategory(transactionIds: string[], categoryId: string | null) {
  if (transactionIds.length === 0) return { updated: 0 };

  const accountIds = await prisma.transaction.findMany({
    where: { id: { in: transactionIds } },
    select: { accountId: true },
    distinct: ["accountId"],
  });

  const result = await prisma.transaction.updateMany({
    where: { id: { in: transactionIds } },
    data: { categoryId },
  });

  for (const { accountId } of accountIds) revalidatePath(`/accounts/${accountId}`);
  revalidatePath("/budgets");

  return { updated: result.count };
}
