import { formatCurrency } from "@/lib/format";
import type { getTranslations } from "next-intl/server";

type T = Awaited<ReturnType<typeof getTranslations>>;

export function FiscalSummarySection({
  td,
  hasCostBasis,
  taxRate,
  totalCostBasis,
  totalGain,
  totalGainPct,
  totalTax,
  netAfterTax,
  holdingsCount,
}: {
  td: T;
  hasCostBasis: boolean;
  taxRate: number | null;
  totalCostBasis: bigint;
  totalGain: bigint;
  totalGainPct: number | null;
  totalTax: bigint;
  netAfterTax: bigint;
  holdingsCount: number;
}) {
  return (
    <>
      {hasCostBasis && taxRate !== null && (
        <div className="border-t border-[var(--border)] px-6 py-4 bg-[var(--surface-elevated)]">
          <div className="flex items-center justify-between gap-6 text-sm flex-wrap">
            <div>
              <p className="text-xs text-[var(--muted)] mb-0.5">{td("fiscalSummary.costBasis")}</p>
              <p className="tabular-nums font-medium text-[var(--foreground)]">
                {formatCurrency(totalCostBasis)}
              </p>
            </div>
            <div>
              <p className="text-xs text-[var(--muted)] mb-0.5">{td("fiscalSummary.latentGain")}</p>
              <p
                className={`tabular-nums font-semibold ${
                  totalGain >= BigInt(0) ? "text-[var(--positive)]" : "text-[var(--negative)]"
                }`}
              >
                {totalGain >= BigInt(0) ? "+" : ""}
                {formatCurrency(totalGain)}
                {totalGainPct !== null && (
                  <span className="text-xs font-normal ml-1">
                    ({totalGainPct >= 0 ? "+" : ""}
                    {totalGainPct.toFixed(1)}%)
                  </span>
                )}
              </p>
            </div>
            <div>
              <p className="text-xs text-[var(--muted)] mb-0.5">
                {td("fiscalSummary.taxLabel", { rate: ((taxRate ?? 0) * 100).toFixed(1) })}
              </p>
              <p className="tabular-nums font-semibold text-[var(--negative)]">
                -{formatCurrency(totalTax)}
              </p>
            </div>
            <div className="sm:border-l sm:border-[var(--border)] sm:pl-6">
              <p className="text-xs text-[var(--muted)] mb-0.5">{td("fiscalSummary.netAfterTax")}</p>
              <p className="tabular-nums font-semibold text-[var(--accent-text)]">
                {formatCurrency(netAfterTax)}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Hint si pas de prix de revient */}
      {!hasCostBasis && holdingsCount > 0 && (
        <div className="border-t border-[var(--border)] px-6 py-3 text-xs text-[var(--muted)]">
          {taxRate === null ? td("fiscalSubtype") : td("fiscalTip")}
        </div>
      )}
    </>
  );
}
