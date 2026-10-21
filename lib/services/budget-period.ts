/**
 * The per-category money in and out of any period, for /budgets' month and
 * year views alike (v2.20 - moved out of the page so the year view sums
 * exactly what the month view shows).
 *
 * Split transactions count through their lines, never their parent:
 * "splits: { none: {} }" leaves the parent out (its categoryId is null),
 * and the split lines are filtered on the parent's own date and flags.
 */
import { prisma } from "@/lib/db/prisma";
import { mergeCentsMaps } from "@/lib/domain/budgets";
import { excludeFromBudgetTotals, excludeFromBudgetTotalsOnSplit } from "@/lib/domain/transaction-filters";

type CentsMap = Map<string | null, number>;
type Sums = { categoryId: string | null; _sum: { amountCents: bigint | null } }[];

const toMap = (rows: Sums, sign: 1 | -1): CentsMap =>
  new Map(rows.map((row) => [row.categoryId, sign * Number(row._sum.amountCents ?? BigInt(0))]));

export async function periodCategoryTotals(
  accountIds: string[],
  start: Date,
  end: Date
): Promise<{ spendMap: CentsMap; incomeMap: CentsMap }> {
  const date = { gte: start, lt: end };
  const [spend, income, splitSpend, splitIncome] = await Promise.all([
    prisma.transaction.groupBy({
      by: ["categoryId"],
      where: excludeFromBudgetTotals({ accountId: { in: accountIds }, amountCents: { lt: BigInt(0) }, date, splits: { none: {} } }),
      _sum: { amountCents: true },
    }),
    prisma.transaction.groupBy({
      by: ["categoryId"],
      where: excludeFromBudgetTotals({ accountId: { in: accountIds }, amountCents: { gt: BigInt(0) }, date, splits: { none: {} } }),
      _sum: { amountCents: true },
    }),
    prisma.transactionSplit.groupBy({
      by: ["categoryId"],
      where: excludeFromBudgetTotalsOnSplit({ amountCents: { lt: BigInt(0) } }, { accountId: { in: accountIds }, date }),
      _sum: { amountCents: true },
    }),
    prisma.transactionSplit.groupBy({
      by: ["categoryId"],
      where: excludeFromBudgetTotalsOnSplit({ amountCents: { gt: BigInt(0) } }, { accountId: { in: accountIds }, date }),
      _sum: { amountCents: true },
    }),
  ]);
  return {
    spendMap: mergeCentsMaps(toMap(spend, -1), toMap(splitSpend, -1)),
    incomeMap: mergeCentsMaps(toMap(income, 1), toMap(splitIncome, 1)),
  };
}

/** Every amount of the period with its date - whole transactions and split lines, never both. */
export async function periodAmounts(accountIds: string[], start: Date, end: Date): Promise<{ date: Date; amountCents: bigint }[]> {
  const date = { gte: start, lt: end };
  const [whole, splits] = await Promise.all([
    prisma.transaction.findMany({
      where: excludeFromBudgetTotals({ accountId: { in: accountIds }, date, splits: { none: {} } }),
      select: { date: true, amountCents: true },
    }),
    prisma.transactionSplit.findMany({
      where: excludeFromBudgetTotalsOnSplit({}, { accountId: { in: accountIds }, date }),
      select: { amountCents: true, transaction: { select: { date: true } } },
    }),
  ]);
  return [...whole, ...splits.map((s) => ({ date: s.transaction.date, amountCents: s.amountCents }))];
}

/** Everything /budgets?year= shows, loaded in one place (the view itself only renders). */
export async function loadBudgetYear(viewerId: string, accountIds: string[], year: number) {
  const start = new Date(Date.UTC(year, 0, 1));
  const end = new Date(Date.UTC(year + 1, 0, 1));
  const [categories, totals, amounts] = await Promise.all([
    prisma.category.findMany({ where: { userId: viewerId }, orderBy: { name: "asc" } }),
    periodCategoryTotals(accountIds, start, end),
    periodAmounts(accountIds, start, end),
  ]);
  return { categories, ...totals, amounts };
}

export type BudgetYearData = Awaited<ReturnType<typeof loadBudgetYear>>;
