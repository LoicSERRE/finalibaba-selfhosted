export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db/prisma";
import { PiggyBank, Tag } from "lucide-react";
import { CategoryCard } from "@/components/budgets/category-card";
import { AddCategoryDialog } from "@/components/budgets/add-category-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { UncategorizedGroupCard } from "@/components/budgets/uncategorized-group-card";
import { AutoCategorizeButton } from "@/components/budgets/auto-categorize-button";
import { formatCurrency } from "@/lib/utils/format";
import { normalizeLabel } from "@/lib/domain/recurring";
import { monthsBetween, computeRolloverCarryInCents, mergeCentsMaps } from "@/lib/domain/budgets";
import { excludeInternalTransfers, excludeInternalTransfersOnSplit } from "@/lib/domain/transaction-filters";
import { getTranslations } from "next-intl/server";

// How many of the most-frequent uncategorized label groups to surface at
// once - bounded so the page doesn't turn into a full inbox-zero triage
// list; the rest still show up once the top ones are cleared (this section
// only ever queries the current, still-uncategorized set on each render).
const MAX_UNCATEGORIZED_GROUPS = 8;

// Cap on how many uncategorized rows feed the grouping below (most recent
// first) - without it this query has no `take` at all and re-loads every
// still-uncategorized transaction across the account's entire lifetime on
// every page render, just to keep the top 8 groups. 2000 is far beyond
// anything a normally-used account accumulates (most transactions do get
// categorized), so this is a safety cap, not a feature limit.
const MAX_UNCATEGORIZED_ROWS = 2000;

// Same "safety cap, not a feature limit" reasoning as MAX_UNCATEGORIZED_ROWS
// above - bounds the one extra query the rollover computation below needs,
// regardless of how many months/categories have accumulated real history.
const MAX_ROLLOVER_TRANSACTIONS = 5000;

