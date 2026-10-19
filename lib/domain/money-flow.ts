/**
 * The month's money flow as a Sankey graph (v2.16): income sources into one
 * "income" node, out to spending categories, with the difference shown as
 * savings - or, in a month that spent more than it earned, as money drawn
 * from savings flowing in. Pure; the amounts are the budgets page's own
 * maps (internal transfers excluded, splits included), so the diagram and
 * the numbers beside it are the same numbers.
 */

export type FlowPart = { id: string; name: string; cents: number; color: string };

export type FlowNode = { name: string; color: string; cents: number; kind: "source" | "hub" | "target" };
export type FlowLink = { source: number; target: number; value: number };
export type MoneyFlow = { nodes: FlowNode[]; links: FlowLink[]; incomeCents: number; spentCents: number };

export type FlowLabels = { income: string; savings: string; drawn: string; other: string };

export const FLOW_MAX_CATEGORIES = 8;
const HUB_COLOR = "#6366f1";
const SAVINGS_COLOR = "#22c55e";
const DRAWN_COLOR = "#f59e0b";
const OTHER_COLOR = "#71717a";

/** Biggest first; beyond `max`, the rest folded into one "other" part. */
export function foldSmallParts(parts: readonly FlowPart[], max: number, other: Omit<FlowPart, "cents">): FlowPart[] {
  const positive = parts.filter((p) => p.cents > 0).sort((a, b) => b.cents - a.cents);
  if (positive.length <= max) return positive;
  const kept = positive.slice(0, max - 1);
  const rest = positive.slice(max - 1).reduce((sum, p) => sum + p.cents, 0);
  return [...kept, { ...other, cents: rest }];
}

/** Null when there is nothing to draw: no income and no spending. */
export function buildMoneyFlow(incomes: readonly FlowPart[], expenses: readonly FlowPart[], labels: FlowLabels): MoneyFlow | null {
  const other = { id: "other", name: labels.other, color: OTHER_COLOR };
  const sources = foldSmallParts(incomes, FLOW_MAX_CATEGORIES, other);
  const targets = foldSmallParts(expenses, FLOW_MAX_CATEGORIES, other);
  const incomeCents = sources.reduce((sum, p) => sum + p.cents, 0);
  const spentCents = targets.reduce((sum, p) => sum + p.cents, 0);
  if (incomeCents === 0 && spentCents === 0) return null;

  const balance = incomeCents - spentCents;
  const inParts = balance < 0 ? [...sources, { id: "drawn", name: labels.drawn, cents: -balance, color: DRAWN_COLOR }] : sources;
  const outParts = balance > 0 ? [...targets, { id: "savings", name: labels.savings, cents: balance, color: SAVINGS_COLOR }] : targets;

  const nodes: FlowNode[] = [
    ...inParts.map((p) => ({ name: p.name, color: p.color, cents: p.cents, kind: "source" as const })),
    { name: labels.income, color: HUB_COLOR, cents: Math.max(incomeCents, spentCents), kind: "hub" as const },
    ...outParts.map((p) => ({ name: p.name, color: p.color, cents: p.cents, kind: "target" as const })),
  ];
  const hub = inParts.length;
  const links: FlowLink[] = [
    ...inParts.map((p, i) => ({ source: i, target: hub, value: p.cents })),
    ...outParts.map((p, i) => ({ source: hub, target: hub + 1 + i, value: p.cents })),
  ];
  return { nodes, links, incomeCents, spentCents };
}

export type FlowCategory = { id: string; name: string; color: string };
export type FlowNames = FlowLabels & { uncategorizedIncome: string; uncategorizedSpend: string };

/**
 * The budgets page's two maps (category id -> cents, null = uncategorized)
 * as a flow, naming each part from its category.
 */
export function moneyFlowFromMaps(
  incomeMap: ReadonlyMap<string | null, number>,
  spendMap: ReadonlyMap<string | null, number>,
  categories: readonly FlowCategory[],
  names: FlowNames
): MoneyFlow | null {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const parts = (map: ReadonlyMap<string | null, number>, unnamed: string): FlowPart[] =>
    [...map].map(([id, cents]) => {
      const category = id === null ? undefined : byId.get(id);
      return { id: id ?? "none", name: category?.name ?? unnamed, color: category?.color ?? OTHER_COLOR, cents };
    });
  return buildMoneyFlow(parts(incomeMap, names.uncategorizedIncome), parts(spendMap, names.uncategorizedSpend), names);
}
