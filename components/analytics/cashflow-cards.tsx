import { formatCurrency } from "@/lib/utils/format";
import Link from "next/link";
import type { getTranslations } from "next-intl/server";

type T = Awaited<ReturnType<typeof getTranslations>>;

// Renders 2 independent multi-state cards (savings rate, runway) in one
// component to keep their shared layout grid together - splitting further
// would trade this file's complexity for prop-drilling between two
// components that only ever render side by side.
// eslint-disable-next-line sonarjs/cognitive-complexity
export function CashflowCards({
  t,
  hasSalary,
  savingsRate,
  hasDeclaredSavings,
  monthlySavedCents,
  salaryNetCents,
  momDelta,
  hasExpenses,
  runwayMonths,
  savingsCents,
  monthlyExpensesCents,
}: Readonly<{
  t: T;
  hasSalary: boolean;
  savingsRate: number | null;
  hasDeclaredSavings: boolean;
  monthlySavedCents: bigint;
  salaryNetCents: bigint;
  momDelta: number | null;
  hasExpenses: boolean;
  runwayMonths: number | null;
  savingsCents: bigint;
  monthlyExpensesCents: bigint;
}>) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {/* Taux d'épargne */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
        <p className="text-xs text-[var(--muted)] uppercase tracking-wider mb-3">{t("savingsRate.title")}</p>
        {!hasSalary ? (
          <div>
            <p className="text-2xl font-semibold text-[var(--muted)]">-</p>
            <Link href="/settings" className="text-xs text-[var(--accent-text)] mt-1 inline-flex items-center min-h-[44px] hover:underline rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]">
              {t("savingsRate.configureSalary")}
            </Link>
          </div>
        ) : savingsRate === null ? (
          <p className="text-2xl font-semibold text-[var(--muted)]">-</p>
        ) : (
          <div>
            <div className="flex items-baseline gap-2">
              <p
                className={`text-2xl font-semibold tabular-nums ${
                  savingsRate >= 40
                    ? "text-[var(--positive)]"
                    : savingsRate >= 20
                    ? "text-[var(--accent)]"
                    : savingsRate < 0
                    ? "text-[var(--negative)]"
                    : "text-[var(--foreground)]"
                }`}
              >
                {savingsRate >= 0 ? "+" : ""}{savingsRate.toFixed(1)}%
              </p>
              {savingsRate >= 40 && (
                <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-[var(--positive)]/15 text-[var(--positive)]">
                  {t("savingsRate.elite")}
                </span>
              )}
              {savingsRate >= 20 && savingsRate < 40 && (
                <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-[var(--accent)]/15 text-[var(--accent-text)]">
                  {t("savingsRate.good")}
                </span>
              )}
            </div>
            <p className="text-xs text-[var(--muted)] mt-1">
              {hasDeclaredSavings
                ? t("savingsRate.declaredSavings", { saved: formatCurrency(monthlySavedCents, 0), salary: formatCurrency(salaryNetCents, 0) })
                : t("savingsRate.momSavings", { mom: formatCurrency(momDelta!, 0), salary: formatCurrency(salaryNetCents, 0) })
              }
            </p>
            <p className="text-xs text-[var(--muted)] mt-0.5 opacity-70">
              {hasDeclaredSavings
                ? t("savingsRate.hintDeclared")
                : t("savingsRate.hintMom")
              }
            </p>
          </div>
        )}
      </div>

      {/* Runway */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
        <p className="text-xs text-[var(--muted)] uppercase tracking-wider mb-3">{t("runway.title")}</p>
        {!hasExpenses ? (
          <div>
            <p className="text-2xl font-semibold text-[var(--muted)]">-</p>
            <Link href="/settings" className="text-xs text-[var(--accent-text)] mt-1 inline-flex items-center min-h-[44px] hover:underline rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]">
              {t("runway.configureExpenses")}
            </Link>
          </div>
        ) : runwayMonths === null ? (
          <p className="text-2xl font-semibold text-[var(--muted)]">-</p>
        ) : (
          <div>
            <p
              className={`text-2xl font-semibold tabular-nums ${
                runwayMonths >= 12
                  ? "text-[var(--positive)]"
                  : runwayMonths >= 6
                  ? "text-[var(--accent)]"
                  : "text-[var(--negative)]"
              }`}
            >
              {t("runway.months", { count: Math.floor(runwayMonths) })}
            </p>
            <p className="text-xs text-[var(--muted)] mt-1">
              {t("runway.detail", { savings: formatCurrency(savingsCents, 0), expenses: formatCurrency(monthlyExpensesCents, 0) })}
            </p>
            <p className="text-xs text-[var(--muted)] mt-0.5 opacity-70">
              {runwayMonths >= 12
                ? t("runway.safe")
                : runwayMonths >= 6
                ? t("runway.ok")
                : t("runway.warning")}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
