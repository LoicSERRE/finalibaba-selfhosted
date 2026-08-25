"use client";

import { PieChart, Pie, Tooltip, ResponsiveContainer } from "recharts";
import { useTranslations } from "next-intl";
import { CHART_COLORS } from "@/lib/utils/palette";
import { TruncatedText } from "@/components/ui/truncated-text";

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

export function AssetAllocationChart({ data }: Readonly<{ data: AllocationSlice[] }>) {
  const t = useTranslations("charts");
  const nonEmptyRaw = data.filter((d) => d.value > 0);

  if (!nonEmptyRaw.length) {
    return (
      <div className="h-48 flex items-center justify-center text-[var(--muted)] text-sm">
        {t("noData")}
      </div>
    );
  }

  const total = nonEmptyRaw.reduce((s, d) => s + d.value, 0);
  // Recharts reads `fill` directly off each data entry (same mechanism the
  // now-deprecated <Cell> used internally) - putting it on the data itself
  // is the officially recommended migration, see
  // https://recharts.github.io/en-US/guide/cell/
  const nonEmpty = nonEmptyRaw.map((entry, index) => ({
    ...entry,
    fill: entry.color ?? CHART_COLORS[index % CHART_COLORS.length],
  }));

  return (
    <div>
      <div role="img" aria-label={t("allocationAria")}>
      <ResponsiveContainer width="100%" height={190}>
        {/* accessibilityLayer defaults to true in Recharts 3 (root <svg>
            tabIndex={0}) - a mobile tap otherwise leaves a stuck native
            focus ring, since nothing in this app resets it. role="img"
            above already covers the accessible name. */}
        <PieChart accessibilityLayer={false}>
          <Pie
            data={nonEmpty}
            cx="50%"
            cy="50%"
            innerRadius={52}
            outerRadius={80}
            dataKey="value"
            // Recharts animates every Pie mount by default (~800ms sweep
            // from 0 to its final angle) - this app's AutoSync component
            // fires a background router.refresh() after its sync-poll
            // cycle, re-rendering this chart with fresh (but structurally
            // identical) props and restarting that animation. Disabling it
            // means a re-render always snaps straight to the correct final
            // state instead of ever being caught mid-motion.
            isAnimationActive={false}
            // Recharts defaults every Pie slice to a 1px white stroke -
            // glaring against this app's dark theme (confirmed live: the
            // rendered <path> had stroke="#fff" with no override anywhere
            // in this file). A `paddingAngle` gap was tried as the
            // separator instead of a stroke, but at this chart's small
            // radius the gap itself read as a set of thick black outlines
            // around every slice - the exact same "ugly contour" complaint
            // in a different color. Removed entirely: slices sit flush
            // against each other with no visible seam, relying on the
            // palette's own contrast for separation (confirmed live these
            // colors are distinct enough with no separator at all).
            stroke="none"
          />
          <Tooltip
            contentStyle={{
              background: "var(--surface-elevated)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              color: "var(--foreground)",
              fontSize: 12,
              padding: "6px 10px",
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
            <TruncatedText text={entry.name} className="text-xs text-[var(--muted)]" />
          </div>
        ))}
      </div>
    </div>
  );
}
