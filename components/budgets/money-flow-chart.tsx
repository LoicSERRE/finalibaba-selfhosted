"use client";

import { ResponsiveContainer, Sankey, Tooltip } from "recharts";
import { useTranslations } from "next-intl";
import { formatCurrency } from "@/lib/utils/format";
import { PanZoom } from "@/components/ui/pan-zoom";
import { MoneyFlowNode } from "@/components/budgets/money-flow-node";
import type { MoneyFlow } from "@/lib/domain/money-flow";

type Props = {
  readonly flow: MoneyFlow | null;
  /** The year view's own heading (v2.20); the month's otherwise. */
  readonly title?: string;
};

/**
 * Where the month's money went (v2.16), as a Sankey: income sources, then
 * spending categories and savings. The list under it carries every amount -
 * the chart's text alternative, and what discretion blurs.
 *
 * Drawn at CHART_WIDTH, below which its labels collide. On a phone it used to
 * scroll sideways inside that width; it is now fitted whole and navigated
 * like a map (PanZoom, v2.18.1).
 */
const CHART_WIDTH = 520;

export function MoneyFlowChart({ flow, title }: Props) {
  const t = useTranslations("budgets.flow");
  if (!flow) return null;
  const height = Math.max(240, flow.nodes.length * 30);
  return (
    <section className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-3" aria-labelledby="money-flow-title">
      <h2 id="money-flow-title" className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
        {title ?? t("title")}
      </h2>
      <PanZoom
        width={CHART_WIDTH}
        height={height}
        labels={{ zoomIn: t("zoomIn"), zoomOut: t("zoomOut"), reset: t("zoomReset"), hint: t("zoomHint") }}
      >
        <div className="h-full" aria-hidden="true">
          <ResponsiveContainer width="100%" height="100%">
            <Sankey
              data={flow}
              node={<MoneyFlowNode />}
              nodePadding={14}
              nodeWidth={10}
              margin={{ top: 8, right: 8, bottom: 8, left: 8 }}
              link={{ stroke: "var(--accent)", strokeOpacity: 0.25 }}
            >
              <Tooltip formatter={(value) => formatCurrency(Number(value))} />
            </Sankey>
          </ResponsiveContainer>
        </div>
      </PanZoom>
      <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
        {flow.nodes
          .filter((node) => node.kind !== "hub")
          .map((node) => (
            <li key={`${node.kind}-${node.name}`} className="flex items-center gap-2 min-w-0">
              <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: node.color }} aria-hidden="true" />
              <span className="flex-1 min-w-0 truncate text-[var(--muted)]">
                {node.kind === "source" ? t("in") : t("out")} · {node.name}
              </span>
              <span className={`amount tabular-nums ${node.kind === "source" ? "text-[var(--positive)]" : "text-[var(--foreground)]"}`}>
                {formatCurrency(node.cents)}
              </span>
            </li>
          ))}
      </ul>
    </section>
  );
}
