import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { centsToEuro, formatCurrency } from "@/lib/utils/format";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { AddCategoryDialog } from "@/components/budgets/add-category-dialog";
import { DeleteButton } from "@/components/shared/delete-button";
import { deleteCategory } from "@/lib/actions/categories";
import { totalSetAside, type SetAside } from "@/lib/domain/set-aside";

type SavingsCategory = { id: string; name: string; color: string; budgetCents: bigint | null };

type Props = {
  readonly setAside: SetAside;
  /** The viewer's SAVINGS categories - this card is where they are managed. */
  readonly categories: readonly SavingsCategory[];
  /** Months the period covers: a SAVINGS category's budget is a monthly target. */
  readonly months: number;
  /** Money in minus spending over the period, the figure beside this card. */
  readonly resteAVivreCents: number;
};

const SAVINGS_COLOR = "#16a34a";
const INVESTMENT_COLOR = "#06b6d4";

/**
 * Money set aside over the period (v2.21) - savings and investing, never
 * spending - and what is left on the current accounts once it is. Nothing
 * here is counted in the spending beside it.
 */
export async function SetAsideCard({ setAside, categories, months, resteAVivreCents }: Props) {
  const [t, tc] = await Promise.all([getTranslations("budgets.setAside"), getTranslations("common")]);
  const total = totalSetAside(setAside);
  const inferred = [
    { key: "savings", name: setAside.savingsCents < 0 ? t("takenFromSavings") : t("savings"), cents: setAside.savingsCents, color: SAVINGS_COLOR },
    { key: "investment", name: setAside.investmentCents < 0 ? t("takenFromInvestment") : t("investment"), cents: setAside.investmentCents, color: INVESTMENT_COLOR },
  ].filter((row) => row.cents !== 0);
  if (inferred.length === 0 && categories.length === 0) return null;
  const leftoverCents = resteAVivreCents - total;

  return (
    <section className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-3" aria-labelledby="set-aside-title">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="set-aside-title" className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider flex items-center gap-1">
          {t("title")}
          <InfoTooltip>{t("hint")}</InfoTooltip>
        </h2>
        <span className={`text-xl font-semibold tabular-nums amount ${total >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>
          {total > 0 ? "+" : ""}
          {formatCurrency(total)}
        </span>
      </div>

      <ul className="space-y-2">
        {inferred.map((row) => (
          <li key={row.key} className="flex items-center justify-between gap-3 text-sm">
            <span className="flex items-center gap-2 min-w-0">
              <span className="w-3 h-3 rounded-full shrink-0" style={{ background: row.color }} aria-hidden="true" />
              <span className="text-[var(--foreground)] break-words">{row.name}</span>
            </span>
            <span className="tabular-nums font-medium text-[var(--foreground)] amount">{formatCurrency(Math.abs(row.cents))}</span>
          </li>
        ))}
        {categories.map((category) => {
          const cents = setAside.byCategory.get(category.id) ?? 0;
          const targetCents = category.budgetCents === null ? null : Number(category.budgetCents) * Math.max(months, 1);
          const pct = targetCents ? Math.max(0, Math.round((cents / targetCents) * 100)) : 0;
          return (
            <li key={category.id} className="space-y-1.5">
              <div className="flex items-center justify-between gap-3 text-sm">
                <Link
                  href={`/budgets/${category.id}`}
                  className="flex items-center gap-2 min-w-0 hover:underline underline-offset-2 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                >
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ background: category.color }} aria-hidden="true" />
                  <span className="text-[var(--foreground)] break-words">{category.name}</span>
                </Link>
                {/* The figures sit on their own line below: beside the name
                    and the two buttons they overlapped it on a phone. */}
                <span className="flex items-center gap-2 shrink-0">
                  <AddCategoryDialog
                    key={`${category.id}-${category.color}`}
                    category={{
                      id: category.id,
                      name: category.name,
                      color: category.color,
                      kind: "SAVINGS",
                      budgetEuro: category.budgetCents === null ? null : centsToEuro(category.budgetCents),
                      rolloverEnabled: false,
                    }}
                  />
                  <DeleteButton
                    iconOnly
                    undoable
                    label={tc("delete")}
                    deletedMessage={tc("deletedNamed", { name: category.name })}
                    onDelete={deleteCategory.bind(null, category.id)}
                  />
                </span>
              </div>
              <p className="text-sm tabular-nums pl-5">
                <span className="font-medium text-[var(--foreground)] amount">{formatCurrency(cents)}</span>
                {targetCents !== null && (
                  <span className="text-[var(--muted)]">
                    {" / "}
                    <span className="amount">{formatCurrency(targetCents)}</span> {t("target")}
                  </span>
                )}
              </p>
              {targetCents !== null && (
                // Same markup as CategoryCard's bar - see the S6819 note there.
                <div
                  className="h-1.5 bg-[var(--surface-elevated)] rounded-full overflow-hidden"
                  role="progressbar"
                  aria-valuenow={Math.min(pct, 100)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${category.name}: ${pct}%`}
                >
                  <div className="h-full rounded-full" style={{ width: `${Math.min(pct, 100)}%`, background: category.color }} />
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <p className="text-xs text-[var(--muted)] border-t border-[var(--border)] pt-2">
        {leftoverCents >= 0 ? t("leftover") : t("drawnCurrent")}{" "}
        <span className={`tabular-nums font-medium amount ${leftoverCents >= 0 ? "text-[var(--foreground)]" : "text-[var(--negative)]"}`}>
          {formatCurrency(Math.abs(leftoverCents))}
        </span>
      </p>
    </section>
  );
}
