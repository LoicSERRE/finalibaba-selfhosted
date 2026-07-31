import { formatCurrency } from "@/lib/utils/format";
import type { getTranslations } from "next-intl/server";

type T = Awaited<ReturnType<typeof getTranslations>>;

export function KpiCards({
  t,
  hasTaxData,
  netWorth,
  netWorthAfterTax,
  grossAssets,
  totalLiabilities,
  totalLatentTax,
  investedPct,
  momDelta,
}: {
  t: T;
  hasTaxData: boolean;
  netWorth: bigint;
  netWorthAfterTax: bigint;
  grossAssets: bigint;
  totalLiabilities: bigint;
  totalLatentTax: bigint;
  investedPct: number;
  momDelta: number | null;
}) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
        <p className="text-xs text-[var(--muted)] uppercase tracking-wider mb-2">{t("kpis.netWorth")}</p>
        <p className="text-xl sm:text-2xl font-semibold tabular-nums text-[var(--accent-text)]">
          {formatCurrency(hasTaxData ? netWorthAfterTax : netWorth, 0)}
        </p>
        {momDelta !== null && (
          <p
            className={`text-xs tabular-nums mt-1 ${
              momDelta >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"
            }`}
          >
            {momDelta >= 0 ? "+" : ""}
            {formatCurrency(momDelta, 0)} {t("kpis.thisMonth")}
          </p>
        )}
        {hasTaxData && (
          <p className="text-xs text-[var(--muted)] mt-1">
            ~{formatCurrency(netWorth, 0)} {t("kpis.beforeTax")}
          </p>
        )}
      </div>
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
        <p className="text-xs text-[var(--muted)] uppercase tracking-wider mb-2">{t("kpis.grossWorth")}</p>
        <p className="text-xl sm:text-2xl font-semibold tabular-nums text-[var(--foreground)]">
          {formatCurrency(grossAssets, 0)}
        </p>
      </div>
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
        <p className="text-xs text-[var(--muted)] uppercase tracking-wider mb-2">{t("kpis.totalLiabilities")}</p>
        <p className="text-xl sm:text-2xl font-semibold tabular-nums text-[var(--negative)]">
          {formatCurrency(totalLiabilities + totalLatentTax, 0)}
        </p>
        {grossAssets > BigInt(0) && (
          <div className="mt-1 space-y-0.5">
            <p className="text-xs text-[var(--muted)]">
              {t("kpis.debts")} {formatCurrency(totalLiabilities, 0)}
            </p>
            {hasTaxData && (
              <p className="text-xs text-[var(--muted)]">
                {t("kpis.latentTax")} {formatCurrency(totalLatentTax, 0)}
              </p>
            )}
          </div>
        )}
      </div>
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
        <p className="text-xs text-[var(--muted)] uppercase tracking-wider mb-2">{t("kpis.investedRate")}</p>
        <p className="text-xl sm:text-2xl font-semibold tabular-nums text-[var(--foreground)]">
          {investedPct}%
        </p>
        <p className="text-xs text-[var(--muted)] mt-1">{t("kpis.ofGross")}</p>
      </div>
    </div>
  );
}
