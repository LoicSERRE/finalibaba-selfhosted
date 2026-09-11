"use server";

import { revalidateHolding } from "@/lib/actions/revalidate";
import { prisma } from "@/lib/db/prisma";
import { assertManualAccountEligible } from "@/lib/actions/manual-account-guard";
import { isFutureDate, parseCsvDate } from "@/lib/domain/csv-import";

type BalanceRow = { date: string; balanceCents: number };

export async function importBalanceHistory(accountId: string, rows: BalanceRow[]) {
  if (rows.length === 0) return { imported: 0 };
  await assertManualAccountEligible(accountId);

  // The dialog checks both of these before offering a row, and neither check
  // existed here - a Server Action is reachable whatever the UI renders, and
  // a stale page counts as "whatever". A future-dated row is the costly one:
  // "the current balance" is simply the newest row, so a year typed as 2062
  // becomes the account's displayed balance permanently, on every screen, with
  // no way to take it back short of the database.
  const today = new Date().toISOString().slice(0, 10);
  const accepted = rows.filter((r) => parseCsvDate(r.date) === r.date && !isFutureDate(r.date) && r.date <= today);
  if (accepted.length === 0) return { imported: 0 };

  // One row per date, last one wins - a file listing the same day twice is
  // stating a correction, not asking for both figures to be kept.
  const byDate = new Map(accepted.map((r) => [r.date, BigInt(Math.round(r.balanceCents))]));

  // Noon UTC - same convention as prisma/seed-demo.ts - keeps the date stable
  // across timezones instead of risking a midnight-UTC day shift.
  const stamps = [...byDate.keys()].map((d) => new Date(`${d}T12:00:00.000Z`));

  // Replaces rather than appends. Re-importing a corrected balance used to
  // leave BOTH rows at the identical instant, and which one the account showed
  // was then down to the database's own row order - there is no delete UI to
  // undo that with. Deleting first, in the same transaction, means an import
  // of the same day is idempotent however many times it runs.
  const written = await prisma.$transaction(async (tx) => {
    await tx.historicalBalance.deleteMany({ where: { accountId, recordedAt: { in: stamps } } });
    const result = await tx.historicalBalance.createMany({
      data: [...byDate].map(([date, balanceCents]) => ({
        accountId,
        balanceCents,
        recordedAt: new Date(`${date}T12:00:00.000Z`),
      })),
    });
    return result.count;
  });

  revalidateHolding(accountId);

  return { imported: written };
}
