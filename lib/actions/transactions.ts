"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { assertCsvImportEligible } from "@/lib/actions/csv-import-guard";

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

  revalidatePath(`/accounts/${accountId}`);
  revalidatePath("/accounts");
  revalidatePath("/");

  return { imported: result.count };
}

export async function setTransactionCategory(transactionId: string, categoryId: string | null) {
  const tx = await prisma.transaction.update({
    where: { id: transactionId },
    data: { categoryId },
    select: { accountId: true },
  });

  revalidatePath(`/accounts/${tx.accountId}`);
  revalidatePath("/budgets");
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
