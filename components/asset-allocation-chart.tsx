"use client";

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";

export type AllocationSlice = {
  name: string;
  value: number; // cents
  color: string;
};

const COLORS = ["#6366f1", "#22c55e", "#f59e0b", "#3b82f6", "#ec4899", "#14b8a6"];

function formatCurrency(cents: number) {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export function AssetAllocationChart({ data }: { data: AllocationSlice[] }) {
  const nonEmpty = data.filter((d) => d.value > 0);

  if (!nonEmpty.length) {
    return (
      <div className="h-48 flex items-center justify-center text-[var(--muted)] text-sm">
        Aucune donnée
      </div>
    );
  }

  const total = nonEmpty.reduce((s, d) => s + d.value, 0);

  return (
    <div>
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
                fill={entry.color ?? COLORS[index % COLORS.length]}
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
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 mt-3">
        {nonEmpty.map((entry, index) => (
          <div key={entry.name} className="flex items-center gap-1.5 min-w-0">
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ background: entry.color ?? COLORS[index % COLORS.length] }}
            />
            <span className="text-xs text-[var(--muted)] truncate">{entry.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
