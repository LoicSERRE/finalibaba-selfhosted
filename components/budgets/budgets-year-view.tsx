import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { formatCurrency } from "@/lib/utils/format";
import { moneyFlowFromMaps } from "@/lib/domain/money-flow";
import { monthlyCashflow, monthsCovered, savingsRatePct, yearCategoryRows } from "@/lib/domain/budget-year";
import type { BudgetYearData } from "@/lib/services/budget-period";
import { MoneyFlowChart } from "@/components/budgets/money-flow-chart";
import { YearCashflowChart } from "@/components/budgets/year-cashflow-chart";
import { PeriodSwitch } from "@/components/budgets/period-switch";

type Props = {
  readonly year: number;
  /** Loaded by the page (lib/services/budget-period.ts): a component never queries. */
  readonly data: BudgetYearData;
  readonly intlLocale: string;
  readonly now: Date;
};

const kpiBox = "bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4";
const kpiLabel = "text-xs text-[var(--muted)] uppercase tracking-wider";
const kpiValue = "text-xl font-semibold tabular-nums mt-1";

const navLink =
  "flex items-center justify-center min-h-[44px] min-w-[44px] rounded-lg text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--surface-elevated)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]";

/**
 * /budgets?year= (v2.20): the month view's figures over a calendar year -
 * what came in and went out, what was kept, where it went by category
 * against the budget for the months covered. Dividends, interest and
 * realised gains already have their year on /income and /tax-report, so
 * this links there instead of repeating them.
 */
export async function BudgetsYearView({ year, data, intlLocale, now }: Props) {
  const [t, tc] = await Promise.all([getTranslations("budgets"), getTranslations("common")]);
  const { categories, spendMap, incomeMap, amounts } = data;

  const months = monthsCovered(year, now);
  const incomeCents = [...incomeMap.values()].reduce((a, b) => a + b, 0);
  const expenseCents = [...spendMap.values()].reduce((a, b) => a + b, 0);
  const savedCents = incomeCents - expenseCents;
  const rate = savingsRatePct(incomeCents, expenseCents);
  const rows = yearCategoryRows(spendMap, categories.filter((c) => c.kind === "EXPENSE"), months, {
    name: t("flow.uncategorizedSpend"),
    color: "#71717a",
  });
  const monthFmt = new Intl.DateTimeFormat(intlLocale, { month: "short", timeZone: "UTC" });
  const chart = monthlyCashflow(amounts).map((m) => ({
    label: monthFmt.format(new Date(Date.UTC(year, m.month, 1))),
    income: m.incomeCents,
    expense: m.expenseCents,
  }));
  const flow = moneyFlowFromMaps(incomeMap, spendMap, categories, {
    income: t("flow.income"),
    savings: t("flow.savings"),
    drawn: t("flow.drawn"),
    other: t("flow.other"),
    uncategorizedIncome: t("flow.uncategorizedIncome"),
    uncategorizedSpend: t("flow.uncategorizedSpend"),
  });
  const hasData = incomeCents > 0 || expenseCents > 0;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-[var(--foreground)]">{t("title")}</h1>
        <p className="text-sm text-[var(--muted)] mt-1">{t("year.subtitle")}</p>
      </div>

      <PeriodSwitch
        active="year"
        monthHref={year === now.getUTCFullYear() ? "/budgets" : `/budgets?month=${year}-12`}
        yearHref={`/budgets?year=${year}`}
        labels={{ month: t("year.switchMonth"), year: t("year.switchYear"), group: t("year.switchLabel") }}
      />

      <div className="flex items-center justify-center gap-4">
        <Link href={`/budgets?year=${year - 1}`} className={navLink} aria-label={tc("previous")}>
          <ChevronLeft size={18} aria-hidden="true" />
        </Link>
        <span className="text-lg font-semibold tabular-nums text-[var(--foreground)] w-40 text-center">{year}</span>
        <Link href={`/budgets?year=${year + 1}`} className={navLink} aria-label={tc("next")}>
          <ChevronRight size={18} aria-hidden="true" />
        </Link>
      </div>

      {hasData ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className={kpiBox}>
              <p className={kpiLabel}>{t("year.income")}</p>
              <p className={`${kpiValue} text-[var(--positive)] amount`}>{formatCurrency(incomeCents, 0)}</p>
            </div>
            <div className={kpiBox}>
              <p className={kpiLabel}>{t("year.expenses")}</p>
              <p className={`${kpiValue} text-[var(--negative)] amount`}>{formatCurrency(expenseCents, 0)}</p>
            </div>
            <div className={kpiBox}>
              <p className={kpiLabel}>{t("year.saved")}</p>
              <p className={`${kpiValue} ${savedCents >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"} amount`}>
                {savedCents >= 0 ? "+" : ""}
                {formatCurrency(savedCents, 0)}
              </p>
            </div>
            <div className={kpiBox}>
              <p className={kpiLabel}>{t("year.savingsRate")}</p>
              <p className={`${kpiValue} text-[var(--foreground)]`}>{rate === null ? "-" : `${rate.toFixed(0)} %`}</p>
            </div>
          </div>
          {months > 0 && months < 12 && <p className="text-xs text-[var(--muted)] -mt-3">{t("year.partial", { months })}</p>}

          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-3">
            <h2 className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">{t("year.chartTitle")}</h2>
            <YearCashflowChart data={chart} />
          </div>

          <MoneyFlowChart flow={flow} title={t("year.flowTitle")} />

          <section className="space-y-3" aria-labelledby="year-categories-title">
            <h2 id="year-categories-title" className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">{t("year.byCategory")}</h2>
            {rows.map((r) => {
              const over = r.budgetCents !== null && r.spentCents > r.budgetCents;
              const pct = r.budgetCents ? Math.min(100, (r.spentCents / r.budgetCents) * 100) : r.sharePct;
              return (
                <div key={r.id ?? "none"} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <span className="flex items-center gap-2 text-sm font-medium text-[var(--foreground)] min-w-0">
                      <span className="w-3 h-3 rounded-full shrink-0" style={{ background: r.color }} aria-hidden="true" />
                      <span className="break-words">{r.name}</span>
                    </span>
                    <span className="text-sm tabular-nums">
                      <span className={`amount font-medium ${over ? "text-[var(--negative)]" : "text-[var(--foreground)]"}`}>{formatCurrency(r.spentCents, 0)}</span>
                      {r.budgetCents !== null && (
                        <span className="text-[var(--muted)]">
                          {" / "}
                          <span className="amount">{formatCurrency(r.budgetCents, 0)}</span>
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-[var(--surface-elevated)] overflow-hidden" aria-hidden="true">
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: over ? "var(--negative)" : r.color }} />
                  </div>
                  <p className="text-xs text-[var(--muted)]">
                    <span className="amount">{t("year.perMonth", { amount: formatCurrency(r.monthlyAverageCents, 0) })}</span>
                    {" · "}
                    {t("year.share", { pct: r.sharePct.toFixed(0) })}
                  </p>
                </div>
              );
            })}
          </section>
        </>
      ) : (
        <p className="text-sm text-[var(--muted)] text-center py-8">{t("year.empty")}</p>
      )}

      <p className="text-xs text-[var(--muted)]">
        {t("year.elsewhere")}{" "}
        <Link href={`/income?year=${year}`} className="text-[var(--accent-text)] hover:underline">{t("year.incomeLink")}</Link>
        {" · "}
        <Link href={`/tax-report?year=${year}`} className="text-[var(--accent-text)] hover:underline">{t("year.taxLink")}</Link>
      </p>
    </div>
  );
}
