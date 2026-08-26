import { BalanceHistoryChart } from "@/components/account-detail/balance-history-chart";
import { ImportBalanceHistoryDialog } from "@/components/account-detail/import-balance-history-dialog";
import type { ChartPoint } from "@/lib/domain/account-detail";
import type { getTranslations } from "next-intl/server";

type T = Awaited<ReturnType<typeof getTranslations>>;

export function BalanceChartSection({
  td,
  accountId,
  chartData,
  canImportCsv,
  existingBalanceDates,
  isInvestment = false,
}: Readonly<{
  td: T;
  accountId: string;
  chartData: ChartPoint[];
  canImportCsv: boolean;
  existingBalanceDates: string[];
  isInvestment?: boolean;
}>) {
  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6">
      <div className="flex items-center justify-between flex-wrap gap-x-3 gap-y-2 mb-4">
        <h2 className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
          {td(isInvestment ? "valueEvolution" : "balanceEvolution")}
        </h2>
        {canImportCsv && (
          <ImportBalanceHistoryDialog accountId={accountId} existingDates={existingBalanceDates} />
        )}
      </div>
      <BalanceHistoryChart data={chartData} isInvestment={isInvestment} />
    </div>
  );
}
