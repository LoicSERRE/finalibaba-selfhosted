export const dynamic = "force-dynamic";

import { prisma } from "@/lib/prisma";
import { PiggyBank, Tag } from "lucide-react";
import Link from "next/link";
import { AddCategoryDialog } from "@/components/add-category-dialog";
import { DeleteButton } from "@/components/delete-button";
import { EmptyState } from "@/components/empty-state";
import { UncategorizedGroupCard } from "@/components/uncategorized-group-card";
import { deleteCategory } from "@/lib/actions/categories";
import { formatCurrency, centsToEuro } from "@/lib/format";
import { normalizeLabel } from "@/lib/recurring";
import { getTranslations } from "next-intl/server";

// How many of the most-frequent uncategorized label groups to surface at
// once - bounded so the page doesn't turn into a full inbox-zero triage
// list; the rest still show up once the top ones are cleared (this section
// only ever queries the current, still-uncategorized set on each render).
const MAX_UNCATEGORIZED_GROUPS = 8;

export default async function BudgetsPage() {
  const [t, tc] = await Promise.all([getTranslations("budgets"), getTranslations("common")]);

  const now = new Date();
  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const startOfNextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  const [categories, spendByCategory, uncategorizedTx] = await Promise.all([
    prisma.category.findMany({ orderBy: { name: "asc" } }),
    prisma.transaction.groupBy({
      by: ["categoryId"],
      where: {
        amountCents: { lt: BigInt(0) },
        date: { gte: startOfMonth, lt: startOfNextMonth },
      },
      _sum: { amountCents: true },
    }),
    prisma.transaction.findMany({
      where: { categoryId: null },
      select: { id: true, label: true, amountCents: true },
    }),
  ]);

  const spendMap = new Map<string | null, number>(
    spendByCategory.map((row) => [row.categoryId, -Number(row._sum.amountCents ?? BigInt(0))])
  );
  const uncategorizedSpentCents = spendMap.get(null) ?? 0;

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
        {categories.length > 0 && <AddCategoryDialog />}
      </div>

      {categories.length === 0 ? (
        <EmptyState
          icon={PiggyBank}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
          action={<AddCategoryDialog />}
        />
      ) : (
        <div className="space-y-3">
          {categories.map((cat) => {
            const spentCents = spendMap.get(cat.id) ?? 0;
            const budgetCents = cat.budgetCents !== null ? Number(cat.budgetCents) : null;
            const pct = budgetCents ? Math.round((spentCents / budgetCents) * 100) : 0;

            return (
              <div key={cat.id} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <Link href={`/budgets/${cat.id}`} className="flex items-center gap-2 min-w-0 hover:underline underline-offset-2">
                    <span className="w-3 h-3 rounded-full shrink-0" style={{ background: cat.color }} aria-hidden="true" />
                    <span className="text-sm font-medium text-[var(--foreground)] truncate">{cat.name}</span>
                  </Link>
                  <div className="flex items-center gap-2 shrink-0">
                    <AddCategoryDialog
                      category={{
                        id: cat.id,
                        name: cat.name,
                        color: cat.color,
                        budgetEuro: cat.budgetCents !== null ? centsToEuro(cat.budgetCents) : null,
                      }}
                    />
                    <DeleteButton
                      label={tc("delete")}
                      description={tc("irreversible")}
                      onDelete={deleteCategory.bind(null, cat.id)}
                    />
                  </div>
                </div>

                <div className="flex items-baseline justify-between text-sm">
                  <span className="text-[var(--foreground)] font-medium tabular-nums">{formatCurrency(spentCents)}</span>
                  <span className="text-[var(--muted)]">
                    {budgetCents ? t("ofBudget", { amount: formatCurrency(budgetCents) }) : t("noBudgetSet")}
                  </span>
                </div>

                {budgetCents !== null && (
                  <div
                    className="h-2 bg-[var(--surface-elevated)] rounded-full overflow-hidden"
                    role="progressbar"
                    aria-valuenow={Math.min(pct, 100)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${cat.name}: ${pct}%`}
                  >
                    <div
                      className={`h-full rounded-full ${
                        pct > 100 ? "bg-[var(--negative)]" : pct > 80 ? "bg-[var(--warning)]" : "bg-[var(--positive)]"
                      }`}
                      style={{ width: `${Math.min(pct, 100)}%` }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {uncategorizedSpentCents > 0 && (
        <p className="text-xs text-[var(--muted)] flex items-center gap-1.5">
          <Tag size={12} aria-hidden="true" />
          {t("uncategorizedSpend", { amount: formatCurrency(uncategorizedSpentCents) })}
        </p>
      )}

      {uncategorizedGroups.length > 0 && categories.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">{t("uncategorizedGroupsTitle")}</h2>
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
