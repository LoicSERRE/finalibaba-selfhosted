import { formatCurrency } from "@/lib/utils/format";
import { ALLOCATION_CATEGORY_COLORS } from "@/lib/utils/palette";
import type { getTranslations } from "next-intl/server";

type T = Awaited<ReturnType<typeof getTranslations>>;

// Its own Tech-only exposure bar (TECH_WEIGHTS, a 12-entry hand-verified
// map) was removed once SectorExposureSection shipped (v1.16) - a real user
// report found the two side by side confusing (same "how much tech?"
// question, two different numbers - TECH_WEIGHTS' hand-picked weights vs the
// new section's live Yahoo-sourced Technology sector figure). Superseded,
// not duplicated - see CLAUDE.md's "Full sector-exposure breakdown".
export function AllocationRadarSection({
  t,
  garantis,
  risques,
  garantisPct,
}: Readonly<{
  t: T;
  garantis: bigint;
  risques: bigint;
  garantisPct: number;
}>) {
  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 sm:p-6 space-y-6">
      <h2 className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
        {t("radar.title")}
      </h2>

      {/* Garantis vs Risqués */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-[var(--foreground)]">{t("radar.safeVsRisky")}</span>
          <span className="text-xs text-[var(--muted)] tabular-nums">
            {garantisPct}% / {100 - garantisPct}%
          </span>
        </div>
        <div className="flex h-3 rounded-full overflow-hidden gap-0.5">
          <div
            className="rounded-l-full transition-all"
            style={{ width: `${garantisPct}%`, background: ALLOCATION_CATEGORY_COLORS.savings }}
          />
          <div
            className="flex-1 rounded-r-full transition-all"
            style={{ background: ALLOCATION_CATEGORY_COLORS.investments }}
          />
        </div>
        <div className="flex justify-between text-xs text-[var(--muted)] mt-1.5">
          <span>{t("radar.safe", { amount: formatCurrency(garantis, 0) })}</span>
          <span>{t("radar.risky", { amount: formatCurrency(risques, 0) })}</span>
        </div>
      </div>
    </div>
  );
}
