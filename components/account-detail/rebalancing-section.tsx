import { formatCurrency } from "@/lib/utils/format";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import type { RebalancingRow } from "@/lib/domain/account-detail";
import type { getTranslations } from "next-intl/server";

type T = Awaited<ReturnType<typeof getTranslations>>;

export function RebalancingSection({
  td,
  rebalancingRows,
}: Readonly<{
  td: T;
  rebalancingRows: RebalancingRow[];
}>) {
  if (rebalancingRows.length === 0) return null;

  return (
    <div className="border-t border-[var(--border)] px-6 py-4">
      <p className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider mb-3 flex items-center gap-1">
        {td("rebalancing.title")}
        <InfoTooltip>{td("rebalancing.footnote")}</InfoTooltip>
      </p>
      <div className="space-y-3">
        {rebalancingRows.map((h) => (
          <div key={h.id} className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-[var(--foreground)]">{h.ticker}</p>
              <p className="text-xs text-[var(--muted)]">
                {td("rebalancing.currentVsTarget", { current: h.pct, target: h.targetPctInt })}
                {h.driftPts !== 0 && (
                  <span className={h.driftPts > 0 ? "text-[var(--negative)]" : "text-[var(--positive)]"}>
                    {" "}({h.driftPts > 0 ? "+" : ""}{h.driftPts} {td("rebalancing.pts")})
                  </span>
                )}
              </p>
            </div>
            {h.showSuggestion && (
              <div className="text-right shrink-0">
                <p className={`text-sm font-medium tabular-nums ${h.isOverweight ? "text-[var(--negative)]" : "text-[var(--positive)]"}`}>
                  {h.isOverweight ? td("rebalancing.suggestSell") : td("rebalancing.suggestBuy")}{" "}
                  {formatCurrency(h.isOverweight ? h.driftValueCents : -h.driftValueCents)}
                </p>
                {h.suggestedQty !== null && (
                  <p className="text-xs text-[var(--muted)]">
                    {td("rebalancing.approxShares", { count: h.suggestedQty.toFixed(2) })}
                  </p>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
