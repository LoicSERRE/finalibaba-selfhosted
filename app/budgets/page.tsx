export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db/prisma";
import { getViewer, viewAccountIds } from "@/lib/auth-context";
import { PiggyBank, Tag, ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { CategoryCard } from "@/components/budgets/category-card";
import { AddCategoryDialog } from "@/components/budgets/add-category-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { UncategorizedGroupCard } from "@/components/budgets/uncategorized-group-card";
import { AutoCategorizeButton } from "@/components/budgets/auto-categorize-button";
import { formatCurrency, localeToIntl } from "@/lib/utils/format";
import { normalizeLabel } from "@/lib/domain/recurring";
import { monthsBetween, computeRolloverCarryInCents } from "@/lib/domain/budgets";
import { loadBudgetYear, periodCategoryTotals, periodSetAside, savingsCategoryIdsOf } from "@/lib/services/budget-period";
import { SetAsideCard } from "@/components/budgets/set-aside-card";
import { flowNames } from "@/components/budgets/flow-names";
import { excludeFromBudgetTotals, excludeFromBudgetTotalsOnSplit } from "@/lib/domain/transaction-filters";
import { getTranslations, getLocale } from "next-intl/server";
import { moneyFlowFromMaps } from "@/lib/domain/money-flow";
import { MoneyFlowChart } from "@/components/budgets/money-flow-chart";
import { BudgetsYearView } from "@/components/budgets/budgets-year-view";
import { PeriodSwitch } from "@/components/budgets/period-switch";

// "YYYY-MM" - same simple, unvalidated-beyond-shape convention as
// /tax-report's own ?year= param. An invalid or out-of-range value falls
// back to the current month rather than erroring, same reasoning: a
// mistyped URL should degrade to "today", not a 500.
function parseMonthParam(param: string | undefined, now: Date): Date {
  const match = param?.match(/^(\d{4})-(\d{2})$/);
  if (!match) return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  if (month < 1 || month > 12) return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return new Date(Date.UTC(year, month - 1, 1));
}

function monthParam(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

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

export default async function BudgetsPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{ month?: string; year?: string }>;
}>) {
  const { month: monthParamValue, year: yearParamValue } = await searchParams;
  const [t, tc, locale] = await Promise.all([getTranslations("budgets"), getTranslations("common"), getLocale()]);
  const intlLocale = localeToIntl(locale);

  const now = new Date();
  const startOfMonth = parseMonthParam(monthParamValue, now);
  const startOfNextMonth = new Date(Date.UTC(startOfMonth.getUTCFullYear(), startOfMonth.getUTCMonth() + 1, 1));
  const startOfPrevMonth = new Date(Date.UTC(startOfMonth.getUTCFullYear(), startOfMonth.getUTCMonth() - 1, 1));
  const isCurrentMonth = startOfMonth.getTime() === new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).getTime();

  // Categories belong to the viewer; every transaction aggregate is scoped
  // to the accounts they can see. accountScope goes *inside* the
  // excludeFromBudgetTotals wrapper so both invariants hold together.
  const viewer = await getViewer();
  const accountIds = await viewAccountIds(viewer.id);

  // ?year=YYYY: the whole year (v2.20), its own view.
  if (yearParamValue && /^\d{4}$/.test(yearParamValue)) {
    const year = Number(yearParamValue);
    return <BudgetsYearView year={year} data={await loadBudgetYear(viewer.id, accountIds, year)} intlLocale={intlLocale} now={now} />;
  }

  // Every category, every kind - INCOME categories don't get a card on this
  // page (see expenseCategories below) but the "à catégoriser" bulk picker
  // further down still needs to offer them, e.g. for a stray salary-like
  // credit that landed uncategorized. Loaded first: the totals below leave
  // the SAVINGS ones out (v2.21).
  const categories = await prisma.category.findMany({ where: { userId: viewer.id }, orderBy: { name: "asc" } });
  const savingsIds = savingsCategoryIdsOf(categories);

  const [{ spendMap, incomeMap }, setAside, uncategorizedTx] = await Promise.all([
    // Debits and credits per category, split lines in place of their
    // parent - shared with the year view (lib/services/budget-period.ts).
    periodCategoryTotals(accountIds, startOfMonth, startOfNextMonth, savingsIds),
    // Money set aside (v2.21): never in the two maps above, shown beside them.
    periodSetAside(accountIds, startOfMonth, startOfNextMonth, savingsIds),
    // Also excludes split transactions - already fully allocated across
    // categories (even a split line with a null categoryId is a deliberate
    // "leave this portion uncategorized" choice, not a "please suggest one"
    // one the bulk picker below can act on for a whole transaction).
    prisma.transaction.findMany({
      where: excludeFromBudgetTotals({ accountId: { in: accountIds }, categoryId: null, splits: { none: {} } }),
      select: { id: true, label: true, amountCents: true },
      orderBy: { date: "desc" },
      take: MAX_UNCATEGORIZED_ROWS,
    }),
  ]);

  // This page's cards are EXPENSE-only - a "budget" cap has no meaning for
  // an income category. INCOME categories (Revenus, or anything else a
  // user points at real income) get their own section on /income instead.
  const expenseCategories = categories.filter((c) => c.kind === "EXPENSE");

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

  // The same two maps, drawn as a flow (v2.16): the diagram and the figures
  // above it are the same numbers by construction.
  const moneyFlow = moneyFlowFromMaps(incomeMap, spendMap, categories, flowNames(t), setAside);

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
        where: excludeFromBudgetTotals({
          accountId: { in: accountIds },
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
        where: excludeFromBudgetTotalsOnSplit(
          { categoryId: { in: rolloverCategoryIds }, amountCents: { lt: BigInt(0) } },
          { accountId: { in: accountIds }, date: { gte: earliestAnchor, lt: startOfMonth } },
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

      <PeriodSwitch
        active="month"
        monthHref={`/budgets?month=${monthParam(startOfMonth)}`}
        yearHref={`/budgets?year=${startOfMonth.getUTCFullYear()}`}
        labels={{ month: t("year.switchMonth"), year: t("year.switchYear"), group: t("year.switchLabel") }}
      />

      <div className="flex items-center justify-center gap-4">
        <Link
          href={`/budgets?month=${monthParam(startOfPrevMonth)}`}
          className="flex items-center justify-center min-h-[44px] min-w-[44px] rounded-lg text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--surface-elevated)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]"
          aria-label={tc("previous")}
        >
          <ChevronLeft size={18} aria-hidden="true" />
        </Link>
        <span className="text-lg font-semibold tabular-nums text-[var(--foreground)] capitalize w-40 text-center">
          {new Intl.DateTimeFormat(intlLocale, { month: "long", year: "numeric" }).format(startOfMonth)}
        </span>
        <Link
          href={`/budgets?month=${monthParam(startOfNextMonth)}`}
          className="flex items-center justify-center min-h-[44px] min-w-[44px] rounded-lg text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--surface-elevated)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]"
          aria-label={tc("next")}
        >
          <ChevronRight size={18} aria-hidden="true" />
        </Link>
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
                className={`text-2xl font-semibold tabular-nums ${resteAVivreCents >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"} amount`}
              >
                {resteAVivreCents >= 0 ? "+" : ""}
                {formatCurrency(resteAVivreCents)}
              </div>
              <p className="text-xs text-[var(--muted)] amount">
                {t("resteAVivreBreakdown", {
                  income: formatCurrency(totalIncomeCents),
                  expenses: formatCurrency(totalExpenseCents),
                })}
              </p>
            </div>
          )}

          <SetAsideCard
            setAside={setAside}
            categories={categories.filter((c) => c.kind === "SAVINGS")}
            months={1}
            resteAVivreCents={resteAVivreCents}
          />

          <MoneyFlowChart flow={moneyFlow} />

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
        <p className="text-xs text-[var(--muted)] flex items-center gap-1.5 amount">
          <Tag size={12} aria-hidden="true" />
          {t("uncategorizedSpend", { amount: formatCurrency(uncategorizedSpentCents) })}
        </p>
      )}

      {/* All-time, not scoped to the viewed month (uncategorizedTx has no
          date filter) - showing it while browsing a past month would offer
          to bulk-fix transactions that have nothing to do with that month's
          numbers, so it only renders for the current month. */}
      {isCurrentMonth && uncategorizedGroups.length > 0 && expenseCategories.length > 0 && (
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
