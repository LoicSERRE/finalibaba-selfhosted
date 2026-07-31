"use client";

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { useTranslations } from "next-intl";
import { CHART_COLORS } from "@/lib/palette";

export type AllocationSlice = {
  name: string;
  value: number; // cents
  color: string;
};


function formatCurrency(cents: number) {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export function AssetAllocationChart({ data }: { data: AllocationSlice[] }) {
  const t = useTranslations("charts");
  const nonEmpty = data.filter((d) => d.value > 0);

  if (!nonEmpty.length) {
    return (
      <div className="h-48 flex items-center justify-center text-[var(--muted)] text-sm">
        {t("noData")}
      </div>
    );
  }

  const total = nonEmpty.reduce((s, d) => s + d.value, 0);

  return (
    <div>
      <div role="img" aria-label={t("allocationAria")}>
      <ResponsiveContainer width="100%" height={190}>
        <PieChart>
          <Pie
            data={nonEmpty}
            cx="50%"
            cy="50%"
            innerRadius={52}
            outerRadius={80}
            paddingAngle={2}
            dataKey="value"
          >
            {nonEmpty.map((entry, index) => (
              <Cell
                key={entry.name}
                fill={entry.color ?? CHART_COLORS[index % CHART_COLORS.length]}
              />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              background: "var(--surface-elevated)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              color: "var(--foreground)",
              fontSize: 13,
            }}
            formatter={(value, name) =>
              value != null
                ? [
                    `${formatCurrency(Number(value))} (${Math.round((Number(value) / total) * 100)}%)`,
                    name as string,
                  ]
                : ["-", name as string]
            }
          />
        </PieChart>
      </ResponsiveContainer>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 mt-3">
        {nonEmpty.map((entry, index) => (
          <div key={entry.name} className="flex items-center gap-1.5 min-w-0">
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ background: entry.color ?? CHART_COLORS[index % CHART_COLORS.length] }}
            />
            <span className="text-xs text-[var(--muted)] truncate">{entry.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
