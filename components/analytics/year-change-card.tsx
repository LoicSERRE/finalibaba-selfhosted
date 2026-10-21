import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { formatCurrency } from "@/lib/utils/format";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import type { YearChange } from "@/lib/domain/analytics-types";

type Props = {
  readonly change: YearChange;
  /** Money in minus money out since 1 January, the /budgets?year= figure. */
  readonly savedCents: number;
  readonly year: number;
  readonly intlLocale: string;
};

const sign = (cents: number) => (cents >= 0 ? "+" : "");
const tone = (cents: number) => (cents >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]");

/**
 * What moved net worth this year (v2.20): what was saved out of income, and
 * the rest - markets, interest, revaluations. The detail lives where it
 * already is, so the card links there instead of repeating it.
 */
export async function YearChangeCard({ change, savedCents, year, intlLocale }: Props) {
  const t = await getTranslations("analytics.yearChange");
  const delta = change.endCents - change.startCents;
  const rest = delta - savedCents;
  const [y, m] = change.startMonth.split("-").map(Number);
  const fromLabel =
    y < year ? t("fromJanuary") : t("fromMonth", { month: new Intl.DateTimeFormat(intlLocale, { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1))) });

  return (
    <section className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 space-y-4" aria-labelledby="year-change-title">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="year-change-title" className="text-xs text-[var(--muted)] uppercase tracking-wider flex items-center gap-1">
          {t("title", { year })}
          <InfoTooltip>{t("hint")}</InfoTooltip>
        </h2>
        <span className="text-xs text-[var(--muted)]">{fromLabel}</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
        <div>
          <p className="text-[var(--muted)] text-xs mb-1">{t("netWorth")}</p>
          <p className={`text-2xl font-semibold tabular-nums amount ${tone(delta)}`}>
            {sign(delta)}
            {formatCurrency(delta, 0)}
          </p>
          <p className="text-xs text-[var(--muted)] amount">
            {formatCurrency(change.startCents, 0)} → {formatCurrency(change.endCents, 0)}
          </p>
        </div>
        <div>
          <p className="text-[var(--muted)] text-xs mb-1">{t("saved")}</p>
          <p className={`text-lg font-semibold tabular-nums amount ${tone(savedCents)}`}>
            {sign(savedCents)}
            {formatCurrency(savedCents, 0)}
          </p>
          <Link href={`/budgets?year=${year}`} className="text-xs text-[var(--accent-text)] hover:underline">{t("savedLink")}</Link>
        </div>
        <div>
          <p className="text-[var(--muted)] text-xs mb-1">{t("rest")}</p>
          <p className={`text-lg font-semibold tabular-nums amount ${tone(rest)}`}>
            {sign(rest)}
            {formatCurrency(rest, 0)}
          </p>
          <p className="text-xs">
            <Link href={`/income?year=${year}`} className="text-[var(--accent-text)] hover:underline">{t("incomeLink")}</Link>
            {" · "}
            <Link href={`/tax-report?year=${year}`} className="text-[var(--accent-text)] hover:underline">{t("taxLink")}</Link>
          </p>
        </div>
      </div>
    </section>
  );
}
