import { getTranslations } from "next-intl/server";
import { formatCurrency } from "@/lib/utils/format";
import { ScrollRegion } from "@/components/ui/scroll-region";
import { scheduleByYear, type ScheduleRow } from "@/lib/domain/loan-schedule";

type Props = {
  readonly rows: readonly ScheduleRow[];
  readonly intlLocale: string;
  /** The bank reports this loan: the schedule is an estimate from the terms. */
  readonly bankReported: boolean;
  readonly now: Date;
};

const th = "px-4 py-2.5 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider whitespace-nowrap";
const td = "px-4 py-2 tabular-nums whitespace-nowrap";

/**
 * The loan's schedule (v2.20): a year per row, the way a bank's table reads,
 * and every instalment behind a native <details> - no client JS for a table
 * that can run to 300 rows.
 */
export async function LoanScheduleSection({ rows, intlLocale, bankReported, now }: Props) {
  const t = await getTranslations("loanSchedule");
  const years = scheduleByYear(rows);
  const thisYear = now.getUTCFullYear();
  const monthFmt = new Intl.DateTimeFormat(intlLocale, { month: "short", year: "numeric", timeZone: "UTC" });

  return (
    <section className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6 space-y-4" aria-labelledby="loan-schedule-title">
      <div>
        <h2 id="loan-schedule-title" className="text-base font-semibold text-[var(--foreground)]">{t("title")}</h2>
        <p className="text-xs text-[var(--muted)] mt-0.5">{bankReported ? t("subtitleBank") : t("subtitle")}</p>
      </div>
      <ScrollRegion label={t("title")}>
        <table className="w-full text-sm min-w-[520px]">
          <thead>
            <tr className="border-b border-[var(--border)]">
              <th className={th}>{t("year")}</th>
              <th className={th}>{t("paid")}</th>
              <th className={th}>{t("interest")}</th>
              <th className={th}>{t("principal")}</th>
              <th className={th}>{t("remaining")}</th>
            </tr>
          </thead>
          <tbody>
            {years.map((y) => (
              <tr
                key={y.year}
                aria-current={y.year === thisYear ? "date" : undefined}
                className={`border-b border-[var(--border)] last:border-0 ${y.year === thisYear ? "bg-[var(--surface-elevated)]" : ""}`}
              >
                <td className={`${td} font-medium text-[var(--foreground)]`}>{y.year}</td>
                <td className={`${td} amount`}>{formatCurrency(y.paidCents)}</td>
                <td className={`${td} amount text-[var(--negative)]`}>{formatCurrency(y.interestCents)}</td>
                <td className={`${td} amount`}>{formatCurrency(y.principalCents)}</td>
                <td className={`${td} amount font-medium text-[var(--foreground)]`}>{formatCurrency(y.remainingCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollRegion>
      <details className="group">
        <summary className="cursor-pointer text-sm text-[var(--accent-text)] hover:underline min-h-[44px] inline-flex items-center rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]">
          {t("showMonths", { count: rows.length })}
        </summary>
        <ScrollRegion label={t("monthsTitle")} className="mt-2">
          <table className="w-full text-sm min-w-[560px]">
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th className={th}>{t("month")}</th>
                <th className={th}>{t("instalment")}</th>
                <th className={th}>{t("interest")}</th>
                <th className={th}>{t("principal")}</th>
                <th className={th}>{t("remaining")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.month} className="border-b border-[var(--border)] last:border-0">
                  <td className={`${td} text-[var(--muted)]`}>
                    {row.month}. {monthFmt.format(row.date)}
                    {row.phase === "deferral" && <span className="ml-1.5 text-[10px] uppercase tracking-wider">{t("deferralTag")}</span>}
                  </td>
                  <td className={`${td} amount`}>{formatCurrency(row.paymentCents + row.insuranceCents)}</td>
                  <td className={`${td} amount text-[var(--negative)]`}>{formatCurrency(row.interestCents)}</td>
                  <td className={`${td} amount`}>{formatCurrency(row.principalCents)}</td>
                  <td className={`${td} amount`}>{formatCurrency(row.remainingCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>
      </details>
    </section>
  );
}
