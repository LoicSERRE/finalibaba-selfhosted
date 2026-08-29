"use client";

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from "recharts";
import { useTranslations, useLocale } from "next-intl";
import { ALLOCATION_CATEGORY_COLORS } from "@/lib/utils/palette";

type DataPoint = {
  date: string;
  isoDate: string;
  cash: number;
  savings: number;
  investments: number;
  crypto: number;
  realEstate: number;
  auto: number;
};

// Same 6 keys/order as app/page.tsx's allocationSlices - keeps the stacked
// order and legend order matching the pie chart right next to it.
const CATEGORIES = ["cash", "savings", "investments", "crypto", "realEstate", "auto"] as const;

function formatCurrency(cents: number) {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

// Extends the dashboard's current-moment allocation pie (AssetAllocationChart)
// into a stacked-area view over time, built from the exact same per-account
// HistoricalBalance rows computeDashboard's main `history` series already
// reads (lib/domain/dashboard.ts's allocationHistory) - no new data
// collection. Mirrors net-worth-chart.tsx's AreaChart setup closely
// (isoDate dataKey, right:16 margin, isAnimationActive={false},
// accessibilityLayer={false}) - see that component's own comments for the
// real bugs those specific choices fix; a second, near-identical chart is
// just as exposed to them.
export function AllocationHistoryChart({ data }: Readonly<{ data: DataPoint[] }>) {
  // Two separate top-level namespaces, same split as net-worth-chart.tsx
  // (netWorthChart for its own strings) plus app/page.tsx's own top-level
  // "allocation" namespace for the category labels shared with the pie
  // chart (t("allocation.cash") etc, not nested under "dashboard").
  const t = useTranslations("allocationHistoryChart");
  const tCategory = useTranslations("allocation");
  const locale = useLocale();
  const shortDateFormat = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" });

  function formatShortDate(isoDate: React.ReactNode): string {
    if (typeof isoDate !== "string") return "";
    return shortDateFormat.format(new Date(`${isoDate}T00:00:00`));
  }

  if (!data.length) {
    return (
      <div className="h-64 flex items-center justify-center text-[var(--muted)] text-sm">
        {t("noHistory")}
      </div>
    );
  }

  return (
    <div role="img" aria-label={t("ariaLabel")}>
      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={data} margin={{ top: 4, right: 16, left: 8, bottom: 0 }} accessibilityLayer={false}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="isoDate"
            tickFormatter={formatShortDate}
            tick={{ fill: "var(--muted)", fontSize: 12 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tickFormatter={(v) => formatCurrency(v)}
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
            labelFormatter={formatShortDate}
            formatter={(value, name) => [formatCurrency(Number(value)), String(name)]}
          />
          <Legend wrapperStyle={{ fontSize: 12, color: "var(--muted)" }} />
          {CATEGORIES.map((key) => (
            <Area
              key={key}
              type="monotone"
              dataKey={key}
              name={tCategory(key)}
              stackId="allocation"
              stroke={ALLOCATION_CATEGORY_COLORS[key]}
              strokeWidth={1.5}
              fill={ALLOCATION_CATEGORY_COLORS[key]}
              fillOpacity={0.7}
              dot={false}
              isAnimationActive={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
