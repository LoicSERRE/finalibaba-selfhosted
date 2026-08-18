import Link from "next/link";
import { AddCategoryDialog } from "@/components/budgets/add-category-dialog";
import { DeleteButton } from "@/components/shared/delete-button";
import { deleteCategory } from "@/lib/actions/categories";
import { formatCurrency, centsToEuro } from "@/lib/utils/format";
import type { getTranslations } from "next-intl/server";

type T = Awaited<ReturnType<typeof getTranslations>>;

// One EXPENSE category's card on /budgets - /budgets only ever queries and
// renders CategoryKind.EXPENSE categories (see the page), so this stays a
// plain spend-vs-budget card, no income framing to account for. INCOME
// categories get their own section on /income instead - see that page.
export function CategoryCard({
  category,
  spentCents,
  t,
  tc,
}: Readonly<{
  category: { id: string; name: string; color: string; budgetCents: bigint | null };
  spentCents: number;
  t: T;
  tc: T;
}>) {
  const budgetCents = category.budgetCents !== null ? Number(category.budgetCents) : null;
  const pct = budgetCents ? Math.round((spentCents / budgetCents) * 100) : 0;

  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <Link href={`/budgets/${category.id}`} className="flex items-center gap-2 min-w-0 hover:underline underline-offset-2">
          <span className="w-3 h-3 rounded-full shrink-0" style={{ background: category.color }} aria-hidden="true" />
          <span className="text-sm font-medium text-[var(--foreground)] truncate">{category.name}</span>
        </Link>
        <div className="flex items-center gap-2 shrink-0">
          <AddCategoryDialog
            category={{
              id: category.id,
              name: category.name,
              color: category.color,
              kind: "EXPENSE",
              budgetEuro: category.budgetCents !== null ? centsToEuro(category.budgetCents) : null,
            }}
          />
          <DeleteButton label={tc("delete")} description={tc("irreversible")} onDelete={deleteCategory.bind(null, category.id)} />
        </div>
      </div>

      <div className="flex items-baseline justify-between text-sm">
        <span className="text-[var(--foreground)] font-medium tabular-nums">{formatCurrency(spentCents)}</span>
        <span className="text-[var(--muted)]">
          {budgetCents ? t("ofBudget", { amount: formatCurrency(budgetCents) }) : t("noBudgetSet")}
        </span>
      </div>

      {budgetCents !== null && (
        // Suppressed via sonar-project.properties (typescript:S6819) - see
        // automobile-section.tsx: native <progress> can't express this
        // threshold-based color-coded fill without vendor-prefixed
        // pseudo-elements; full ARIA is already present below.
        <div
          className="h-2 bg-[var(--surface-elevated)] rounded-full overflow-hidden"
          role="progressbar"
          aria-valuenow={Math.min(pct, 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${category.name}: ${pct}%`}
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
}
