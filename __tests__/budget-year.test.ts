import { describe, expect, it, vi } from "vitest";

/** v2.20: /budgets over a whole year - its months, added up. */

const m = vi.hoisted(() => ({ groupBy: vi.fn(), splitGroupBy: vi.fn(), findMany: vi.fn(), splitFindMany: vi.fn(), categories: vi.fn() }));
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    transaction: { groupBy: m.groupBy, findMany: m.findMany },
    transactionSplit: { groupBy: m.splitGroupBy, findMany: m.splitFindMany },
    category: { findMany: m.categories },
  },
}));

import { monthlyCashflow, monthsCovered, savingsRatePct, yearCategoryRows } from "@/lib/domain/budget-year";
import { loadBudgetYear, periodAmounts, periodCategoryTotals } from "@/lib/services/budget-period";

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
  it("buckets credits and debits by calendar month", () => {
    const months = monthlyCashflow([
      { date: utc(2026, 0, 28), amountCents: BigInt(3800_00) },
      { date: utc(2026, 0, 5), amountCents: BigInt(-850_00) },
      { date: utc(2026, 1, 3), amountCents: -42_50 },
    ]);
    expect(months).toHaveLength(12);
    expect(months[0]).toEqual({ month: 0, incomeCents: 3800_00, expenseCents: 850_00 });
    expect(months[1]).toEqual({ month: 1, incomeCents: 0, expenseCents: 42_50 });
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
});

describe("savingsRatePct", () => {
  it("is what was kept of what came in, and says nothing without income", () => {
    expect(savingsRatePct(40000_00, 30000_00)).toBeCloseTo(25, 5);
    expect(savingsRatePct(0, 100_00)).toBeNull();
  });
});

describe("periodCategoryTotals", () => {
  it("merges whole transactions and split lines into positive spend and income", async () => {
    m.groupBy
      .mockResolvedValueOnce([{ categoryId: "food", _sum: { amountCents: BigInt(-100_00) } }])
      .mockResolvedValueOnce([{ categoryId: null, _sum: { amountCents: BigInt(3800_00) } }]);
    m.splitGroupBy
      .mockResolvedValueOnce([{ categoryId: "food", _sum: { amountCents: BigInt(-20_00) } }])
      .mockResolvedValueOnce([]);
    const { spendMap, incomeMap } = await periodCategoryTotals(["acc"], utc(2026, 0, 1), utc(2027, 0, 1));
    expect(spendMap.get("food")).toBe(120_00);
    expect(incomeMap.get(null)).toBe(3800_00);
    // A split transaction counts through its lines, never its parent.
    expect(m.groupBy.mock.calls[0][0].where).toMatchObject({ splits: { none: {} }, isInternalTransfer: false });
  });

  it("dates split lines by their parent transaction", async () => {
    m.findMany.mockResolvedValue([{ date: utc(2026, 2, 1), amountCents: BigInt(-10_00) }]);
    m.splitFindMany.mockResolvedValue([{ amountCents: BigInt(-5_00), transaction: { date: utc(2026, 3, 9) } }]);
    expect(await periodAmounts(["acc"], utc(2026, 0, 1), utc(2027, 0, 1))).toEqual([
      { date: utc(2026, 2, 1), amountCents: BigInt(-10_00) },
      { date: utc(2026, 3, 9), amountCents: BigInt(-5_00) },
    ]);
  });
});

describe("loadBudgetYear", () => {
  it("reads the viewer's categories and the calendar year's figures", async () => {
    m.categories.mockResolvedValue([{ id: "food" }]);
    m.groupBy.mockResolvedValue([]);
    m.splitGroupBy.mockResolvedValue([]);
    m.findMany.mockResolvedValue([]);
    m.splitFindMany.mockResolvedValue([]);
    const data = await loadBudgetYear("user-owner", ["acc"], 2025);
    expect(data.categories).toEqual([{ id: "food" }]);
    expect(m.categories.mock.calls[0][0].where).toEqual({ userId: "user-owner" });
    expect(m.findMany.mock.calls.at(-1)![0].where).toMatchObject({ date: { gte: new Date(Date.UTC(2025, 0, 1)), lt: new Date(Date.UTC(2026, 0, 1)) } });
  });
});
