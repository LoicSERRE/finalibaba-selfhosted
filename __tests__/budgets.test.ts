import { describe, expect, it } from "vitest";
import { monthsBetween, computeRolloverCarryInCents, mergeCentsMaps, MAX_ROLLOVER_MONTHS } from "@/lib/domain/budgets";

describe("monthsBetween", () => {
  it("returns an empty array when from and to are in the same month", () => {
    expect(monthsBetween(new Date("2026-08-05T00:00:00Z"), new Date("2026-08-28T00:00:00Z"))).toEqual([]);
  });

  it("enumerates every month in between, from is inclusive and to is exclusive", () => {
    expect(monthsBetween(new Date("2026-06-01T00:00:00Z"), new Date("2026-09-01T00:00:00Z"))).toEqual([
      { year: 2026, month: 5 },
      { year: 2026, month: 6 },
      { year: 2026, month: 7 },
    ]);
  });

  it("rolls over the year boundary correctly", () => {
    expect(monthsBetween(new Date("2025-11-15T00:00:00Z"), new Date("2026-02-01T00:00:00Z"))).toEqual([
      { year: 2025, month: 10 },
      { year: 2025, month: 11 },
      { year: 2026, month: 0 },
    ]);
  });

  it("caps at MAX_ROLLOVER_MONTHS, keeping the most recent months", () => {
    const from = new Date("2000-01-01T00:00:00Z");
    const to = new Date("2026-08-01T00:00:00Z");
    const result = monthsBetween(from, to);
    expect(result).toHaveLength(MAX_ROLLOVER_MONTHS);
    expect(result[result.length - 1]).toEqual({ year: 2026, month: 6 });
  });
});

describe("computeRolloverCarryInCents", () => {
  it("returns 0 with no prior months", () => {
    expect(computeRolloverCarryInCents(30000, [])).toBe(0);
  });

  it("carries the full budget forward when a prior month had zero spend", () => {
    expect(computeRolloverCarryInCents(30000, [0])).toBe(30000);
  });

  it("carries only the leftover when a prior month underspent", () => {
    expect(computeRolloverCarryInCents(30000, [20000])).toBe(10000);
  });

  it("carries nothing when a prior month spent exactly the budget", () => {
    expect(computeRolloverCarryInCents(30000, [30000])).toBe(0);
  });

  it("floors at 0 rather than going negative when a prior month overspent", () => {
    expect(computeRolloverCarryInCents(30000, [45000])).toBe(0);
  });

  it("compounds leftover across multiple underspent months", () => {
    // month 1: 300 budget, 200 spent -> 100 carries in
    // month 2: 300+100=400 available, 250 spent -> 150 carries in
    // month 3: 300+150=450 available, 100 spent -> 350 carries in
    expect(computeRolloverCarryInCents(30000, [20000, 25000, 10000])).toBe(35000);
  });

  it("an overspent month resets the carry to 0 without creating debt for the month after", () => {
    // month 1: 300 budget, 100 spent -> 200 carries in
    // month 2: 300+200=500 available, 700 spent (overspend) -> floored at 0
    // month 3: 300+0=300 available, 100 spent -> 200 carries in
    expect(computeRolloverCarryInCents(30000, [10000, 70000, 10000])).toBe(20000);
  });
});

describe("mergeCentsMaps", () => {
  it("sums values for keys present in both maps", () => {
    const a = new Map<string | null, number>([["cat1", 1000], ["cat2", 500]]);
    const b = new Map<string | null, number>([["cat1", 200], ["cat3", 300]]);
    expect(mergeCentsMaps(a, b)).toEqual(
      new Map<string | null, number>([
        ["cat1", 1200],
        ["cat2", 500],
        ["cat3", 300],
      ]),
    );
  });

  it("does not mutate either input map", () => {
    const a = new Map<string | null, number>([["cat1", 1000]]);
    const b = new Map<string | null, number>([["cat1", 200]]);
    mergeCentsMaps(a, b);
    expect(a.get("cat1")).toBe(1000);
    expect(b.get("cat1")).toBe(200);
  });

  it("merges the null (uncategorized) key like any other", () => {
    const a = new Map<string | null, number>([[null, 100]]);
    const b = new Map<string | null, number>([[null, 50]]);
    expect(mergeCentsMaps(a, b).get(null)).toBe(150);
  });

  it("returns a copy of the first map when the second is empty", () => {
    const a = new Map<string | null, number>([["cat1", 1000]]);
    expect(mergeCentsMaps(a, new Map())).toEqual(a);
  });
});
