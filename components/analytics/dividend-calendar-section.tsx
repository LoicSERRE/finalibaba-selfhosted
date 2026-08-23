import { formatCurrency } from "@/lib/utils/format";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import type { DividendCalendarRow } from "@/lib/domain/analytics";
import type { getTranslations } from "next-intl/server";

type T = Awaited<ReturnType<typeof getTranslations>>;

export function DividendCalendarSection({
  t,
  intlLocale,
  dividendCalendar,
  annualDividendsNetCents,
  annualDividendsCents,
}: Readonly<{
  t: T;
  intlLocale: string;
  dividendCalendar: DividendCalendarRow[];
  annualDividendsNetCents: bigint;
  annualDividendsCents: bigint;
}>) {
  if (dividendCalendar.length === 0) return null;

  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 sm:p-6">
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider flex items-center gap-1">
          {t("dividends.title")}
          <InfoTooltip>
            {t("dividends.footnote")} {t("dividends.withholding")}
          </InfoTooltip>
        </h2>
        <div className="text-right">
          <span className="text-sm font-semibold tabular-nums text-[var(--positive)]">
            ~{formatCurrency(annualDividendsNetCents, 0)} {t("dividends.netPerYear")}
          </span>
          <span className="text-xs text-[var(--muted)] ml-2">
            brut {formatCurrency(annualDividendsCents, 0)}
          </span>
        </div>
      </div>
      <div className="divide-y divide-[var(--border)]">
        {dividendCalendar.map((row) => (
          <div key={row.isin} className="py-3 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-medium text-[var(--foreground)] break-words">{row.name}</p>
              <p className="text-xs text-[var(--muted)]">
                {row.symbol} · yield {(row.divYield * 100).toFixed(1)}%
                {row.annualRatePerShare != null && (
                  <> · {row.annualRatePerShare.toFixed(2)} $/action</>
                )}
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-sm font-semibold tabular-nums text-[var(--positive)]">
                ~{formatCurrency(row.annualNetCents, 0)} net
              </p>
              <p className="text-xs text-[var(--muted)]">
                brut {formatCurrency(row.annualEstCents, 0)}
                {row.taxRate > 0 && (
                  <> · −{(row.taxRate * 100).toFixed(1)}%
                  {row.country !== "FR" && row.subtype !== "PEA" && (
                    <span title="Retenue à la source 15% + PS 17,2% (crédit IR)"> ({row.country})</span>
                  )}</>
                )}
              </p>
              {row.exDividendDate ? (
                <p className={`text-xs tabular-nums mt-0.5 ${
                  row.isPast ? "text-[var(--muted)]" : row.isSoon ? "text-[var(--warning)]" : "text-[var(--foreground)]"
                }`}>
                  {row.isPast
                    ? t("dividends.exDivPast", { date: row.exDividendDate.toLocaleDateString(intlLocale) })
                    : row.daysLeft === 0
                    ? t("dividends.exDivToday")
                    : t("dividends.exDivSoon", { days: row.daysLeft!, date: row.exDividendDate.toLocaleDateString(intlLocale) })
                  }
                </p>
              ) : (
                <p className="text-xs text-[var(--muted)] mt-0.5">{t("dividends.exDivUnknown")}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
