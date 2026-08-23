"use client";

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { useTranslations } from "next-intl";

type DataPoint = {
  date: string;
  netWorth: number; // in cents
};

function formatCurrency(cents: number) {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export function NetWorthChart({ data }: Readonly<{ data: DataPoint[] }>) {
  const t = useTranslations("netWorthChart");

  if (!data.length) {
    return (
      <div className="h-64 flex items-center justify-center text-[var(--muted)] text-sm">
        {t("noHistory")}
      </div>
    );
  }

  return (
    <div role="img" aria-label={t("ariaLabel")}>
    <ResponsiveContainer width="100%" height={260}>
      {/* accessibilityLayer defaults to true in Recharts 3, which gives the
          root <svg> tabIndex={0} - on a mobile tap that leaves the browser's
          native focus ring visibly stuck on the chart (no CSS anywhere in
          this app resets it), showing as a white halo that looks backwards
          in both themes since it's an unthemed UA default, not app styling.
          role="img" above already covers this chart's accessible name, so
          the SVG doesn't need to be independently focusable/tabbable. */}
      <AreaChart data={data} margin={{ top: 4, right: 0, left: 8, bottom: 0 }} accessibilityLayer={false}>
        <defs>
          <linearGradient id="netWorthGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.25} />
            <stop offset="95%" stopColor="var(--accent)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="var(--border)"
          vertical={false}
        />
        <XAxis
          dataKey="date"
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
          formatter={(value) =>
            value != null
              ? [formatCurrency(Number(value)), t("seriesLabel")]
              : ["-", t("seriesLabel")]
          }
        />
        <Area
          type="monotone"
          dataKey="netWorth"
          stroke="var(--accent)"
          strokeWidth={2}
          fill="url(#netWorthGradient)"
          dot={false}
          activeDot={{ r: 4, fill: "var(--accent)" }}
        />
      </AreaChart>
    </ResponsiveContainer>
    </div>
  );
}
