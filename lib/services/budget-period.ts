/**
 * Every line of money of a period, for /budgets' month and year views and the
 * year card on /analytics (v2.21.1 - one loader, so they all add up the same
 * lines the same way). The rules are lib/domain/period-ledger.ts's.
 *
 * Split transactions count through their lines, never their parent; a line
 * carries its parent's date, account and flags.
 *
 * The flags are read here rather than filtered with excludeFromBudgetTotals:
 * internal transfers and securities movements are not dropped but placed -
 * money set aside, or another movement of the current accounts - and
 * partitionPeriod is where that happens.
 */
import { prisma } from "@/lib/db/prisma";
import { partitionPeriod, type CategoryKindName, type LedgerLine, type PeriodLedger } from "@/lib/domain/period-ledger";

type CategoryRef = { id: string; kind: string };

export async function loadPeriodLedger(
  accountIds: string[],
  start: Date,
  end: Date,
  categories: readonly CategoryRef[]
): Promise<PeriodLedger> {
  const transactions = await prisma.transaction.findMany({
    where: { accountId: { in: accountIds }, date: { gte: start, lt: end } },
    select: {
      id: true,
      date: true,
      label: true,
      amountCents: true,
      categoryId: true,
      isInternalTransfer: true,
      isSecuritiesMovement: true,
      internalTransferPairId: true,
      account: { select: { name: true, type: true } },
      splits: { select: { amountCents: true, categoryId: true } },
    },
  });
  // Where each transfer went: its other leg's account, when that account is
  // one the viewer can see - money moved to somebody else's livret is not
  // theirs to count.
  const pairIds = transactions.flatMap((tx) => (tx.isInternalTransfer && tx.internalTransferPairId ? [tx.internalTransferPairId] : []));
  const pairs =
    pairIds.length === 0
      ? []
      : await prisma.transaction.findMany({
          where: { id: { in: pairIds }, accountId: { in: accountIds } },
          select: { id: true, account: { select: { type: true } } },
        });
  const pairType = new Map(pairs.map((p) => [p.id, p.account.type as string]));

  const lines: LedgerLine[] = transactions.flatMap((tx) => {
    const base = {
      transactionId: tx.id,
      date: tx.date,
      label: tx.label,
      accountName: tx.account.name,
      accountType: tx.account.type as string,
      isInternalTransfer: tx.isInternalTransfer,
      isSecuritiesMovement: tx.isSecuritiesMovement,
      counterpartAccountType: tx.internalTransferPairId ? (pairType.get(tx.internalTransferPairId) ?? null) : null,
    };
    if (tx.splits.length === 0) return [{ ...base, amountCents: Number(tx.amountCents), categoryId: tx.categoryId }];
    return tx.splits.map((split) => ({ ...base, amountCents: Number(split.amountCents), categoryId: split.categoryId }));
  });
  return partitionPeriod(lines, new Map(categories.map((c) => [c.id, c.kind as CategoryKindName])));
}

/** Everything /budgets?year= shows, loaded in one place (the view itself only renders). */
export async function loadBudgetYear(viewerId: string, accountIds: string[], year: number) {
  const start = new Date(Date.UTC(year, 0, 1));
  const end = new Date(Date.UTC(year + 1, 0, 1));
  const categories = await prisma.category.findMany({ where: { userId: viewerId }, orderBy: { name: "asc" } });
  return { categories, ledger: await loadPeriodLedger(accountIds, start, end, categories) };
}

export type BudgetYearData = Awaited<ReturnType<typeof loadBudgetYear>>;
