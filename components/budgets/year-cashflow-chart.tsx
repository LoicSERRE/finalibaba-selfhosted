"use client";

import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from "recharts";
import { useTranslations } from "next-intl";
import { baseCurrency } from "@/lib/utils/base-currency";

type Point = { readonly label: string; readonly income: number; readonly expense: number };

function formatCurrency(cents: number) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: baseCurrency(), maximumFractionDigits: 0 }).format(cents / 100);
}

/** Money in and out, month by month, over a year (v2.20). */
export function YearCashflowChart({ data }: { readonly data: readonly Point[] }) {
  const t = useTranslations("budgets.year");
  return (
    <div role="img" aria-label={t("chartTitle")}>
      <ResponsiveContainer width="100%" height={240}>
        {/* accessibilityLayer off: role="img" above names the chart, and a
            tap would otherwise leave a stuck focus ring (cashflow-chart.tsx). */}
        <BarChart data={[...data]} margin={{ top: 4, right: 8, left: 8, bottom: 0 }} accessibilityLayer={false}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="label" tick={{ fill: "var(--muted)", fontSize: 11 }} axisLine={false} tickLine={false} interval={0} />
          <YAxis tickFormatter={(v) => formatCurrency(v)} tick={{ fill: "var(--muted)", fontSize: 11 }} axisLine={false} tickLine={false} width={72} />
          <Tooltip
            cursor={{ fill: "var(--surface-elevated)" }}
            contentStyle={{ background: "var(--surface-elevated)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--foreground)", fontSize: 13 }}
            formatter={(value, name) => [formatCurrency(Number(value)), name === "income" ? t("income") : t("expenses")]}
          />
          <Legend formatter={(value) => (value === "income" ? t("income") : t("expenses"))} wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="income" fill="var(--positive)" radius={[3, 3, 0, 0]} maxBarSize={18} />
          <Bar dataKey="expense" fill="var(--negative)" radius={[3, 3, 0, 0]} maxBarSize={18} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
