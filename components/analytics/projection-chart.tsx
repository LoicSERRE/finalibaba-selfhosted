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
  Legend,
  CartesianGrid,
} from "recharts";
import { useTranslations } from "next-intl";
import { projectNetWorthSplit } from "@/lib/domain/projection";
import { formatCurrency } from "@/lib/utils/format";
import { InfoTooltip } from "@/components/ui/info-tooltip";

const HORIZONS = [10, 20, 30, 40] as const;
const DEFAULT_HORIZON_YEARS = 30;
// Same hardcoded assumption lib/domain/analytics.ts's own dividend-calendar
// estimate already uses for "Livret A"-named accounts (see the
// name.includes("livret a") branch there) - reused here as the default
// for the liquid-bucket rate below rather than inventing a second,
// independent guess.
const DEFAULT_LIQUID_RETURN_PCT = 1.5;

// Long-term net worth projection (v1.14) - a compound-growth "what-if"
// chart, deliberately client-side and interactive rather than a persisted
// UserSettings field: the assumed return (and, since the tax-aware pass,
// the horizon) is explored live, not stored. Mirrors
// components/shared/net-worth-chart.tsx's exact AreaChart styling so it
// reads as the same product, not a bolted-on widget.
export function ProjectionChart({
  currentNetWorthCents,
  liquidCents,
  investedCents,
  annualContributionCents,
  defaultAnnualReturnPct,
  effectiveTaxRate,
}: Readonly<{
  currentNetWorthCents: bigint;
  // Today's real SAVINGS-type balance only ("savingsCents" - Livrets etc,
  // the ones an assumed non-zero return actually applies to) and
  // investments+crypto ("risques"), reused here (not duplicated) as the
  // grounded default split between the two return rates below.
  // Deliberately NOT "garantis" (cash+savings combined) - real user
  // feedback: a checking account balance sitting at 0% shouldn't compound
  // at the same assumed rate as an interest-bearing livret. Checking-
  // account cash falls out of currentNetWorthCents - liquidCents -
  // investedCents along with real estate/automobile equity minus any
  // standalone loan capital, and is treated as a fixed, non-compounding
  // offset (see lib/domain/projection.ts's projectNetWorthSplit for why).
  liquidCents: bigint;
  investedCents: bigint;
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
  const [investedReturnPct, setInvestedReturnPct] = useState(defaultAnnualReturnPct);
  const [liquidReturnPct, setLiquidReturnPct] = useState(DEFAULT_LIQUID_RETURN_PCT);
  const [horizonYears, setHorizonYears] = useState<number>(DEFAULT_HORIZON_YEARS);
  const currentYear = new Date().getFullYear();
  const showAfterTax = effectiveTaxRate > 0;

  const fixedCents = currentNetWorthCents - liquidCents - investedCents;
  const growingTotalCents = liquidCents + investedCents;
  // Real invested share of today's growing balance - shown next to the two
  // rate inputs so "où va l'épargne" has a real, grounded answer instead
  // of an unstated assumption (real user feedback: a single blended return
  // can't distinguish a livret from a PEA).
  const investedSharePct = growingTotalCents > BigInt(0)
    ? Math.round((Number(investedCents) / Number(growingTotalCents)) * 100)
    : 0;

  const points = useMemo(
    () =>
      projectNetWorthSplit({
        liquidCurrentCents: Number(liquidCents),
        investedCurrentCents: Number(investedCents),
        fixedCurrentCents: Number(fixedCents),
        annualContributionCents: annualContributionCents !== null ? Number(annualContributionCents) : 0,
        liquidReturnRate: liquidReturnPct / 100,
        investedReturnRate: investedReturnPct / 100,
        horizonYears,
        effectiveTaxRate,
      }),
    [liquidCents, investedCents, fixedCents, annualContributionCents, liquidReturnPct, investedReturnPct, horizonYears, effectiveTaxRate],
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

  // Secondary checkpoints (a third and two-thirds of the horizon) shown as
  // small pills next to the hero figure; the hero itself uses the full
  // horizon (calloutYears[2] === horizonYears exactly).
  const secondaryCalloutYears = calloutYears.slice(0, 2);

  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6">
      <div className="mb-6">
        <h2 className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider mb-1">{t("title")}</h2>
        <p className="text-xs text-[var(--muted)]">
          {annualContributionCents !== null
            ? t("contributionNote", { amount: formatCurrency(annualContributionCents, 0) })
            : t("noContributionNote")}
        </p>
      </div>

      {/* Redesigned (v1.14.1, fourth pass) - restructured around a
          reference the user pointed to directly (Finary's own simulator):
          inputs in a narrow left rail, the answer (a real hero number,
          not three same-weight callouts) and its chart on the right. This
          replaces the third pass's "two equal columns sharing one row"
          layout - that fixed the worst of the dead-space problem but kept
          treating every element (inputs, horizon, all 3 callouts) as
          same-weight, when the actual product question this card answers
          is singular: "at this pace, where am I at my chosen horizon".
          Each input is now an underlined stat row (label above, large
          borderless value, unit inline) instead of a small bordered box -
          more like Finary's own fields, and it reads as one coherent
          "control panel" column rather than several small floating
          widgets. Falls back to a single stacked column on mobile - no
          spare width to split there. */}
      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-8 lg:gap-10">
        {/* LEFT: inputs */}
        <div className="space-y-5 lg:border-r lg:border-[var(--border)] lg:pr-8">
          <div>
            <label htmlFor="projection-return-invested" className="text-xs text-[var(--muted)]">
              {t("investedReturnLabel")}
            </label>
            <div className="flex items-baseline gap-2 border-b border-[var(--border)] focus-within:border-[var(--accent)] pb-1.5 mt-1 transition-colors">
              <input
                id="projection-return-invested"
                type="number"
                inputMode="decimal"
                min="0"
                max="15"
                step="0.5"
                value={investedReturnPct}
                onChange={(e) => setInvestedReturnPct(Number(e.target.value))}
                className="w-full min-w-0 bg-transparent text-2xl font-semibold text-[var(--foreground)] focus:outline-none tabular-nums"
              />
              <span className="text-sm text-[var(--muted)] shrink-0">%</span>
            </div>
          </div>

          <div>
            <label htmlFor="projection-return-liquid" className="text-xs text-[var(--muted)]">
              {t("liquidReturnLabel")}
            </label>
            <div className="flex items-baseline gap-2 border-b border-[var(--border)] focus-within:border-[var(--accent)] pb-1.5 mt-1 transition-colors">
              <input
                id="projection-return-liquid"
                type="number"
                inputMode="decimal"
                min="0"
                max="15"
                step="0.5"
                value={liquidReturnPct}
                onChange={(e) => setLiquidReturnPct(Number(e.target.value))}
                className="w-full min-w-0 bg-transparent text-2xl font-semibold text-[var(--foreground)] focus:outline-none tabular-nums"
              />
              <span className="text-sm text-[var(--muted)] shrink-0">%</span>
            </div>
          </div>

          {growingTotalCents > BigInt(0) && (
            <p className="text-xs text-[var(--muted)] flex items-start gap-1">
              <span>{t("splitNote", { investedPct: investedSharePct, liquidPct: 100 - investedSharePct })}</span>
              <InfoTooltip>{t("splitMethodology")}</InfoTooltip>
            </p>
          )}

          <div>
            <span className="text-xs text-[var(--muted)] block mb-1.5">
              {t("horizonSelectorLabel")}
            </span>
            {/* 4 columns on mobile (full card width, plenty of room) but 2x2
                on the narrow desktop rail - 4-across would squeeze "40 ans"
                into ~65px at a 280px column width. These are plain <button>
                elements, not the shared Button component, so they don't
                inherit its global whitespace-nowrap either - set explicitly
                here too. Kept its own pill background - a segmented control
                is a distinct, correct, already-established pattern in this
                app (theme-switcher/language-switcher use the exact same
                shape). */}
            <div className="grid grid-cols-4 lg:grid-cols-2 gap-1 bg-[var(--surface-elevated)] rounded-lg p-1">
              {HORIZONS.map((h) => (
                <button
                  key={h}
                  type="button"
                  onClick={() => setHorizonYears(h)}
                  aria-pressed={horizonYears === h}
                  className={`text-sm font-medium whitespace-nowrap px-2 py-1.5 rounded-md min-h-[36px] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
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
        </div>

        {/* RIGHT: the answer - one hero figure at the chosen horizon
            (matching Finary's own "Capital final" treatment), the two
            earlier checkpoints as small reference pills rather than
            same-weight callouts, then the chart. */}
        <div className="space-y-4">
          <div>
            <p className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">{t("heroLabel")}</p>
            <p className="text-3xl sm:text-4xl font-bold text-[var(--accent-text)] tabular-nums mt-1">
              {formatCurrency(points[horizonYears].netWorthCents, 0)}
            </p>
            <p className="text-sm text-[var(--muted)] mt-1">{t("horizonLabel", { years: horizonYears })}</p>
            {showAfterTax && (
              <p className="text-xs text-[var(--muted)] opacity-70 mt-0.5">
                {t("afterTaxCalloutNote", { amount: formatCurrency(points[horizonYears].netWorthAfterTaxCents, 0) })}
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            {secondaryCalloutYears.map((years) => (
              <div
                key={years}
                className="inline-flex items-center gap-2 rounded-full bg-[var(--surface-elevated)] px-3 py-1.5 text-xs"
              >
                <span className="text-[var(--muted)]">{t("horizonLabel", { years })}</span>
                <span className="font-medium text-[var(--foreground)] tabular-nums">
                  {formatCurrency(points[years].netWorthCents, 0)}
                </span>
              </div>
            ))}
          </div>

          <div role="img" aria-label={t("ariaLabel")}>
        <ResponsiveContainer width="100%" height={240}>
          {/* accessibilityLayer defaults to true in Recharts 3, which gives
              the root <svg> tabIndex={0} - on mobile that leaves a stuck
              native focus ring after a tap (no CSS anywhere resets it).
              role="img" above already covers the accessible name. */}
          <AreaChart data={chartData} margin={{ top: 4, right: 16, left: 8, bottom: 0 }} accessibilityLayer={false}>
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
            {/* Legend rendered by Recharts itself, not a hand-rolled div
                above the chart - a hand-rolled version (with a negative
                margin to pull it closer to the plot area) collided with
                the Y-axis's own top tick label, a real overlap bug found
                live. Recharts reserves real layout height for its own
                Legend, so the chart body is pushed down automatically and
                this can't recur regardless of chart height/content. */}
            {showAfterTax && (
              <Legend
                verticalAlign="top"
                align="left"
                height={28}
                wrapperStyle={{ fontSize: 12, color: "var(--muted)" }}
              />
            )}
            <Area
              type="monotone"
              dataKey="netWorth"
              name={t("seriesLabel")}
              stroke="var(--accent)"
              strokeWidth={2}
              fill="url(#projectionGradient)"
              legendType="plainline"
              dot={false}
              activeDot={{ r: 4, fill: "var(--accent)" }}
              // See net-worth-chart.tsx's identical prop for why - a
              // background re-render mid-hover can otherwise desync the
              // active point from the live cursor while its animation is
              // still resolving.
              isAnimationActive={false}
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
                legendType="plainline"
                dot={false}
                activeDot={{ r: 4, fill: "var(--muted)" }}
                isAnimationActive={false}
              />
            )}
          </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
