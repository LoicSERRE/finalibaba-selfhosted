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

export type FlowLabels = {
  income: string;
  savings: string;
  drawn: string;
  other: string;
  /**
   * v2.21: once money set aside is drawn as its own parts, what is left over
   * is no longer "savings" but what stayed on the current accounts - and a
   * shortfall was taken from them.
   */
  leftover?: string;
  drawnCurrent?: string;
};

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

/**
 * Null when there is nothing to draw: no income and no spending.
 *
 * `setAside` (v2.21): money set aside, signed. A positive part flows out
 * beside the spending, never folded into it; a negative one - more taken
 * back than put in - flows in beside the income. incomeCents and spentCents
 * stay the income and the spending alone.
 */
export function buildMoneyFlow(
  incomes: readonly FlowPart[],
  expenses: readonly FlowPart[],
  labels: FlowLabels,
  setAside: readonly FlowPart[] = []
): MoneyFlow | null {
  const other = { id: "other", name: labels.other, color: OTHER_COLOR };
  const sources = foldSmallParts(incomes, FLOW_MAX_CATEGORIES, other);
  const targets = foldSmallParts(expenses, FLOW_MAX_CATEGORIES, other);
  const incomeCents = sources.reduce((sum, p) => sum + p.cents, 0);
  const spentCents = targets.reduce((sum, p) => sum + p.cents, 0);
  const keptOut = setAside.filter((p) => p.cents > 0);
  const takenBack = setAside.filter((p) => p.cents < 0).map((p) => ({ ...p, cents: -p.cents }));
  if (incomeCents === 0 && spentCents === 0 && keptOut.length === 0 && takenBack.length === 0) return null;

  const allIn = [...sources, ...takenBack];
  const allOut = [...targets, ...keptOut];
  const inCents = allIn.reduce((sum, p) => sum + p.cents, 0);
  const outCents = allOut.reduce((sum, p) => sum + p.cents, 0);
  const balance = inCents - outCents;
  const withSetAside = setAside.some((p) => p.cents !== 0);
  const drawn = { id: "drawn", name: (withSetAside && labels.drawnCurrent) || labels.drawn, cents: -balance, color: DRAWN_COLOR };
  const kept = { id: "savings", name: (withSetAside && labels.leftover) || labels.savings, cents: balance, color: SAVINGS_COLOR };
  const inParts = balance < 0 ? [...allIn, drawn] : allIn;
  const outParts = balance > 0 ? [...allOut, kept] : allOut;

  const nodes: FlowNode[] = [
    ...inParts.map((p) => ({ name: p.name, color: p.color, cents: p.cents, kind: "source" as const })),
    { name: labels.income, color: HUB_COLOR, cents: Math.max(inCents, outCents), kind: "hub" as const },
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
export type FlowNames = FlowLabels & {
  uncategorizedIncome: string;
  uncategorizedSpend: string;
  /** v2.21: the set-aside lines the app infers, in both directions. */
  setSavings?: string;
  takenFromSavings?: string;
  setInvestment?: string;
  takenFromInvestment?: string;
};

/** What the set-aside flows need, without importing the set-aside module's types here. */
export type FlowSetAside = { savingsCents: number; investmentCents: number; byCategory: ReadonlyMap<string, number> };

const SET_SAVINGS_COLOR = "#16a34a";
const SET_INVESTMENT_COLOR = "#06b6d4";

/**
 * The budgets page's two maps (category id -> cents, null = uncategorized)
 * as a flow, naming each part from its category.
 */
export function moneyFlowFromMaps(
  incomeMap: ReadonlyMap<string | null, number>,
  spendMap: ReadonlyMap<string | null, number>,
  categories: readonly FlowCategory[],
  names: FlowNames,
  setAside?: FlowSetAside
): MoneyFlow | null {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const parts = (map: ReadonlyMap<string | null, number>, unnamed: string): FlowPart[] =>
    [...map].map(([id, cents]) => {
      const category = id === null ? undefined : byId.get(id);
      return { id: id ?? "none", name: category?.name ?? unnamed, color: category?.color ?? OTHER_COLOR, cents };
    });
  const kept: FlowPart[] = setAside
    ? [
        {
          id: "set-savings",
          name: (setAside.savingsCents < 0 ? names.takenFromSavings : names.setSavings) ?? names.savings,
          cents: setAside.savingsCents,
          color: SET_SAVINGS_COLOR,
        },
        {
          id: "set-investment",
          name: (setAside.investmentCents < 0 ? names.takenFromInvestment : names.setInvestment) ?? names.other,
          cents: setAside.investmentCents,
          color: SET_INVESTMENT_COLOR,
        },
        ...[...setAside.byCategory].map(([id, cents]) => {
          const category = byId.get(id);
          return { id, name: category?.name ?? names.other, color: category?.color ?? OTHER_COLOR, cents };
        }),
      ].filter((p) => p.cents !== 0)
    : [];
  return buildMoneyFlow(parts(incomeMap, names.uncategorizedIncome), parts(spendMap, names.uncategorizedSpend), names, kept);
}
