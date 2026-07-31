import { formatCurrency } from "@/lib/utils/format";
import type { PerformanceRow } from "@/lib/domain/analytics";
import type { getTranslations } from "next-intl/server";

type T = Awaited<ReturnType<typeof getTranslations>>;

export function MonthlyPerformanceSection({
  t,
  performanceRows,
}: {
  t: T;
  performanceRows: PerformanceRow[];
}) {
  if (performanceRows.length <= 1) return null;

  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
      <div className="px-6 py-4 border-b border-[var(--border)]">
        <h2 className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
          {t("monthlyPerf.title")}
        </h2>
      </div>
      <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--border)]">
            <th scope="col" className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider">{t("monthlyPerf.colMonth")}</th>
            <th scope="col" className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider">{t("monthlyPerf.colNetWorth")}</th>
            <th scope="col" className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider">{t("monthlyPerf.colChange")}</th>
            <th scope="col" className="hidden sm:table-cell px-6 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider">{t("monthlyPerf.colPct")}</th>
          </tr>
        </thead>
        <tbody>
          {[...performanceRows].reverse().map((row, i) => (
            <tr
              key={row.month}
              className={`${
                i < performanceRows.length - 1 ? "border-b border-[var(--border)]" : ""
              } hover:bg-[var(--surface-elevated)] transition-colors`}
            >
              <td className="px-4 sm:px-6 py-3 text-[var(--muted)] capitalize">{row.date}</td>
              <td className="px-4 sm:px-6 py-3 tabular-nums font-medium text-[var(--foreground)]">
                {formatCurrency(row.netWorth, 0)}
              </td>
              <td className="px-4 sm:px-6 py-3 tabular-nums">
                {row.delta === null ? (
                  <span className="text-[var(--muted)]">-</span>
                ) : (
                  <span className={row.delta >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}>
                    {row.delta >= 0 ? "+" : ""}{formatCurrency(row.delta, 0)}
                  </span>
                )}
              </td>
              <td className="hidden sm:table-cell px-6 py-3 tabular-nums">
                {row.deltaPct === null ? (
                  <span className="text-[var(--muted)]">-</span>
                ) : (
                  <span className={row.deltaPct >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}>
                    {row.deltaPct >= 0 ? "+" : ""}{row.deltaPct.toFixed(1)}%
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}
