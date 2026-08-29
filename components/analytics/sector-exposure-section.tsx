import { formatCurrency } from "@/lib/utils/format";
import { SECTOR_COLORS } from "@/lib/utils/palette";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import type { SectorContribution } from "@/lib/domain/sector-exposure";
import type { getTranslations } from "next-intl/server";

type T = Awaited<ReturnType<typeof getTranslations>>;

type SectorContributions = Record<string, { holdings: SectorContribution[]; truncated: boolean }>;

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
 *
 * A "bare" content block, not its own card - real user feedback found this
 * section and AllocationRadarSection's "Garantis vs Risqués" (a coarser cut
 * of the exact same investment total this section drills into) confusing as
 * two separate cards; AllocationRadarSection now renders this as a second
 * section inside its own single card instead.
 *
 * Every color segment/dot is hover-and-focusable (a real <button>, not a
 * div with a mouse-only :hover) and shows which holdings actually make up
 * that percentage - also real user feedback: with 13 possible colors, the
 * legend dot alone wasn't always enough to place a segment, and "where does
 * this figure come from" wasn't answerable without leaving the page.
 */
// Hoisted out of SectorExposureSection: a component declared inside another
// component is a new type on every render, so React remounts it instead of
// updating it - and this one is rendered twice per sector (bar segment and
// legend row). Its two closures become props.
function SectorTooltip({
  sectorKey,
  contributions,
  t,
}: Readonly<{
  sectorKey: string;
  contributions: SectorContributions;
  t: T;
}>) {
  const entry = contributions[sectorKey];
  if (!entry || entry.holdings.length === 0) return null;
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden w-max max-w-[260px] -translate-x-1/2 rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2 text-xs shadow-lg group-hover:block group-focus-visible:block"
    >
      <p className="mb-1 font-medium text-[var(--foreground)]">
        {t(`sectorExposure.sectors.${sectorKey}` as Parameters<typeof t>[0])}
      </p>
      {/* Names wrap rather than truncate with an ellipsis - a real fund
          name plus its account suffix ("iShares Core S&P 500 ETF (CTO)")
          is exactly the info this tooltip exists to show; cutting it off
          mid-name would defeat the point. */}
      <ul className="space-y-1">
        {entry.holdings.map((h) => (
          <li key={h.name} className="flex justify-between gap-3 text-[var(--muted)]">
            <span className="break-words">{h.name}</span>
            <span className="tabular-nums shrink-0">{formatCurrency(h.cents, 0)}</span>
          </li>
        ))}
      </ul>
      {entry.truncated && <p className="mt-1 text-[var(--muted)]">{t("sectorExposure.andMore")}</p>}
    </div>
  );
}

export function SectorExposureSection({
  t,
  breakdown,
  contributions,
  unclassifiedCents,
  totalCents,
}: Readonly<{
  t: T;
  breakdown: Record<string, bigint>;
  contributions: SectorContributions;
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
    <div className="pt-4 border-t border-[var(--border)] space-y-4">
      <h3 className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider flex items-center gap-1">
        {t("sectorExposure.title")}
        <InfoTooltip>{t("sectorExposure.footnote")}</InfoTooltip>
      </h3>

      <div
        className="flex h-3 rounded-full gap-0.5"
        role="img"
        aria-label={t("sectorExposure.ariaLabel")}
      >
        {rows.map((r, i) => {
          const pct = (Number(r.cents) / Number(totalCents)) * 100;
          const label = t(`sectorExposure.sectors.${r.key}` as Parameters<typeof t>[0]);
          const roundedClass = `${i === 0 ? "rounded-l-full" : ""} ${i === rows.length - 1 ? "rounded-r-full" : ""}`;
          return (
            <button
              key={r.key}
              type="button"
              className={`group relative h-full p-0 border-0 bg-transparent cursor-pointer ${roundedClass}`}
              style={{ width: `${pct}%`, background: SECTOR_COLORS[r.key] ?? SECTOR_COLORS.unclassified }}
              aria-label={`${label} · ${pct.toFixed(1)}%`}
            >
              <SectorTooltip sectorKey={r.key} contributions={contributions} t={t} />
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2">
        {rows.map((r) => {
          const pct = (Number(r.cents) / Number(totalCents)) * 100;
          return (
            <button
              key={r.key}
              type="button"
              className="group relative flex items-center gap-2 min-w-0 p-0 border-0 bg-transparent cursor-pointer text-left"
            >
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
              <SectorTooltip sectorKey={r.key} contributions={contributions} t={t} />
            </button>
          );
        })}
      </div>

      <p className="text-xs text-[var(--muted)]">
        {t("sectorExposure.totalClassified", { amount: formatCurrency(totalCents - unclassifiedCents, 0) })}
      </p>
    </div>
  );
}
