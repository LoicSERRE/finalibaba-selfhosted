"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { assertCsvImportEligible } from "@/lib/actions/csv-import-guard";

type BalanceRow = { date: string; balanceCents: number };

export async function importBalanceHistory(accountId: string, rows: BalanceRow[]) {
  if (rows.length === 0) return { imported: 0 };
  await assertCsvImportEligible(accountId);

  const data = rows.map((r) => ({
    accountId,
    balanceCents: BigInt(Math.round(r.balanceCents)),
    // Noon UTC - same convention as prisma/seed-demo.ts - keeps the date stable
    // across timezones instead of risking a midnight-UTC day shift.
    recordedAt: new Date(`${r.date}T12:00:00.000Z`),
  }));

  const result = await prisma.historicalBalance.createMany({ data });

  revalidatePath(`/accounts/${accountId}`);
  revalidatePath("/accounts");
  revalidatePath("/");

  return { imported: result.count };
}
