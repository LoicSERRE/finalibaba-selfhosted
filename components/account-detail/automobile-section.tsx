import { formatCurrency } from "@/lib/utils/format";
import type { getTranslations } from "next-intl/server";

type T = Awaited<ReturnType<typeof getTranslations>>;

export function AutomobileSection({
  t,
  value,
  liability,
  equity,
  ltv,
  purchasePrice,
}: {
  t: T;
  value: bigint;
  liability: bigint;
  equity: bigint;
  ltv: number;
  purchasePrice: bigint;
}) {
  const hasPurchasePrice = purchasePrice > BigInt(0);
  const depr = value - purchasePrice;
  const deprPct = hasPurchasePrice ? (Number(depr) / Number(purchasePrice)) * 100 : 0;

  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6 space-y-5">
      <div className={`grid gap-3 sm:gap-4 text-sm ${hasPurchasePrice ? "grid-cols-2 sm:grid-cols-5" : "grid-cols-2 sm:grid-cols-3"}`}>
        {hasPurchasePrice && (
          <div>
            <p className="text-xs text-[var(--muted)] mb-1">{t("auto.purchasePrice")}</p>
            <p className="tabular-nums font-semibold text-[var(--foreground)]">
              {formatCurrency(purchasePrice, 0)}
            </p>
          </div>
        )}
        <div>
          <p className="text-xs text-[var(--muted)] mb-1">{t("auto.value")}</p>
          <p className="tabular-nums font-semibold text-[var(--foreground)]">
            {formatCurrency(value, 0)}
          </p>
        </div>
        {hasPurchasePrice && (
          <div>
            <p className="text-xs text-[var(--muted)] mb-1">{t("auto.depreciation")}</p>
            <p className={`tabular-nums font-semibold ${depr <= BigInt(0) ? "text-[var(--negative)]" : "text-[var(--positive)]"}`}>
              {depr > BigInt(0) ? "+" : ""}{formatCurrency(depr, 0)}
            </p>
            <p className={`text-xs tabular-nums ${depr <= BigInt(0) ? "text-[var(--negative)]" : "text-[var(--positive)]"}`}>
              {deprPct >= 0 ? "+" : ""}{deprPct.toFixed(1)}%
            </p>
          </div>
        )}
        <div>
          <p className="text-xs text-[var(--muted)] mb-1">{t("auto.loanDue")}</p>
          <p className="tabular-nums font-semibold text-[var(--negative)]">
            {formatCurrency(liability, 0)}
          </p>
        </div>
        <div>
          <p className="text-xs text-[var(--muted)] mb-1">{t("auto.netValue")}</p>
          <p className="tabular-nums font-semibold text-[var(--positive)]">
            {formatCurrency(equity, 0)}
          </p>
        </div>
      </div>
      {liability > BigInt(0) && (
        <div>
          <div className="flex justify-between text-xs text-[var(--muted)] mb-1.5">
            <span>{t("auto.financing")}</span>
            <span>{ltv}%</span>
          </div>
          <div
            className="h-2 bg-[var(--surface-elevated)] rounded-full overflow-hidden"
            role="progressbar"
            aria-valuenow={ltv}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${t("auto.financing")}: ${ltv}%`}
          >
            <div
              className={`h-full rounded-full ${
                ltv > 80
                  ? "bg-[var(--negative)]"
                  : ltv > 50
                  ? "bg-[var(--warning)]"
                  : "bg-[var(--positive)]"
              }`}
              style={{ width: `${Math.min(ltv, 100)}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
