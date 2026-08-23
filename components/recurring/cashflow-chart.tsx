"use client";

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from "recharts";
import { useTranslations } from "next-intl";

type DataPoint = {
  date: string; // display label, e.g. "15 août"
  cumulative: number; // in cents
};

function formatCurrency(cents: number) {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export function CashflowChart({ data }: Readonly<{ data: DataPoint[] }>) {
  const t = useTranslations("recurring");

  if (!data.length) {
    return (
      <div className="h-64 flex items-center justify-center text-[var(--muted)] text-sm">
        {t("noUpcoming")}
      </div>
    );
  }

  // Dense daily data (90 points) - thin the X axis ticks so labels don't overlap.
  const tickInterval = Math.ceil(data.length / 8);

  return (
    <div role="img" aria-label={t("chartTitle")}>
      <ResponsiveContainer width="100%" height={220}>
        {/* accessibilityLayer defaults to true in Recharts 3 (root <svg>
            tabIndex={0}) - a mobile tap otherwise leaves a stuck native
            focus ring. role="img" above already covers the accessible
            name. */}
        <AreaChart data={data} margin={{ top: 4, right: 0, left: 8, bottom: 0 }} accessibilityLayer={false}>
          <defs>
            <linearGradient id="cashflowGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.25} />
              <stop offset="95%" stopColor="var(--accent)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fill: "var(--muted)", fontSize: 12 }}
            axisLine={false}
            tickLine={false}
            interval={tickInterval}
          />
          <YAxis
            tickFormatter={(v) => formatCurrency(v)}
            tick={{ fill: "var(--muted)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={78}
          />
          <ReferenceLine y={0} stroke="var(--border)" />
          <Tooltip
            contentStyle={{
              background: "var(--surface-elevated)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              color: "var(--foreground)",
              fontSize: 13,
            }}
            formatter={(value) => [formatCurrency(Number(value)), t("chartTitle")]}
          />
          <Area
            type="stepAfter"
            dataKey="cumulative"
            stroke="var(--accent)"
            strokeWidth={2}
            fill="url(#cashflowGradient)"
            dot={false}
            activeDot={{ r: 4, fill: "var(--accent)" }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
