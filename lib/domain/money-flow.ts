/**
 * The period's money flow as a Sankey graph (v2.16): income sources into one
 * hub, out to spending categories. Pure; the amounts are the budgets page's
 * own (lib/domain/period-ledger.ts), so the diagram and the numbers beside it
 * are the same numbers.
 *
 * v2.21.1: what balances the hub is the real change of the current accounts.
 * Money set aside and the current accounts' other movements (a loan paid out,
 * a transfer from a bank the app does not follow) flow in and out as their
 * own parts, so what is left over - or what was taken - is what the current
 * accounts actually gained or lost, never a difference that silently absorbs
 * them.
 */

export type FlowPart = { id: string; name: string; cents: number; color: string };

export type FlowNode = { name: string; color: string; cents: number; kind: "source" | "hub" | "target" };
export type FlowLink = { source: number; target: number; value: number };
export type MoneyFlow = { nodes: FlowNode[]; links: FlowLink[] };

export type FlowLabels = {
  /** The middle node: the current accounts, which everything passes through. */
  hub: string;
  other: string;
  /** What the current accounts gained over the period. */
  leftover: string;
  /** What they lost. */
  drawnCurrent: string;
};

export const FLOW_MAX_CATEGORIES = 8;
const HUB_COLOR = "#6366f1";
const LEFTOVER_COLOR = "#22c55e";
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

const flipped = (parts: readonly FlowPart[]) => parts.filter((p) => p.cents < 0).map((p) => ({ ...p, cents: -p.cents }));

/**
 * Null when there is nothing to draw.
 *
 * `incomes` and `expenses` are net per category: a category whose refunds
 * outweighed its spending flows in, an income category that went negative
 * flows out. `movements` are signed from the current accounts' side -
 * positive left them (set aside, repaid, sent), negative came in - and are
 * never folded into the categories.
 */
export function buildMoneyFlow(
  incomes: readonly FlowPart[],
  expenses: readonly FlowPart[],
  labels: FlowLabels,
  movements: readonly FlowPart[] = []
): MoneyFlow | null {
  const other = { id: "other", name: labels.other, color: OTHER_COLOR };
  const sources = foldSmallParts([...incomes, ...flipped(expenses)], FLOW_MAX_CATEGORIES, other);
  const targets = foldSmallParts([...expenses, ...flipped(incomes)], FLOW_MAX_CATEGORIES, other);
  const allIn = [...sources, ...flipped(movements)];
  const allOut = [...targets, ...movements.filter((p) => p.cents > 0)];
  if (allIn.length === 0 && allOut.length === 0) return null;

  const inCents = allIn.reduce((sum, p) => sum + p.cents, 0);
  const outCents = allOut.reduce((sum, p) => sum + p.cents, 0);
  const balance = inCents - outCents;
  const inParts = balance < 0 ? [...allIn, { id: "drawn", name: labels.drawnCurrent, cents: -balance, color: DRAWN_COLOR }] : allIn;
  const outParts = balance > 0 ? [...allOut, { id: "leftover", name: labels.leftover, cents: balance, color: LEFTOVER_COLOR }] : allOut;

  const nodes: FlowNode[] = [
    ...inParts.map((p) => ({ name: p.name, color: p.color, cents: p.cents, kind: "source" as const })),
    { name: labels.hub, color: HUB_COLOR, cents: Math.max(inCents, outCents), kind: "hub" as const },
    ...outParts.map((p) => ({ name: p.name, color: p.color, cents: p.cents, kind: "target" as const })),
  ];
  const hub = inParts.length;
  const links: FlowLink[] = [
    ...inParts.map((p, i) => ({ source: i, target: hub, value: p.cents })),
    ...outParts.map((p, i) => ({ source: hub, target: hub + 1 + i, value: p.cents })),
  ];
  return { nodes, links };
}

export type FlowCategory = { id: string; name: string; color: string };

/** Each movement's name in both directions: [left the current accounts, came in]. */
export type FlowNames = FlowLabels & {
  uncategorizedIncome: string;
  uncategorizedSpend: string;
  setSavings: readonly [string, string];
  setInvestment: readonly [string, string];
  loan: readonly [string, string];
  untracked: readonly [string, string];
  between: readonly [string, string];
  elsewhere: readonly [string, string];
};

/** What the flow needs of the ledger, without importing its module here. */
export type FlowMovements = {
  setAside: { savingsCents: number; investmentCents: number; byCategory: ReadonlyMap<string, number> };
  other: {
    loanInCents: number;
    loanOutCents: number;
    untrackedInCents: number;
    untrackedOutCents: number;
    betweenCents: number;
    elsewhereCents: number;
  };
};

const SET_SAVINGS_COLOR = "#16a34a";
const SET_INVESTMENT_COLOR = "#06b6d4";
const LOAN_COLOR = "#a855f7";
const UNTRACKED_COLOR = "#94a3b8";

/**
 * The ledger's two maps (category id -> cents, null = uncategorized) and its
 * movements as a flow, naming each part from its category.
 */
export function moneyFlowFromMaps(
  incomeMap: ReadonlyMap<string | null, number>,
  spendMap: ReadonlyMap<string | null, number>,
  categories: readonly FlowCategory[],
  names: FlowNames,
  movements?: FlowMovements
): MoneyFlow | null {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const parts = (map: ReadonlyMap<string | null, number>, unnamed: string): FlowPart[] =>
    [...map].map(([id, cents]) => {
      const category = id === null ? undefined : byId.get(id);
      return { id: id ?? "none", name: category?.name ?? unnamed, color: category?.color ?? OTHER_COLOR, cents };
    });
  // Signed "out": a positive movement left the current accounts.
  const movement = (id: string, [out, inName]: readonly [string, string], cents: number, color: string): FlowPart => ({
    id,
    name: cents < 0 ? inName : out,
    cents,
    color,
  });
  const moved: FlowPart[] = movements
    ? [
        movement("set-savings", names.setSavings, movements.setAside.savingsCents, SET_SAVINGS_COLOR),
        movement("set-investment", names.setInvestment, movements.setAside.investmentCents, SET_INVESTMENT_COLOR),
        ...[...movements.setAside.byCategory].map(([id, cents]) => {
          const category = byId.get(id);
          return { id, name: category?.name ?? names.other, color: category?.color ?? OTHER_COLOR, cents };
        }),
        movement("loan-in", names.loan, -movements.other.loanInCents, LOAN_COLOR),
        movement("loan-out", names.loan, -movements.other.loanOutCents, LOAN_COLOR),
        movement("untracked-in", names.untracked, -movements.other.untrackedInCents, UNTRACKED_COLOR),
        movement("untracked-out", names.untracked, -movements.other.untrackedOutCents, UNTRACKED_COLOR),
        movement("between", names.between, -movements.other.betweenCents, UNTRACKED_COLOR),
        movement("elsewhere", names.elsewhere, -movements.other.elsewhereCents, UNTRACKED_COLOR),
      ].filter((p) => p.cents !== 0)
    : [];
  return buildMoneyFlow(parts(incomeMap, names.uncategorizedIncome), parts(spendMap, names.uncategorizedSpend), names, moved);
}
