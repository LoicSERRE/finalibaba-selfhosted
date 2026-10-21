/**
 * Loads what lib/domain/price-changes.ts needs for the paths that do not
 * already hold it - the alert pass and the "update the amount" action. The
 * recurring page feeds the pure function its own transactions instead.
 */
import { prisma } from "@/lib/db/prisma";
import { excludeFromBudgetTotals } from "@/lib/domain/transaction-filters";
import { DEFAULT_GRACE_DAYS } from "@/lib/domain/recurring";
import { detectPriceIncrease, type PriceIncrease } from "@/lib/domain/price-changes";

export type SeriesPriceIncrease = {
  id: string;
  label: string;
  accountName: string;
  priceAlertedCents: bigint | null;
  increase: PriceIncrease;
};

// The latest expected occurrence of a yearly series is up to a year back.
const LOOKBACK_DAYS = 366 + DEFAULT_GRACE_DAYS;

/** Active templates on these accounts whose latest charge came in dearer. */
export async function findPriceIncreases(accountIds: string[], now: Date, onlyId?: string): Promise<SeriesPriceIncrease[]> {
  const series = await prisma.recurringTransaction.findMany({
    where: {
      accountId: { in: accountIds },
      active: true,
      dismissedAt: null,
      amountVaries: false,
      amountCents: { lt: 0 },
      ...(onlyId ? { id: onlyId } : {}),
    },
    include: { account: { select: { name: true } } },
  });
  if (series.length === 0) return [];
  const since = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const seriesAccountIds: string[] = [...new Set(series.map((s) => s.accountId))];
  const transactions = await prisma.transaction.findMany({
    // The same scope as the recurring page's own detection.
    where: excludeFromBudgetTotals({ accountId: { in: seriesAccountIds }, date: { gte: since } }),
    select: { accountId: true, label: true, amountCents: true, date: true },
  });
  return series.flatMap((s) => {
    const increase = detectPriceIncrease(s, transactions, now);
    return increase
      ? [{ id: s.id, label: s.label, accountName: s.account.name, priceAlertedCents: s.priceAlertedCents, increase }]
      : [];
  });
}
