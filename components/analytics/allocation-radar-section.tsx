import { formatCurrency } from "@/lib/format";
import type { getTranslations } from "next-intl/server";

type T = Awaited<ReturnType<typeof getTranslations>>;

export function AllocationRadarSection({
  t,
  garantis,
  risques,
  garantisPct,
  techPct,
}: {
  t: T;
  garantis: bigint;
  risques: bigint;
  garantisPct: number;
  techPct: number;
}) {
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
            className="bg-[#8b5cf6] rounded-l-full transition-all"
            style={{ width: `${garantisPct}%` }}
          />
          <div
            className="bg-[#22c55e] flex-1 rounded-r-full transition-all"
          />
        </div>
        <div className="flex justify-between text-xs text-[var(--muted)] mt-1.5">
          <span>{t("radar.safe", { amount: formatCurrency(garantis, 0) })}</span>
          <span>{t("radar.risky", { amount: formatCurrency(risques, 0) })}</span>
        </div>
      </div>

      {/* Pure Tech exposure */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-[var(--foreground)]">{t("radar.techExposure")}</span>
            {techPct > 60 && (
              <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-[var(--negative)]/15 text-[var(--negative)]">
                {t("radar.highConcentration")}
              </span>
            )}
            {techPct > 40 && techPct <= 60 && (
              <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-[var(--warning)]/15 text-[var(--warning)]">
                {t("radar.monitor")}
              </span>
            )}
          </div>
          <span className="text-xs tabular-nums font-medium text-[var(--foreground)]">{techPct}%</span>
        </div>
        <div
          className="h-3 bg-[var(--surface-elevated)] rounded-full overflow-hidden"
          role="progressbar"
          aria-valuenow={techPct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Exposition Tech : ${techPct}%`}
        >
          <div
            className={`h-full rounded-full transition-all ${
              techPct > 60
                ? "bg-[var(--negative)]"
                : techPct > 40
                ? "bg-[var(--warning)]"
                : "bg-[var(--positive)]"
            }`}
            style={{ width: `${techPct}%` }}
          />
        </div>
        <p className="text-xs text-[var(--muted)] mt-1.5 opacity-70">
          {t("radar.techFootnote")}
        </p>
      </div>
    </div>
  );
}
