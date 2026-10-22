import { describe, expect, it, vi } from "vitest";

/** v2.20: /budgets over a whole year - its months, added up. */

const m = vi.hoisted(() => ({ findMany: vi.fn(), categories: vi.fn() }));
vi.mock("@/lib/db/prisma", () => ({
  prisma: { transaction: { findMany: m.findMany }, category: { findMany: m.categories } },
}));

import { monthlyCashflow, monthsCovered, savingsRatePct, yearCategoryRows } from "@/lib/domain/budget-year";
import { loadBudgetYear } from "@/lib/services/budget-period";

const utc = (y: number, mo: number, d: number) => new Date(Date.UTC(y, mo, d, 12));
const UNCATEGORIZED = { name: "Non catégorisé", color: "#71717a" };

describe("monthsCovered", () => {
  it("is 12 for a past year, the months begun for this one, 0 ahead", () => {
    const now = utc(2026, 9, 21);
    expect(monthsCovered(2025, now)).toBe(12);
    expect(monthsCovered(2026, now)).toBe(10);
    expect(monthsCovered(2027, now)).toBe(0);
  });
});

describe("monthlyCashflow", () => {
  it("lays the ledger's months out January to December, empty months at zero", () => {
    const months = monthlyCashflow(
      new Map([
        ["2026-01", { incomeCents: 3800_00, expenseCents: 850_00 }],
        ["2026-02", { incomeCents: 0, expenseCents: 42_50 }],
        // Another year's month is not this year's.
        ["2025-03", { incomeCents: 1, expenseCents: 1 }],
      ]),
      2026
    );
    expect(months).toHaveLength(12);
    expect(months[0]).toEqual({ month: 0, incomeCents: 3800_00, expenseCents: 850_00 });
    expect(months[1]).toEqual({ month: 1, incomeCents: 0, expenseCents: 42_50 });
    expect(months[2]).toEqual({ month: 2, incomeCents: 0, expenseCents: 0 });
  });
});

describe("yearCategoryRows", () => {
  const categories = [
    { id: "food", name: "Courses", color: "#f00", budgetCents: BigInt(400_00) },
    { id: "rent", name: "Loyer", color: "#0f0", budgetCents: null },
    { id: "gifts", name: "Cadeaux", color: "#00f", budgetCents: null },
  ];
  const spend = new Map<string | null, number>([["food", 4500_00], ["rent", 9000_00], [null, 1500_00]]);

  it("sorts by spending, compares to the budget over the months covered, uncategorized last", () => {
    const rows = yearCategoryRows(spend, categories, 10, UNCATEGORIZED);
    expect(rows.map((r) => r.id)).toEqual(["rent", "food", null]);
    const food = rows[1];
    expect(food.budgetCents).toBe(4000_00);
    expect(food.monthlyAverageCents).toBe(450_00);
    expect(food.sharePct).toBeCloseTo(30, 5);
    expect(rows.reduce((s, r) => s + r.sharePct, 0)).toBeCloseTo(100, 5);
  });

  it("drops a category with neither spending nor a budget", () => {
    expect(yearCategoryRows(spend, categories, 12, UNCATEGORIZED).some((r) => r.id === "gifts")).toBe(false);
  });

  it("keeps a category whose refunds outweighed its spending, at no share of it", () => {
    const rows = yearCategoryRows(new Map<string | null, number>([["rent", 900_00], ["gifts", -50_00]]), categories, 12, UNCATEGORIZED);
    const gifts = rows.find((r) => r.id === "gifts")!;
    expect(gifts.spentCents).toBe(-50_00);
    expect(gifts.sharePct).toBe(0);
  });
});

describe("savingsRatePct", () => {
  it("is what was kept of what came in, and says nothing without income", () => {
    expect(savingsRatePct(40000_00, 30000_00)).toBeCloseTo(25, 5);
    expect(savingsRatePct(0, 100_00)).toBeNull();
  });
});

describe("loadBudgetYear", () => {
  it("reads the viewer's categories and the calendar year's ledger", async () => {
    m.categories.mockResolvedValue([{ id: "food", kind: "EXPENSE" }]);
    m.findMany.mockResolvedValue([]);
    const data = await loadBudgetYear("user-owner", ["acc"], 2025);
    expect(data.categories).toEqual([{ id: "food", kind: "EXPENSE" }]);
    expect(m.categories.mock.calls[0][0].where).toEqual({ userId: "user-owner" });
    expect(m.findMany.mock.calls.at(-1)![0].where).toEqual({
      accountId: { in: ["acc"] },
      date: { gte: new Date(Date.UTC(2025, 0, 1)), lt: new Date(Date.UTC(2026, 0, 1)) },
    });
    expect(data.ledger.currentChangeCents).toBe(0);
  });
});
