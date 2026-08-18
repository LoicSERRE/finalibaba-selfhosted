import { formatCurrency } from "@/lib/utils/format";
import type { InvestPerfRow } from "@/lib/domain/analytics";
import type { getTranslations } from "next-intl/server";

type T = Awaited<ReturnType<typeof getTranslations>>;

export function InvestmentPerformanceSection({
  t,
  intlLocale,
  investPerfRows,
  investTotalCostBasis,
  investTotalValue,
  investTotalGain,
  investTotalGainNet,
  investTotalTax,
  investReturnPct,
  investCAGR,
  investAllHaveDates,
  taxRatePea,
  taxRateCto,
}: Readonly<{
  t: T;
  intlLocale: string;
  investPerfRows: InvestPerfRow[];
  investTotalCostBasis: bigint;
  investTotalValue: bigint;
  investTotalGain: bigint;
  investTotalGainNet: bigint;
  investTotalTax: bigint;
  investReturnPct: number;
  investCAGR: number | null;
  investAllHaveDates: boolean;
  taxRatePea: number;
  taxRateCto: number;
}>) {
  if (investPerfRows.length === 0 || investTotalCostBasis <= BigInt(0)) return null;

  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 sm:p-6">
      <h2 className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider mb-4">
        {t("performance.title")}
      </h2>

      {/* Résumé global */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-5">
        <div>
          <p className="text-xs text-[var(--muted)] mb-1">{t("performance.invested")}</p>
          <p className="text-lg font-semibold tabular-nums text-[var(--foreground)]">
            {formatCurrency(investTotalCostBasis, 0)}
          </p>
        </div>
        <div>
          <p className="text-xs text-[var(--muted)] mb-1">{t("performance.currentValue")}</p>
          <p className="text-lg font-semibold tabular-nums text-[var(--foreground)]">
            {formatCurrency(investTotalValue, 0)}
          </p>
        </div>
        <div>
          <p className="text-xs text-[var(--muted)] mb-1">{t("performance.grossGain")}</p>
          <p className={`text-lg font-semibold tabular-nums ${investTotalGain >= BigInt(0) ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>
            {investTotalGain >= BigInt(0) ? "+" : ""}{formatCurrency(investTotalGain, 0)}
          </p>
          <p className="text-xs text-[var(--muted)] mt-0.5 opacity-70">
            {investReturnPct >= 0 ? "+" : ""}{investReturnPct.toFixed(1)}% {t("performance.onCost")}
            {investCAGR !== null && (
              <> · <span className={investCAGR >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}>
                {investCAGR >= 0 ? "+" : ""}{investCAGR.toFixed(1)}% {t("performance.perYear")}
              </span></>
            )}
          </p>
        </div>
        <div>
          <p className="text-xs text-[var(--muted)] mb-1">{t("performance.netGain")}</p>
          <p className={`text-lg font-semibold tabular-nums ${investTotalGainNet >= BigInt(0) ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>
            {investTotalGainNet >= BigInt(0) ? "+" : ""}{formatCurrency(investTotalGainNet, 0)}
          </p>
          {investTotalTax > BigInt(0) && (
            <p className="text-xs text-[var(--muted)] mt-0.5 opacity-70">
              {t("performance.latentTax")} −{formatCurrency(investTotalTax, 0)}
            </p>
          )}
        </div>
      </div>

      {/* Détail par compte */}
      {investPerfRows.length > 1 && (
        <div className="overflow-x-auto border-t border-[var(--border)] pt-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th scope="col" className="pb-2 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider whitespace-nowrap">{t("performance.colAccount")}</th>
                <th scope="col" className="pb-2 text-right text-xs font-medium text-[var(--muted)] uppercase tracking-wider whitespace-nowrap">{t("performance.colInvested")}</th>
                <th scope="col" className="pb-2 text-right text-xs font-medium text-[var(--muted)] uppercase tracking-wider whitespace-nowrap">{t("performance.colValue")}</th>
                <th scope="col" className="pb-2 text-right text-xs font-medium text-[var(--muted)] uppercase tracking-wider whitespace-nowrap">{t("performance.colGrossGain")}</th>
                <th scope="col" className="hidden sm:table-cell pb-2 text-right text-xs font-medium text-[var(--muted)] uppercase tracking-wider whitespace-nowrap">{t("performance.colNetGain")}</th>
                <th scope="col" className="hidden sm:table-cell pb-2 text-right text-xs font-medium text-[var(--muted)] uppercase tracking-wider whitespace-nowrap">{t("performance.colCagr")}</th>
              </tr>
            </thead>
            <tbody>
              {investPerfRows.map((row, i) => (
                <tr
                  key={row.id}
                  className={`${i < investPerfRows.length - 1 ? "border-b border-[var(--border)]" : ""} hover:bg-[var(--surface-elevated)] transition-colors`}
                >
                  <td className="py-3 pr-4">
                    <p className="font-medium text-[var(--foreground)]">{row.name}</p>
                    <p className="text-xs text-[var(--muted)]">
                      {row.institution}{row.subtype && ` · ${row.subtype}`}
                      {row.investmentStartDate && (
                        <> · {t("performance.since", { date: row.investmentStartDate.toLocaleDateString(intlLocale, { month: "short", year: "numeric" }) })}</>
                      )}
                    </p>
                  </td>
                  <td className="py-3 px-2 text-right tabular-nums text-[var(--muted)]">
                    {formatCurrency(row.costBasis, 0)}
                  </td>
                  <td className="py-3 px-2 text-right tabular-nums font-medium text-[var(--foreground)]">
                    {formatCurrency(row.value, 0)}
                  </td>
                  <td className="py-3 px-2 text-right tabular-nums">
                    <span className={row.gain >= BigInt(0) ? "text-[var(--positive)]" : "text-[var(--negative)]"}>
                      {row.gain >= BigInt(0) ? "+" : ""}{formatCurrency(row.gain, 0)}
                    </span>
                    <span className="block text-xs text-[var(--muted)] opacity-70">
                      {row.returnPct >= 0 ? "+" : ""}{row.returnPct.toFixed(1)}%
                    </span>
                  </td>
                  <td className="hidden sm:table-cell py-3 px-2 text-right tabular-nums">
                    <span className={row.gainNet >= BigInt(0) ? "text-[var(--positive)]" : "text-[var(--negative)]"}>
                      {row.gainNet >= BigInt(0) ? "+" : ""}{formatCurrency(row.gainNet, 0)}
                    </span>
                  </td>
                  <td className="hidden sm:table-cell py-3 pl-2 text-right tabular-nums">
                    {row.cagr !== null ? (
                      <span className={row.cagr >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}>
                        {row.cagr >= 0 ? "+" : ""}{row.cagr.toFixed(1)}% {t("performance.perYear")}
                      </span>
                    ) : (
                      <span className="text-[var(--muted)] text-xs">-</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-[var(--muted)] mt-3 opacity-70">
        {t("performance.cagr", { pea: (taxRatePea * 100).toFixed(1), cto: (taxRateCto * 100).toFixed(1) })}
        {!investAllHaveDates && investPerfRows.length > 0 && (
          <> · {t("performance.addDateHint")}</>
        )}
      </p>
    </div>
  );
}
