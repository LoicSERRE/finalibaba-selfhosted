"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { useTranslations, useLocale } from "next-intl";

interface BalancePoint {
  date: string; // pre-formatted, day+month only (no year) - display only, see isoDate below
  isoDate: string; // ISO 8601 "YYYY-MM-DD" - see the XAxis dataKey comment for why this is used instead of `date`
  balance: number; // centimes
}

const fmt = (cents: number) =>
  new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(cents / 100);

export function BalanceHistoryChart({ data }: Readonly<{ data: BalancePoint[] }>) {
  const t = useTranslations("charts");
  const locale = useLocale();
  const shortDateFormat = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" });
  // Recharts' own labelFormatter type is (label: ReactNode) => ReactNode -
  // wider than this component ever actually receives (always the isoDate
  // string, for a category axis) - narrowed to a plain string here since
  // that's the only case that ever really happens.
  function formatShortDate(isoDate: React.ReactNode): string {
    if (typeof isoDate !== "string") return String(isoDate);
    return shortDateFormat.format(new Date(`${isoDate}T00:00:00`));
  }

  if (data.length < 2) {
    return (
      <div className="h-[220px] flex items-center justify-center text-sm text-[var(--muted)]">
        {t("notEnoughData")}
      </div>
    );
  }

  const values = data.map((d) => d.balance);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = (max - min) * 0.15 || max * 0.05;

  return (
    <div role="img" aria-label={t("balanceAria")}>
    <ResponsiveContainer width="100%" height={220}>
      {/* accessibilityLayer defaults to true in Recharts 3 (root <svg>
          tabIndex={0}) - a mobile tap otherwise leaves a stuck native focus
          ring. role="img" above already covers the accessible name. */}
      <AreaChart data={data} margin={{ top: 5, right: 16, bottom: 0, left: 8 }} accessibilityLayer={false}>
        <defs>
          <linearGradient id="balGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.22} />
            <stop offset="95%" stopColor="var(--accent)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        {/* dataKey="isoDate", not "date" - see net-worth-chart.tsx's
            identical XAxis comment: a duplicated category axis (the
            day+month `date` string repeats once these last-60-points span
            more than a year) breaks Recharts' own hover/tooltip index
            resolution past the point where values start repeating.
            isoDate is always unique; tickFormatter/labelFormatter below
            reformat it back to the short display string. */}
        <XAxis
          dataKey="isoDate"
          tickFormatter={formatShortDate}
          tick={{ fill: "var(--muted)", fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fill: "var(--muted)", fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={fmt}
          domain={[min - pad, max + pad]}
          width={78}
        />
        <Tooltip
          contentStyle={{
            background: "var(--surface-elevated)",
            border: "1px solid var(--border)",
            borderRadius: "8px",
            color: "var(--foreground)",
            fontSize: "13px",
          }}
          labelFormatter={formatShortDate}
          formatter={(v) => [fmt(Number(v)), t("balance")]}
          labelStyle={{ color: "var(--muted)", marginBottom: 4 }}
          cursor={{ stroke: "var(--border)", strokeWidth: 1 }}
        />
        <Area
          type="monotone"
          dataKey="balance"
          stroke="var(--accent)"
          strokeWidth={2}
          fill="url(#balGrad)"
          dot={false}
          activeDot={{ r: 4, fill: "var(--accent)", strokeWidth: 0 }}
          // See net-worth-chart.tsx's identical prop for why.
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
    </div>
  );
}
