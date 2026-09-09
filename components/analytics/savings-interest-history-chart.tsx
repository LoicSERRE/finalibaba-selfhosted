"use client";

import { AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from "recharts";
import { useLocale, useTranslations } from "next-intl";

type DataPoint = {
  date: string; // pre-formatted, day+month only - display only, see isoDate below
  isoDate: string; // ISO 8601 "YYYY-MM-DD" - unique per point, used as the XAxis dataKey
  estimatedCents: number;
};

function formatCurrency(cents: number) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(cents / 100);
}

// How the year-end interest estimate (savings-interest-estimate-section.tsx)
// has moved through the year, re-derived from the same historical balances
// the estimate itself reads - a deposit, a withdrawal, or a rate change on
// any savings account shows up here as a step, not just as today's single
// number silently having changed since the last time the page was opened.
export function SavingsInterestHistoryChart({ data }: Readonly<{ data: DataPoint[] }>) {
  const t = useTranslations("analytics.savingsEstimate");
  const locale = useLocale();
  const shortDateFormat = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" });

  // Same isoDate-vs-date rationale as net-worth-chart.tsx: the pre-formatted
  // display string omits the year and can repeat, which breaks Recharts'
  // hover-index resolution on a category axis - isoDate never repeats.
  function formatShortDate(isoDate: React.ReactNode): string {
    if (typeof isoDate !== "string") return "";
    return shortDateFormat.format(new Date(`${isoDate}T00:00:00`));
  }

  // Fewer than 2 points can't draw a trend - same threshold this app's
  // other "not enough history yet" chart empty states already use.
  if (data.length < 2) {
    return <p className="text-xs text-[var(--muted)] mt-3">{t("historyNotEnoughData")}</p>;
  }

  return (
    <div role="img" aria-label={t("historyAriaLabel")} className="mt-3">
      <ResponsiveContainer width="100%" height={140}>
        {/* right: 16, not 0 - same fix as every other date-axis AreaChart in
            this app, see net-worth-chart.tsx's own comment on this margin. */}
        <AreaChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 0 }} accessibilityLayer={false}>
          <defs>
            <linearGradient id="savingsInterestHistoryGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.25} />
              <stop offset="95%" stopColor="var(--accent)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="isoDate"
            tickFormatter={formatShortDate}
            tick={{ fill: "var(--muted)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            minTickGap={24}
          />
          <YAxis
            tickFormatter={(v) => formatCurrency(v)}
            tick={{ fill: "var(--muted)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={64}
          />
          <Tooltip
            contentStyle={{
              background: "var(--surface-elevated)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              color: "var(--foreground)",
              fontSize: 13,
            }}
            labelFormatter={formatShortDate}
            formatter={(value) => [formatCurrency(Number(value)), t("yearEndAmount")]}
          />
          <Area
            type="monotone"
            dataKey="estimatedCents"
            stroke="var(--accent)"
            strokeWidth={2}
            fill="url(#savingsInterestHistoryGradient)"
            dot={false}
            activeDot={{ r: 4, fill: "var(--accent)" }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
