/**
 * The per-category money in and out of any period, for /budgets' month and
 * year views alike (v2.20 - moved out of the page so the year view sums
 * exactly what the month view shows).
 *
 * Split transactions count through their lines, never their parent:
 * "splits: { none: {} }" leaves the parent out (its categoryId is null),
 * and the split lines are filtered on the parent's own date and flags.
 *
 * SAVINGS categories (v2.21) are neither spending nor income: every function
 * here that adds money up as either takes their ids and leaves them out, and
 * periodSetAside counts them instead.
 */
import { prisma } from "@/lib/db/prisma";
import { mergeCentsMaps } from "@/lib/domain/budgets";
import { excludeFromBudgetTotals, excludeFromBudgetTotalsOnSplit } from "@/lib/domain/transaction-filters";
import { computeSetAside, CURRENT_ACCOUNT_TYPES, type SetAside } from "@/lib/domain/set-aside";

type CentsMap = Map<string | null, number>;
type Sums = { categoryId: string | null; _sum: { amountCents: bigint | null } }[];

// A named default: `= new Set()` in a signature hides the function from
// lizard (scripts/lizard-blind-spots.py).
const NO_SAVINGS: ReadonlySet<string> = new Set();

const toMap = (rows: Sums, sign: 1 | -1): CentsMap =>
  new Map(rows.map((row) => [row.categoryId, sign * Number(row._sum.amountCents ?? BigInt(0))]));

export async function periodCategoryTotals(
  accountIds: string[],
  start: Date,
  end: Date,
  savingsCategoryIds: ReadonlySet<string> = NO_SAVINGS
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
  const withoutSavings = (map: CentsMap): CentsMap => {
    for (const id of savingsCategoryIds) map.delete(id);
    return map;
  };
  return {
    spendMap: withoutSavings(mergeCentsMaps(toMap(spend, -1), toMap(splitSpend, -1))),
    incomeMap: withoutSavings(mergeCentsMaps(toMap(income, 1), toMap(splitIncome, 1))),
  };
}

/** Every amount of the period with its date - whole transactions and split lines, never both. */
export async function periodAmounts(
  accountIds: string[],
  start: Date,
  end: Date,
  savingsCategoryIds: ReadonlySet<string> = NO_SAVINGS
): Promise<{ date: Date; amountCents: bigint }[]> {
  const date = { gte: start, lt: end };
  // A bare notIn would drop the uncategorized rows too (NULL NOT IN ... is
  // not true), hence the explicit null branch.
  const notSavings = { OR: [{ categoryId: null }, { categoryId: { notIn: [...savingsCategoryIds] } }] };
  const [whole, splits] = await Promise.all([
    prisma.transaction.findMany({
      where: excludeFromBudgetTotals({ accountId: { in: accountIds }, date, splits: { none: {} }, ...notSavings }),
      select: { date: true, amountCents: true },
    }),
    prisma.transactionSplit.findMany({
      where: excludeFromBudgetTotalsOnSplit(notSavings, { accountId: { in: accountIds }, date }),
      select: { amountCents: true, transaction: { select: { date: true } } },
    }),
  ]);
  return [...whole, ...splits.map((s) => ({ date: s.transaction.date, amountCents: s.amountCents }))];
}

/**
 * Money set aside over the period (v2.21), from the current accounts' side
 * only - see lib/domain/set-aside.ts. Internal transfers, securities
 * movements and SAVINGS-category rows are exactly what
 * excludeFromBudgetTotals keeps out of the totals above, so nothing is
 * counted both here and there.
 */
export async function periodSetAside(
  accountIds: string[],
  start: Date,
  end: Date,
  savingsCategoryIds: ReadonlySet<string> = NO_SAVINGS
): Promise<SetAside> {
  const current = { accountId: { in: accountIds }, account: { type: { in: [...CURRENT_ACCOUNT_TYPES] } }, date: { gte: start, lt: end } };
  const savingsIds = [...savingsCategoryIds];
  const [whole, splits] = await Promise.all([
    prisma.transaction.findMany({
      where: {
        ...current,
        splits: { none: {} },
        OR: [{ isInternalTransfer: true }, { isSecuritiesMovement: true }, { categoryId: { in: savingsIds } }],
      },
      select: { amountCents: true, isInternalTransfer: true, isSecuritiesMovement: true, categoryId: true, internalTransferPairId: true },
    }),
    prisma.transactionSplit.findMany({
      where: { categoryId: { in: savingsIds }, transaction: current },
      select: { amountCents: true, categoryId: true },
    }),
  ]);
  // Where each transfer went: its other leg's account, when that account is
  // one the viewer can see - money moved to somebody else's livret is not
  // theirs to count.
  const pairIds = whole.flatMap((tx) => (tx.isInternalTransfer && tx.internalTransferPairId ? [tx.internalTransferPairId] : []));
  const pairs =
    pairIds.length === 0
      ? []
      : await prisma.transaction.findMany({
          where: { id: { in: pairIds }, accountId: { in: accountIds } },
          select: { id: true, account: { select: { type: true } } },
        });
  const pairType = new Map(pairs.map((p) => [p.id, p.account.type as string]));
  return computeSetAside([
    ...whole.map((tx) => ({
      amountCents: Number(tx.amountCents),
      isInternalTransfer: tx.isInternalTransfer,
      isSecuritiesMovement: tx.isSecuritiesMovement,
      counterpartAccountType: tx.internalTransferPairId ? (pairType.get(tx.internalTransferPairId) ?? null) : null,
      savingsCategoryId: tx.categoryId !== null && savingsCategoryIds.has(tx.categoryId) ? tx.categoryId : null,
    })),
    ...splits.map((line) => ({
      amountCents: Number(line.amountCents),
      isInternalTransfer: false,
      isSecuritiesMovement: false,
      counterpartAccountType: null,
      savingsCategoryId: line.categoryId,
    })),
  ]);
}

/** The ids of the viewer's SAVINGS categories, among the categories already loaded. */
export function savingsCategoryIdsOf(categories: readonly { id: string; kind: string }[]): Set<string> {
  return new Set(categories.filter((c) => c.kind === "SAVINGS").map((c) => c.id));
}

/** Everything /budgets?year= shows, loaded in one place (the view itself only renders). */
export async function loadBudgetYear(viewerId: string, accountIds: string[], year: number) {
  const start = new Date(Date.UTC(year, 0, 1));
  const end = new Date(Date.UTC(year + 1, 0, 1));
  const categories = await prisma.category.findMany({ where: { userId: viewerId }, orderBy: { name: "asc" } });
  const savingsIds = savingsCategoryIdsOf(categories);
  const [totals, amounts, setAside] = await Promise.all([
    periodCategoryTotals(accountIds, start, end, savingsIds),
    periodAmounts(accountIds, start, end, savingsIds),
    periodSetAside(accountIds, start, end, savingsIds),
  ]);
  return { categories, ...totals, amounts, setAside };
}

export type BudgetYearData = Awaited<ReturnType<typeof loadBudgetYear>>;
