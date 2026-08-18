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

export default async function BudgetsPage() {
  const [t, tc] = await Promise.all([getTranslations("budgets"), getTranslations("common")]);

  const now = new Date();
  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const startOfNextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  const [categories, spendByCategory, incomeByCategory, uncategorizedTx] = await Promise.all([
    // Every category, both kinds - INCOME categories don't get a card on
    // this page (see expenseCategories below) but the "à catégoriser" bulk
    // picker further down still needs to offer them, e.g. for a stray
    // salary-like credit that landed uncategorized.
    prisma.category.findMany({ orderBy: { name: "asc" } }),
    prisma.transaction.groupBy({
      by: ["categoryId"],
      where: {
        amountCents: { lt: BigInt(0) },
        date: { gte: startOfMonth, lt: startOfNextMonth },
        isInternalTransfer: false,
      },
      _sum: { amountCents: true },
    }),
    // Same shape as spendByCategory, credits instead of debits - not used
    // for any single category's card (this page only ever renders EXPENSE
    // categories), only to compute the "Reste à vivre" summary below: every
    // credit this month regardless of category, categorized or not.
    prisma.transaction.groupBy({
      by: ["categoryId"],
      where: {
        amountCents: { gt: BigInt(0) },
        date: { gte: startOfMonth, lt: startOfNextMonth },
        isInternalTransfer: false,
      },
      _sum: { amountCents: true },
    }),
    prisma.transaction.findMany({
      where: { categoryId: null, isInternalTransfer: false },
      select: { id: true, label: true, amountCents: true },
      orderBy: { date: "desc" },
      take: MAX_UNCATEGORIZED_ROWS,
    }),
  ]);

  // This page's cards are EXPENSE-only - a "budget" cap has no meaning for
  // an income category. INCOME categories (Revenus, or anything else a
  // user points at real income) get their own section on /income instead.
  const expenseCategories = categories.filter((c) => c.kind === "EXPENSE");

  const spendMap = new Map<string | null, number>(
    spendByCategory.map((row) => [row.categoryId, -Number(row._sum.amountCents ?? BigInt(0))])
  );
  const incomeMap = new Map<string | null, number>(
    incomeByCategory.map((row) => [row.categoryId, Number(row._sum.amountCents ?? BigInt(0))])
  );
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

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-3">
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
              <CategoryCard key={cat.id} category={cat} spentCents={spendMap.get(cat.id) ?? 0} t={t} tc={tc} />
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
          <div className="flex items-center justify-between gap-3">
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