export default async function BudgetsPage() {
  const [t, tc] = await Promise.all([getTranslations("budgets"), getTranslations("common")]);

  const now = new Date();
  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const startOfNextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  const [categories, spendByCategory, incomeByCategory, splitSpendByCategory, splitIncomeByCategory, uncategorizedTx] = await Promise.all([
    // Every category, both kinds - INCOME categories don't get a card on
    // this page (see expenseCategories below) but the "à catégoriser" bulk
    // picker further down still needs to offer them, e.g. for a stray
    // salary-like credit that landed uncategorized.
    prisma.category.findMany({ orderBy: { name: "asc" } }),
    // "splits: { none: {} }" excludes split transactions here - their
    // categoryId is always null (see CLAUDE.md's "Split transactions"), so
    // their real per-category contribution comes from splitSpendByCategory
    // below instead, not from this plain groupBy.
    prisma.transaction.groupBy({
      by: ["categoryId"],
      where: excludeInternalTransfers({
        amountCents: { lt: BigInt(0) },
        date: { gte: startOfMonth, lt: startOfNextMonth },
        splits: { none: {} },
      }),
      _sum: { amountCents: true },
    }),
    // Same shape as spendByCategory, credits instead of debits - not used
    // for any single category's card (this page only ever renders EXPENSE
    // categories), only to compute the "Reste à vivre" summary below: every
    // credit this month regardless of category, categorized or not.
    prisma.transaction.groupBy({
      by: ["categoryId"],
      where: excludeInternalTransfers({
        amountCents: { gt: BigInt(0) },
        date: { gte: startOfMonth, lt: startOfNextMonth },
        splits: { none: {} },
      }),
      _sum: { amountCents: true },
    }),
    // A split transaction's per-category contribution - filtered on the
    // *parent* transaction's date/isInternalTransfer via the relation, not
    // TransactionSplit's own createdAt, since a split represents a portion
    // of a real transaction that happened on that transaction's date.
    prisma.transactionSplit.groupBy({
      by: ["categoryId"],
      where: excludeInternalTransfersOnSplit({ amountCents: { lt: BigInt(0) } }, { date: { gte: startOfMonth, lt: startOfNextMonth } }),
      _sum: { amountCents: true },
    }),
    prisma.transactionSplit.groupBy({
      by: ["categoryId"],
      where: excludeInternalTransfersOnSplit({ amountCents: { gt: BigInt(0) } }, { date: { gte: startOfMonth, lt: startOfNextMonth } }),
      _sum: { amountCents: true },
    }),
    // Also excludes split transactions - already fully allocated across
    // categories (even a split line with a null categoryId is a deliberate
    // "leave this portion uncategorized" choice, not a "please suggest one"
    // one the bulk picker below can act on for a whole transaction).
    prisma.transaction.findMany({
      where: excludeInternalTransfers({ categoryId: null, splits: { none: {} } }),
      select: { id: true, label: true, amountCents: true },
      orderBy: { date: "desc" },
      take: MAX_UNCATEGORIZED_ROWS,
    }),
  ]);

  // This page's cards are EXPENSE-only - a "budget" cap has no meaning for
  // an income category. INCOME categories (Revenus, or anything else a
  // user points at real income) get their own section on /income instead.
  const expenseCategories = categories.filter((c) => c.kind === "EXPENSE");

  const spendMap = mergeCentsMaps(
    new Map<string | null, number>(spendByCategory.map((row) => [row.categoryId, -Number(row._sum.amountCents ?? BigInt(0))])),
    new Map<string | null, number>(splitSpendByCategory.map((row) => [row.categoryId, -Number(row._sum.amountCents ?? BigInt(0))])),
  );
  const incomeMap = mergeCentsMaps(
    new Map<string | null, number>(incomeByCategory.map((row) => [row.categoryId, Number(row._sum.amountCents ?? BigInt(0))])),
    new Map<string | null, number>(splitIncomeByCategory.map((row) => [row.categoryId, Number(row._sum.amountCents ?? BigInt(0))])),
  );
  // A split line left with no category (a deliberate "leave this portion
  // uncategorized" choice) still counts as uncategorized spend here, even
  // though the transaction itself is excluded from the bulk-suggestion
  // list above - the two mechanisms answer different questions ("how much
  // is uncategorized" vs "which whole transactions can be bulk-assigned").
  const uncategorizedSpentCents = spendMap.get(null) ?? 0;

  // "Reste à vivre" - every credit minus every debit this month, categorized
  // or not, internal transfers already excluded from both maps above. Not
  // scoped to categorized transactions only: it's meant to answer "how much
  // came in vs went out", which shouldn't require perfect categorization to
  // be true.
  const totalIncomeCents = [...incomeMap.values()].reduce((a, b) => a + b, 0);
  const totalExpenseCents = [...spendMap.values()].reduce((a, b) => a + b, 0);
  const resteAVivreCents = totalIncomeCents - totalExpenseCents;

  const groupsByLabel = new Map<string, { label: string; totalCents: number; ids: string[] }>();
  for (const tx of uncategorizedTx) {
    const key = normalizeLabel(tx.label);
    const group = groupsByLabel.get(key) ?? { label: tx.label, totalCents: 0, ids: [] };
    group.totalCents += Number(tx.amountCents);
    group.ids.push(tx.id);
    groupsByLabel.set(key, group);
  }
  const uncategorizedGroups = [...groupsByLabel.values()]
    .sort((a, b) => Math.abs(b.totalCents) - Math.abs(a.totalCents))
    .slice(0, MAX_UNCATEGORIZED_GROUPS);

  // Budget rollover - only categories with at least one full completed
  // month since their anchor even have anything to carry (a category
  // enabled this month has no prior month yet, carry stays 0 without
  // needing a query at all).
  const rolloverCategories = expenseCategories.filter(
    (c) => c.budgetRolloverEnabled && c.budgetCents !== null && c.budgetRolloverEnabledAt !== null && c.budgetRolloverEnabledAt < startOfMonth,
  );
  const rolloverCarryMap = new Map<string, number>();
  if (rolloverCategories.length > 0) {
    const earliestAnchor = new Date(Math.min(...rolloverCategories.map((c) => c.budgetRolloverEnabledAt!.getTime())));
    const rolloverCategoryIds = rolloverCategories.map((c) => c.id);
    const [rolloverTx, rolloverSplits] = await Promise.all([
      prisma.transaction.findMany({
        where: excludeInternalTransfers({
          categoryId: { in: rolloverCategoryIds },
          amountCents: { lt: BigInt(0) },
          date: { gte: earliestAnchor, lt: startOfMonth },
        }),
        select: { categoryId: true, date: true, amountCents: true },
        take: MAX_ROLLOVER_TRANSACTIONS,
      }),
      // A rollover category's spend can also come from split portions of
      // otherwise-unrelated transactions (its own categoryId is null, so
      // it would never match the query above) - same reasoning as
      // splitSpendByCategory further up, just scoped to the anchor-to-now
      // window instead of the current calendar month.
      prisma.transactionSplit.findMany({
        where: excludeInternalTransfersOnSplit(
          { categoryId: { in: rolloverCategoryIds }, amountCents: { lt: BigInt(0) } },
          { date: { gte: earliestAnchor, lt: startOfMonth } },
        ),
        select: { categoryId: true, amountCents: true, transaction: { select: { date: true } } },
        take: MAX_ROLLOVER_TRANSACTIONS,
      }),
    ]);
    // categoryId -> "year-month" -> spentCents, built once from the two
    // queries above rather than one groupBy per category - Prisma has no
    // portable month-truncation in a WHERE/groupBy, so bucketing happens
    // here instead (same shape as groupsByLabel above).
    const spendByCategoryMonth = new Map<string, Map<string, number>>();
    const addToBucket = (categoryId: string, date: Date, amountCents: bigint) => {
      const monthKey = `${date.getUTCFullYear()}-${date.getUTCMonth()}`;
      const byMonth = spendByCategoryMonth.get(categoryId) ?? new Map<string, number>();
      byMonth.set(monthKey, (byMonth.get(monthKey) ?? 0) - Number(amountCents));
      spendByCategoryMonth.set(categoryId, byMonth);
    };
    for (const tx of rolloverTx) addToBucket(tx.categoryId!, tx.date, tx.amountCents);
    for (const split of rolloverSplits) addToBucket(split.categoryId!, split.transaction.date, split.amountCents);
    for (const cat of rolloverCategories) {
      const months = monthsBetween(cat.budgetRolloverEnabledAt!, startOfMonth);
      const byMonth = spendByCategoryMonth.get(cat.id) ?? new Map<string, number>();
      const priorMonthsSpentCents = months.map((m) => byMonth.get(`${m.year}-${m.month}`) ?? 0);
      rolloverCarryMap.set(cat.id, computeRolloverCarryInCents(Number(cat.budgetCents), priorMonthsSpentCents));
    }
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-x-3 gap-y-2">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--foreground)]">{t("title")}</h1>
          <p className="text-sm text-[var(--muted)] mt-1">{t("subtitle")}</p>
        </div>
        {expenseCategories.length > 0 && <AddCategoryDialog />}
      </div>

      {expenseCategories.length === 0 ? (
        <EmptyState
          icon={PiggyBank}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
          action={<AddCategoryDialog />}
        />
      ) : (
        <>
          {(totalIncomeCents > 0 || totalExpenseCents > 0) && (
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
              <span className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">{t("resteAVivreTitle")}</span>
              <div
                className={`text-2xl font-semibold tabular-nums ${resteAVivreCents >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}
              >
                {resteAVivreCents >= 0 ? "+" : ""}
                {formatCurrency(resteAVivreCents)}
              </div>
              <p className="text-xs text-[var(--muted)]">
                {t("resteAVivreBreakdown", {
                  income: formatCurrency(totalIncomeCents),
                  expenses: formatCurrency(totalExpenseCents),
                })}
              </p>
            </div>
          )}

          <div className="space-y-3">
            {expenseCategories.map((cat) => (
              <CategoryCard
                key={cat.id}
                category={cat}
                spentCents={spendMap.get(cat.id) ?? 0}
                rolloverCarryInCents={rolloverCarryMap.get(cat.id) ?? 0}
                t={t}
                tc={tc}
              />
            ))}
          </div>
        </>
      )}

      {uncategorizedSpentCents > 0 && (
        <p className="text-xs text-[var(--muted)] flex items-center gap-1.5">
          <Tag size={12} aria-hidden="true" />
          {t("uncategorizedSpend", { amount: formatCurrency(uncategorizedSpentCents) })}
        </p>
      )}

      {uncategorizedGroups.length > 0 && expenseCategories.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-x-3 gap-y-2">
            <h2 className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">{t("uncategorizedGroupsTitle")}</h2>
            <AutoCategorizeButton />
          </div>
          {uncategorizedGroups.map((g) => (
            <UncategorizedGroupCard
              key={g.label}
              label={g.label}
              count={g.ids.length}
              totalCents={g.totalCents}
              transactionIds={g.ids}
              categories={categories}
            />
          ))}
        </div>
      )}
    </div>
  );
}
