import { formatCurrency } from "@/lib/utils/format";
import { SavingsInterestHistoryChart } from "@/components/analytics/savings-interest-history-chart";
import type { getTranslations } from "next-intl/server";
import type { SavingsInterestHistoryPoint } from "@/lib/domain/analytics";

type T = Awaited<ReturnType<typeof getTranslations>>;

// Pulled out of goal-and-passive-income.tsx into its own card - the figures
// used to live as two tiny (text-[10px]/text-xs) muted lines tucked under
// the real passive-income numbers, easy to miss and hard to read even once
// found. Reported directly ("j'ai vu les chiffres c'est vraiment petit").
// Still visually distinct from any *real*, tracked figure elsewhere on the
// page - see this component's own title - since these two numbers are a
// live estimate (today's balances/rates and a historical-balance
// projection), not a breakdown of anything already shown.
export function SavingsInterestEstimateSection({
  t,
  weightedSavingsRatePct,
  estimatedYearEndSavingsInterestCents,
  estimatedYearEndInterestHistory,
  accountsMissingInterestRate,
}: Readonly<{
  t: T;
  /** Balance-weighted average rate across SAVINGS accounts with a known
   *  rate - null when none have one (see computeAnalytics' own comment). */
  weightedSavingsRatePct: number | null;
  /** Full-year projection via the "méthode des quinzaines" - see
   *  lib/domain/savings-projection.ts. */
  estimatedYearEndSavingsInterestCents: bigint;
  /** How that same projection has moved through the year - see
   *  computeAnalytics' own comment on the field. */
  estimatedYearEndInterestHistory: SavingsInterestHistoryPoint[];
  /** SAVINGS accounts with a positive balance but no interestRatePct set -
   *  excluded from both figures above, so this estimate is a lower bound
   *  whenever it's non-zero. Surfaced here, not just in the markdown
   *  export - CLAUDE.md's own "Country presets" section names this exact
   *  gap (an unset rate contributing nothing, with nothing on screen
   *  distinguishing that from an account that genuinely pays none). */
  accountsMissingInterestRate: number;
}>) {
  if (weightedSavingsRatePct === null && estimatedYearEndSavingsInterestCents <= BigInt(0)) return null;

  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 sm:p-6">
      <p className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider mb-1">
        {t("savingsEstimate.title")}
      </p>
      <p className="text-xs text-[var(--muted)] opacity-70 mb-3">{t("savingsEstimate.subtitle")}</p>
      <div className="grid grid-cols-2 gap-2 sm:gap-4">
        <div>
          <p className="text-xs text-[var(--muted)] mb-1">{t("savingsEstimate.weightedRate")}</p>
          <p className="text-lg font-semibold tabular-nums text-[var(--foreground)]">
            {weightedSavingsRatePct !== null ? `${(weightedSavingsRatePct * 100).toFixed(2)} %` : "-"}
          </p>
        </div>
        <div>
          <p className="text-xs text-[var(--muted)] mb-1">{t("savingsEstimate.yearEndAmount")}</p>
          <p className="text-lg font-semibold tabular-nums text-[var(--foreground)]">
            {estimatedYearEndSavingsInterestCents > BigInt(0)
              ? `~${formatCurrency(estimatedYearEndSavingsInterestCents, 0)}`
              : "-"}
          </p>
        </div>
      </div>
      {accountsMissingInterestRate > 0 && (
        <p className="text-xs text-[var(--warning)] mt-3">
          {t("savingsEstimate.missingRates", { count: accountsMissingInterestRate })}
        </p>
      )}
      <SavingsInterestHistoryChart data={estimatedYearEndInterestHistory} />
    </div>
  );
}
