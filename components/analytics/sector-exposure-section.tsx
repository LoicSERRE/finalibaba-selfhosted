import { formatCurrency } from "@/lib/utils/format";
import { SECTOR_COLORS } from "@/lib/utils/palette";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import type { getTranslations } from "next-intl/server";

type T = Awaited<ReturnType<typeof getTranslations>>;

/**
 * Full sector-exposure breakdown (v1.16) - generalizes
 * AllocationRadarSection's former Tech-only bar (TECH_WEIGHTS, a 12-entry
 * hand-verified map) into every GICS-style sector across every holding.
 * That bar was removed, not kept alongside this section - real user
 * feedback found two different "how much tech?" numbers on the same page
 * (the hand-picked weight vs this section's live Yahoo-sourced figure)
 * confusing rather than complementary. See CLAUDE.md's "Full sector-
 * exposure breakdown" for the scoping research behind the data source and
 * the degradation-alert design.
 */
export function SectorExposureSection({
  t,
  breakdown,
  unclassifiedCents,
  totalCents,
}: Readonly<{
  t: T;
  breakdown: Record<string, bigint>;
  unclassifiedCents: bigint;
  totalCents: bigint;
}>) {
  if (totalCents <= BigInt(0)) return null;

  const rows = [
    ...Object.entries(breakdown).map(([key, cents]) => ({ key, cents })),
    ...(unclassifiedCents > BigInt(0) ? [{ key: "unclassified", cents: unclassifiedCents }] : []),
  ]
    .filter((r) => r.cents > BigInt(0))
    .sort((a, b) => Number(b.cents - a.cents));

  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 sm:p-6 space-y-4">
      <h2 className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider flex items-center gap-1">
        {t("sectorExposure.title")}
        <InfoTooltip>{t("sectorExposure.footnote")}</InfoTooltip>
      </h2>

      <div
        className="flex h-3 rounded-full overflow-hidden gap-0.5"
        role="img"
        aria-label={t("sectorExposure.ariaLabel")}
      >
        {rows.map((r) => (
          <div
            key={r.key}
            style={{
              width: `${(Number(r.cents) / Number(totalCents)) * 100}%`,
              background: SECTOR_COLORS[r.key] ?? SECTOR_COLORS.unclassified,
            }}
          />
        ))}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2">
        {rows.map((r) => {
          const pct = (Number(r.cents) / Number(totalCents)) * 100;
          return (
            <div key={r.key} className="flex items-center gap-2 min-w-0">
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ background: SECTOR_COLORS[r.key] ?? SECTOR_COLORS.unclassified }}
              />
              <span className="text-xs text-[var(--foreground)] truncate">
                {t(`sectorExposure.sectors.${r.key}` as Parameters<typeof t>[0])}
              </span>
              <span className="text-xs text-[var(--muted)] tabular-nums ml-auto shrink-0">
                {pct.toFixed(1)}%
              </span>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-[var(--muted)]">
        {t("sectorExposure.totalClassified", { amount: formatCurrency(totalCents - unclassifiedCents, 0) })}
      </p>
    </div>
  );
}
