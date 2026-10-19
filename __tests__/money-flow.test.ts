import { describe, expect, it } from "vitest";
import { buildMoneyFlow, foldSmallParts, moneyFlowFromMaps, FLOW_MAX_CATEGORIES, type FlowPart } from "@/lib/domain/money-flow";

/**
 * The month's money flow (v2.16). A Sankey only reads true if what flows in
 * equals what flows out of every middle node; these pin that balance in
 * both kinds of month, plus the folding that keeps it legible.
 */
const L = { income: "Revenus", savings: "Épargne", drawn: "Pris sur l'épargne", other: "Autres" };
const part = (id: string, cents: number): FlowPart => ({ id, name: id, cents, color: "#000" });
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

function balanced(flow: NonNullable<ReturnType<typeof buildMoneyFlow>>) {
  const hub = flow.nodes.findIndex((n) => n.kind === "hub");
  const inflow = sum(flow.links.filter((l) => l.target === hub).map((l) => l.value));
  const outflow = sum(flow.links.filter((l) => l.source === hub).map((l) => l.value));
  return inflow === outflow;
}

describe("buildMoneyFlow", () => {
  it("sends the surplus to savings in a month that earned more than it spent", () => {
    const flow = buildMoneyFlow([part("Salaire", 300000)], [part("Loyer", 80000), part("Courses", 40000)], L)!;
    expect(flow.nodes.map((n) => n.name)).toEqual(["Salaire", "Revenus", "Loyer", "Courses", "Épargne"]);
    expect(flow.nodes.at(-1)!.cents).toBe(180000);
    expect(balanced(flow)).toBe(true);
  });

  it("draws the deficit from savings in a month that spent more", () => {
    const flow = buildMoneyFlow([part("Salaire", 100000)], [part("Vacances", 150000)], L)!;
    expect(flow.nodes.map((n) => n.name)).toEqual(["Salaire", "Pris sur l'épargne", "Revenus", "Vacances"]);
    expect(flow.nodes[1].cents).toBe(50000);
    expect(balanced(flow)).toBe(true);
  });

  it("shows neither when the month balances exactly", () => {
    const flow = buildMoneyFlow([part("Salaire", 1000)], [part("Loyer", 1000)], L)!;
    expect(flow.nodes.map((n) => n.name)).toEqual(["Salaire", "Revenus", "Loyer"]);
  });

  it("draws spending with no income at all, entirely from savings", () => {
    const flow = buildMoneyFlow([], [part("Loyer", 1000)], L)!;
    expect(flow.nodes.map((n) => n.name)).toEqual(["Pris sur l'épargne", "Revenus", "Loyer"]);
    expect(balanced(flow)).toBe(true);
  });

  it("is null for an empty month and ignores zero or negative parts", () => {
    expect(buildMoneyFlow([], [], L)).toBeNull();
    expect(buildMoneyFlow([part("a", 0)], [part("b", -5)], L)).toBeNull();
  });
});

describe("foldSmallParts", () => {
  it("keeps the biggest and folds the rest into one part, total unchanged", () => {
    const parts = Array.from({ length: 12 }, (_, i) => part(`c${i}`, (i + 1) * 100));
    const folded = foldSmallParts(parts, FLOW_MAX_CATEGORIES, { id: "other", name: "Autres", color: "#999" });
    expect(folded).toHaveLength(FLOW_MAX_CATEGORIES);
    expect(folded[0].id).toBe("c11");
    expect(folded.at(-1)!.id).toBe("other");
    expect(sum(folded.map((p) => p.cents))).toBe(sum(parts.map((p) => p.cents)));
  });
});

describe("moneyFlowFromMaps", () => {
  it("names parts from their category, and the uncategorized ones from the labels", () => {
    const flow = moneyFlowFromMaps(
      new Map([["sal", 2000], [null, 500]]),
      new Map([["rent", 1500], [null, 100]]),
      [{ id: "sal", name: "Salaire", color: "#1" }, { id: "rent", name: "Loyer", color: "#2" }],
      { ...L, uncategorizedIncome: "Revenus non catégorisés", uncategorizedSpend: "Non catégorisé" }
    )!;
    expect(flow.nodes.map((n) => n.name)).toEqual(["Salaire", "Revenus non catégorisés", "Revenus", "Loyer", "Non catégorisé", "Épargne"]);
    expect(flow.nodes[0].color).toBe("#1");
  });
});
