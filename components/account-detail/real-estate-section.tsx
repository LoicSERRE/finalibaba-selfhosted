import { formatCurrency } from "@/lib/utils/format";
import type { getTranslations } from "next-intl/server";

type T = Awaited<ReturnType<typeof getTranslations>>;

export function RealEstateSection({
  t,
  value,
  liability,
  equity,
  ltv,
}: {
  t: T;
  value: bigint;
  liability: bigint;
  equity: bigint;
  ltv: number;
}) {
  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6 space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4 text-sm">
        <div>
          <p className="text-xs text-[var(--muted)] mb-1">{t("realEstate.value")}</p>
          <p className="tabular-nums font-semibold text-[var(--foreground)]">
            {formatCurrency(value, 0)}
          </p>
        </div>
        <div>
          <p className="text-xs text-[var(--muted)] mb-1">{t("realEstate.remaining")}</p>
          <p className="tabular-nums font-semibold text-[var(--negative)]">
            {formatCurrency(liability, 0)}
          </p>
        </div>
        <div>
          <p className="text-xs text-[var(--muted)] mb-1">{t("realEstate.equity")}</p>
          <p className="tabular-nums font-semibold text-[var(--positive)]">
            {formatCurrency(equity, 0)}
          </p>
        </div>
      </div>
      {liability > BigInt(0) && (
        <div>
          <div className="flex justify-between text-xs text-[var(--muted)] mb-1.5">
            <span>LTV</span>
            <span>{ltv}%</span>
          </div>
          <div
            className="h-2 bg-[var(--surface-elevated)] rounded-full overflow-hidden"
            role="progressbar"
            aria-valuenow={ltv}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`LTV : ${ltv}%`}
          >
            <div
              className={`h-full rounded-full ${
                ltv > 80
                  ? "bg-[var(--negative)]"
                  : ltv > 60
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
