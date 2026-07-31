import { NetWorthChart } from "@/components/shared/net-worth-chart";
import { AssetAllocationChart, type AllocationSlice } from "@/components/shared/asset-allocation-chart";
import type { HistoryPoint } from "@/lib/domain/analytics";
import type { getTranslations } from "next-intl/server";

type T = Awaited<ReturnType<typeof getTranslations>>;

export function ChartsSection({
  t,
  dailyHistory,
  allocationSlices,
}: {
  t: T;
  dailyHistory: HistoryPoint[];
  allocationSlices: AllocationSlice[];
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
      <div className="md:col-span-3 bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6">
        <h2 className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider mb-4">
          {t("charts.netWorthEvolution")}
        </h2>
        <NetWorthChart data={dailyHistory} />
      </div>
      <div className="md:col-span-2 bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6">
        <h2 className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider mb-4">
          {t("charts.allocation")}
        </h2>
        <AssetAllocationChart data={allocationSlices} />
      </div>
    </div>
  );
}
