/**
 * /budgets for a whole year (v2.20): the month's view, summed over a
 * calendar year - spending per category against the budget for the months
 * covered, money in and out month by month, and what was saved. Pure; the
 * figures come from the same ledger as the month view
 * (lib/domain/period-ledger.ts), so a year is exactly its months added up.
 */

export type MonthCashflow = {
  /** 0 = January. */
  month: number;
  incomeCents: number;
  expenseCents: number;
};

export type YearCategoryRow = {
  id: string | null;
  name: string;
  color: string;
  spentCents: number;
  /** Over the months covered, not twelve, for the year still running. */
  monthlyAverageCents: number;
  /** Share of the year's categorized and uncategorized spending, 0-100. */
  sharePct: number;
  /** The monthly budget times the months covered, or null without one. */
  budgetCents: number | null;
};

type Category = { id: string; name: string; color: string; budgetCents: bigint | null };

/** Months of `year` that have started by `now`: 12 for a past year, 0 for a future one. */
export function monthsCovered(year: number, now: Date): number {
  const current = now.getUTCFullYear();
  if (year < current) return 12;
  if (year > current) return 0;
  return now.getUTCMonth() + 1;
}

/** The ledger's months ("YYYY-MM") laid out January to December, empty months at zero. */
export function monthlyCashflow(
  byMonth: ReadonlyMap<string, { incomeCents: number; expenseCents: number }>,
  year: number
): MonthCashflow[] {
  return Array.from({ length: 12 }, (_, month) => {
    const figures = byMonth.get(`${year}-${String(month + 1).padStart(2, "0")}`);
    return { month, incomeCents: figures?.incomeCents ?? 0, expenseCents: figures?.expenseCents ?? 0 };
  });
}

/** Spending per category over the year, the biggest first, uncategorized last. */
export function yearCategoryRows(
  spendMap: ReadonlyMap<string | null, number>,
  categories: readonly Category[],
  months: number,
  uncategorized: { name: string; color: string }
): YearCategoryRow[] {
  const total = [...spendMap.values()].reduce((sum, cents) => sum + Math.max(0, cents), 0);
  const row = (id: string | null, name: string, color: string, budget: bigint | null): YearCategoryRow => {
    const spentCents = spendMap.get(id) ?? 0;
    return {
      id,
      name,
      color,
      spentCents,
      monthlyAverageCents: months > 0 ? Math.round(spentCents / months) : 0,
      sharePct: total > 0 ? (Math.max(0, spentCents) / total) * 100 : 0,
      budgetCents: budget === null ? null : Number(budget) * months,
    };
  };
  // Not "> 0": refunds are netted (v2.21.1), and a category that got back
  // more than it spent still belongs in the list.
  const rows = categories
    .map((c) => row(c.id, c.name, c.color, c.budgetCents))
    .filter((r) => r.spentCents !== 0 || r.budgetCents !== null)
    .sort((a, b) => b.spentCents - a.spentCents);
  if ((spendMap.get(null) ?? 0) > 0) rows.push(row(null, uncategorized.name, uncategorized.color, null));
  return rows;
}

/** What was kept of what came in, as a percentage - null when nothing came in. */
export function savingsRatePct(incomeCents: number, expenseCents: number): number | null {
  return incomeCents > 0 ? ((incomeCents - expenseCents) / incomeCents) * 100 : null;
}
