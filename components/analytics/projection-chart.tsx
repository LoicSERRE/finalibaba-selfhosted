"use client";

import { useMemo, useState } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { useTranslations } from "next-intl";
import { projectNetWorth } from "@/lib/domain/projection";
import { formatCurrency } from "@/lib/utils/format";

const HORIZONS = [10, 20, 30, 40] as const;
const DEFAULT_HORIZON_YEARS = 30;

// Long-term net worth projection (v1.14) - a compound-growth "what-if"
// chart, deliberately client-side and interactive rather than a persisted
// UserSettings field: the assumed return (and, since the tax-aware pass,
// the horizon) is explored live, not stored. Mirrors
// components/shared/net-worth-chart.tsx's exact AreaChart styling so it
// reads as the same product, not a bolted-on widget.
export function ProjectionChart({
  currentNetWorthCents,
  annualContributionCents,
  defaultAnnualReturnPct,
  effectiveTaxRate,
}: Readonly<{
  currentNetWorthCents: bigint;
  // null means no declared monthly savings - the projection still renders
  // (contribution-free growth), with a note explaining why, rather than
  // guessing from a single noisy month-over-month delta.
  annualContributionCents: bigint | null;
  defaultAnnualReturnPct: number;
  // Blended latent-tax rate (0-1 ratio) from lib/domain/analytics.ts's
  // AnalyticsResult - 0 when hasTaxData is false, in which case the
  // after-tax series is identical to the pre-tax one and stays hidden
  // (no point drawing two overlapping lines).
  effectiveTaxRate: number;
}>) {
  const t = useTranslations("projectionChart");
  const [returnPct, setReturnPct] = useState(defaultAnnualReturnPct);
  const [horizonYears, setHorizonYears] = useState<number>(DEFAULT_HORIZON_YEARS);
  const currentYear = new Date().getFullYear();
  const showAfterTax = effectiveTaxRate > 0;

  const points = useMemo(
    () =>
      projectNetWorth({
        currentCents: Number(currentNetWorthCents),
        annualContributionCents: annualContributionCents !== null ? Number(annualContributionCents) : 0,
        annualReturnRate: returnPct / 100,
        horizonYears,
        effectiveTaxRate,
      }),
    [currentNetWorthCents, annualContributionCents, returnPct, horizonYears, effectiveTaxRate],
  );

  const chartData = points.map((p) => ({
    year: currentYear + p.year,
    netWorth: p.netWorthCents,
    netWorthAfterTax: p.netWorthAfterTaxCents,
  }));

  // Proportional to the selected horizon (a third, two-thirds, and the full
  // span) rather than hardcoded 10/20/30 - stays meaningful at every
  // horizon setting instead of only ever showing 3 fixed years regardless
  // of what's picked.
  const calloutYears = [
    Math.round(horizonYears / 3),
    Math.round((horizonYears * 2) / 3),
    horizonYears,
  ];

  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider mb-1">{t("title")}</h2>
          <p className="text-xs text-[var(--muted)]">
            {annualContributionCents !== null
              ? t("contributionNote", { amount: formatCurrency(annualContributionCents, 0) })
              : t("noContributionNote")}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <label htmlFor="projection-return" className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
            {t("assumedReturnLabel")}
          </label>
          <div className="relative">
            <input
              id="projection-return"
              type="number"
              inputMode="decimal"
              min="0"
              max="15"
              step="0.5"
              value={returnPct}
              onChange={(e) => setReturnPct(Number(e.target.value))}
              className="w-20 bg-[var(--surface-elevated)] border border-[var(--border)] rounded-lg px-3 py-2 pr-7 text-sm text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/30 tabular-nums"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[var(--muted)]">%</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
          {t("horizonSelectorLabel")}
        </span>
        <div className="flex items-center gap-1 bg-[var(--surface-elevated)] rounded-lg p-1">
          {HORIZONS.map((h) => (
            <button
              key={h}
              type="button"
              onClick={() => setHorizonYears(h)}
              aria-pressed={horizonYears === h}
              className={`text-sm font-medium px-2.5 py-1.5 rounded-md min-h-[36px] min-w-[44px] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                horizonYears === h
                  ? "bg-[var(--surface)] text-[var(--foreground)] shadow-sm"
                  : "text-[var(--muted)] hover:text-[var(--foreground)]"
              }`}
            >
              {t("horizonOption", { years: h })}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {calloutYears.map((years) => (
          <div key={years}>
            <p className="text-xs text-[var(--muted)] mb-1">{t("horizonLabel", { years })}</p>
            <p className="text-lg font-semibold tabular-nums text-[var(--foreground)]">
              {formatCurrency(points[years].netWorthCents, 0)}
            </p>
            {showAfterTax && (
              <p className="text-xs text-[var(--muted)] mt-0.5 opacity-70">
                {t("afterTaxCalloutNote", { amount: formatCurrency(points[years].netWorthAfterTaxCents, 0) })}
              </p>
            )}
          </div>
        ))}
      </div>

      {/* Legend only shown once there are two series to distinguish - a
          single-line chart (no tax data) doesn't need one, matching the
          original chart's own no-legend baseline. */}
      {showAfterTax && (
        <div className="flex items-center gap-4 text-xs text-[var(--muted)]">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-0.5 rounded-full" style={{ background: "var(--accent)" }} />
            {t("seriesLabel")}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 border-t-2 border-dashed" style={{ borderColor: "var(--muted)" }} />
            {t("afterTaxSeriesLabel")}
          </span>
        </div>
      )}

      <div role="img" aria-label={t("ariaLabel")}>
        <ResponsiveContainer width="100%" height={260}>
          {/* accessibilityLayer defaults to true in Recharts 3, which gives
              the root <svg> tabIndex={0} - on mobile that leaves a stuck
              native focus ring after a tap (no CSS anywhere resets it).
              role="img" above already covers the accessible name. */}
          <AreaChart data={chartData} margin={{ top: 4, right: 0, left: 8, bottom: 0 }} accessibilityLayer={false}>
            <defs>
              <linearGradient id="projectionGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.25} />
                <stop offset="95%" stopColor="var(--accent)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="year" tick={{ fill: "var(--muted)", fontSize: 12 }} axisLine={false} tickLine={false} />
            <YAxis
              tickFormatter={(v) => formatCurrency(v, 0)}
              tick={{ fill: "var(--muted)", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={78}
            />
            <Tooltip
              contentStyle={{
                background: "var(--surface-elevated)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                color: "var(--foreground)",
                fontSize: 13,
              }}
              formatter={(value, name) => [value != null ? formatCurrency(Number(value), 0) : "-", name]}
            />
            <Area
              type="monotone"
              dataKey="netWorth"
              name={t("seriesLabel")}
              stroke="var(--accent)"
              strokeWidth={2}
              fill="url(#projectionGradient)"
              dot={false}
              activeDot={{ r: 4, fill: "var(--accent)" }}
            />
            {/* Second, muted dashed reference line for the after-tax
                projection (v1.14) - only rendered when there's a real
                effectiveTaxRate to apply, so a portfolio with no taxable
                gain (e.g. all-PEA/exempt) doesn't draw two overlapping
                identical lines. No fill (unlike the pre-tax Area above) -
                deliberately reads as a secondary reference, not a
                competing area, to keep the chart from looking cluttered. */}
            {showAfterTax && (
              <Line
                type="monotone"
                dataKey="netWorthAfterTax"
                name={t("afterTaxSeriesLabel")}
                stroke="var(--muted)"
                strokeWidth={2}
                strokeDasharray="5 5"
                dot={false}
                activeDot={{ r: 4, fill: "var(--muted)" }}
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
