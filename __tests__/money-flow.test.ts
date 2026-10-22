import { describe, expect, it } from "vitest";
import { buildMoneyFlow, foldSmallParts, moneyFlowFromMaps, FLOW_MAX_CATEGORIES, type FlowPart } from "@/lib/domain/money-flow";
import { NO_OTHER } from "@/lib/domain/period-ledger";

/**
 * The period's money flow (v2.16). A Sankey only reads true if what flows in
 * equals what flows out of every middle node; these pin that balance in
 * every kind of period, plus the folding that keeps it legible. Since
 * v2.21.1 what balances it is the current accounts' real change.
 */
const L = { hub: "Comptes courants", other: "Autres", leftover: "Resté sur vos comptes courants", drawnCurrent: "Pris sur vos comptes courants" };
const NAMES = {
  ...L,
  uncategorizedIncome: "Revenus non catégorisés",
  uncategorizedSpend: "Non catégorisé",
  setSavings: ["Vers vos livrets", "Retiré de vos livrets"],
  setInvestment: ["Titres et placements", "Retiré de vos placements"],
  loan: ["Remboursements de prêt", "Prêt versé"],
  untracked: ["Envoyé vers d'autres comptes", "Reçu d'autres comptes"],
  between: ["Entre vos comptes courants", "Entre vos comptes courants"],
  elsewhere: ["Resté sur vos autres comptes", "Payé depuis vos autres comptes"],
} as const;
const part = (id: string, cents: number): FlowPart => ({ id, name: id, cents, color: "#000" });
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

function balanced(flow: NonNullable<ReturnType<typeof buildMoneyFlow>>) {
  const hub = flow.nodes.findIndex((n) => n.kind === "hub");
  const inflow = sum(flow.links.filter((l) => l.target === hub).map((l) => l.value));
  const outflow = sum(flow.links.filter((l) => l.source === hub).map((l) => l.value));
  return inflow === outflow;
}

describe("buildMoneyFlow", () => {
  it("leaves the surplus on the current accounts in a period that earned more than it spent", () => {
    const flow = buildMoneyFlow([part("Salaire", 300000)], [part("Loyer", 80000), part("Courses", 40000)], L)!;
    expect(flow.nodes.map((n) => n.name)).toEqual(["Salaire", "Comptes courants", "Loyer", "Courses", "Resté sur vos comptes courants"]);
    expect(flow.nodes.at(-1)!.cents).toBe(180000);
    expect(balanced(flow)).toBe(true);
  });

  it("takes the deficit from the current accounts in a period that spent more", () => {
    const flow = buildMoneyFlow([part("Salaire", 100000)], [part("Vacances", 150000)], L)!;
    expect(flow.nodes.map((n) => n.name)).toEqual(["Salaire", "Pris sur vos comptes courants", "Comptes courants", "Vacances"]);
    expect(flow.nodes[1].cents).toBe(50000);
    expect(balanced(flow)).toBe(true);
  });

  it("shows neither when the period balances exactly", () => {
    const flow = buildMoneyFlow([part("Salaire", 1000)], [part("Loyer", 1000)], L)!;
    expect(flow.nodes.map((n) => n.name)).toEqual(["Salaire", "Comptes courants", "Loyer"]);
  });

  it("is null for an empty period", () => {
    expect(buildMoneyFlow([], [], L)).toBeNull();
    expect(buildMoneyFlow([part("a", 0)], [part("b", 0)], L, [part("c", 0)])).toBeNull();
  });

  it("sends a category that got back more than it spent in, and a negative income out", () => {
    const flow = buildMoneyFlow([part("Salaire", 1000_00), part("Prime", -50_00)], [part("Loyer", 400_00), part("Santé", -30_00)], L)!;
    expect(flow.nodes.filter((n) => n.kind === "source").map((n) => [n.name, n.cents])).toEqual([["Salaire", 1000_00], ["Santé", 30_00]]);
    expect(flow.nodes.filter((n) => n.kind === "target").map((n) => [n.name, n.cents])).toEqual([
      ["Loyer", 400_00],
      ["Prime", 50_00],
      ["Resté sur vos comptes courants", 580_00],
    ]);
    expect(balanced(flow)).toBe(true);
  });

  it("draws movements beside the categories, out when positive and in when negative", () => {
    const flow = buildMoneyFlow([part("Salaire", 1000_00)], [part("Loyer", 800_00)], L, [part("Livret", 3000_00), part("Prêt", -2500_00), part("Virement", -200_00)])!;
    expect(flow.nodes.map((n) => n.name)).toEqual(["Salaire", "Prêt", "Virement", "Pris sur vos comptes courants", "Comptes courants", "Loyer", "Livret"]);
    // 1 000 + 2 700 in, 800 + 3 000 out: the current accounts lost 100.
    expect(flow.nodes[3].cents).toBe(100_00);
    expect(balanced(flow)).toBe(true);
  });

  it("draws a period with only movements", () => {
    const flow = buildMoneyFlow([], [], L, [part("Livret", 300_00)]);
    expect(flow?.nodes.map((n) => n.name)).toEqual(["Pris sur vos comptes courants", "Comptes courants", "Livret"]);
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
  const categories = [
    { id: "sal", name: "Salaire", color: "#1" },
    { id: "rent", name: "Loyer", color: "#2" },
    { id: "pea", name: "PEA", color: "#3" },
  ];

  it("names parts from their category, and the uncategorized ones from the labels", () => {
    const flow = moneyFlowFromMaps(new Map([["sal", 2000], [null, 500]]), new Map([["rent", 1500], [null, 100]]), categories, NAMES)!;
    expect(flow.nodes.map((n) => n.name)).toEqual(["Salaire", "Revenus non catégorisés", "Comptes courants", "Loyer", "Non catégorisé", "Resté sur vos comptes courants"]);
    expect(flow.nodes[0].color).toBe("#1");
  });

  it("names each movement by its direction, and SAVINGS categories by their own name", () => {
    const flow = moneyFlowFromMaps(new Map([["sal", 2000_00]]), new Map(), categories, NAMES, {
      setAside: { savingsCents: -200_00, investmentCents: 50_00, byCategory: new Map([["pea", 300_00]]) },
      other: { ...NO_OTHER, loanInCents: 1000_00, loanOutCents: -150_00, untrackedInCents: 70_00, untrackedOutCents: -20_00, elsewhereCents: 5_00 },
    })!;
    expect(flow.nodes.filter((n) => n.kind === "source").map((n) => n.name)).toEqual([
      "Salaire",
      "Retiré de vos livrets",
      "Prêt versé",
      "Reçu d'autres comptes",
      "Payé depuis vos autres comptes",
    ]);
    expect(flow.nodes.filter((n) => n.kind === "target").map((n) => n.name)).toEqual([
      "Titres et placements",
      "PEA",
      "Remboursements de prêt",
      "Envoyé vers d'autres comptes",
      "Resté sur vos comptes courants",
    ]);
    // 2000 + 200 + 1000 + 70 + 5 in, 50 + 300 + 150 + 20 out.
    expect(flow.nodes.at(-1)!.cents).toBe(2755_00);
    expect(balanced(flow)).toBe(true);
  });
});
