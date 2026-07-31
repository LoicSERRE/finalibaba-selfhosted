import { describe, expect, it } from "vitest";
import {
  normalizeLabel,
  getOccurrencesInRange,
  getMostRecentExpectedOccurrence,
  isMissed,
  detectCandidates,
  projectDailyCumulative,
  type RecurringSeries,
} from "@/lib/domain/recurring";

function utc(y: number, m: number, d: number, h = 12): Date {
  return new Date(Date.UTC(y, m, d, h, 0, 0));
}

describe("normalizeLabel", () => {
  it("trims and lowercases", () => {
    expect(normalizeLabel("  NETFLIX.COM  ")).toBe("netflix.com");
  });
});

describe("getOccurrencesInRange", () => {
  it("clamps to the last day of shorter months when the anchor is on the 31st", () => {
    const series: RecurringSeries = {
      frequency: "MONTHLY",
      intervalCount: 1,
      anchorDate: utc(2026, 0, 31), // Jan 31
    };
    const occurrences = getOccurrencesInRange(series, utc(2026, 0, 1), utc(2026, 3, 30));
    const days = occurrences.map((d) => d.getUTCDate());
    const months = occurrences.map((d) => d.getUTCMonth());
    expect(months).toEqual([0, 1, 2, 3]); // Jan, Feb, Mar, Apr
    expect(days).toEqual([31, 28, 31, 30]); // Feb 2026 is not a leap year, Apr has 30 days
  });

  it("respects intervalCount for weekly series (every 2 weeks)", () => {
    const series: RecurringSeries = {
      frequency: "WEEKLY",
      intervalCount: 2,
      anchorDate: utc(2026, 0, 1),
    };
    const occurrences = getOccurrencesInRange(series, utc(2026, 0, 1), utc(2026, 1, 1));
    const gaps = occurrences.slice(1).map((d, i) => (d.getTime() - occurrences[i].getTime()) / 86_400_000);
    expect(gaps.every((g) => g === 14)).toBe(true);
  });

  it("returns an empty array for a range that falls strictly between two occurrences", () => {
    const series: RecurringSeries = {
      frequency: "MONTHLY",
      intervalCount: 1,
      anchorDate: utc(2026, 5, 1), // 1st of the month
    };
    // Occurrences land on the 1st of every month - the 5th-25th window contains none.
    expect(getOccurrencesInRange(series, utc(2026, 5, 5), utc(2026, 5, 25))).toEqual([]);
  });

  it("projects yearly occurrences both forward and backward from the anchor indefinitely", () => {
    const series: RecurringSeries = {
      frequency: "YEARLY",
      intervalCount: 1,
      anchorDate: utc(2026, 5, 1),
    };
    // A window years before the anchor still hits the yearly pattern - there
    // is no "start date" here, the anchor is just a reference point.
    expect(getOccurrencesInRange(series, utc(2020, 0, 1), utc(2020, 11, 31))).toEqual([utc(2020, 5, 1)]);
  });
});

describe("getMostRecentExpectedOccurrence", () => {
  it("returns the latest occurrence on or before asOf, not a future one", () => {
    const series: RecurringSeries = {
      frequency: "MONTHLY",
      intervalCount: 1,
      anchorDate: utc(2026, 0, 15),
    };
    const result = getMostRecentExpectedOccurrence(series, utc(2026, 2, 20)); // Mar 20
    expect(result?.getUTCMonth()).toBe(2); // March, not April
    expect(result?.getUTCDate()).toBe(15);
  });
});

describe("isMissed", () => {
  const series = {
    frequency: "MONTHLY" as const,
    intervalCount: 1,
    anchorDate: utc(2026, 0, 15),
    accountId: "acc1",
    label: "Netflix",
    amountCents: BigInt(-1500),
  };
  const asOf = utc(2026, 2, 20); // most recent expected occurrence -> Mar 15

  it("is not missed when a matching transaction falls within the grace window", () => {
    const transactions = [
      { accountId: "acc1", label: "Netflix", amountCents: BigInt(-1500), date: utc(2026, 2, 14) },
    ];
    expect(isMissed(series, transactions, asOf)).toBe(false);
  });

  it("is missed when there is no matching transaction at all", () => {
    expect(isMissed(series, [], asOf)).toBe(true);
  });

  it("is missed when the only candidate transaction is on a different account", () => {
    const transactions = [
      { accountId: "other-acc", label: "Netflix", amountCents: BigInt(-1500), date: utc(2026, 2, 15) },
    ];
    expect(isMissed(series, transactions, asOf)).toBe(true);
  });

  it("is missed when the amount is outside the tolerance band", () => {
    const transactions = [
      // tolerance = max(1500*0.1, 500) = 500 cents -> a 2000 cents difference is well outside
      { accountId: "acc1", label: "Netflix", amountCents: BigInt(-3500), date: utc(2026, 2, 15) },
    ];
    expect(isMissed(series, transactions, asOf)).toBe(true);
  });

  it("is missed when the matching transaction falls outside the grace window", () => {
    const transactions = [
      { accountId: "acc1", label: "Netflix", amountCents: BigInt(-1500), date: utc(2026, 2, 1) }, // 14 days early, grace is 5
    ];
    expect(isMissed(series, transactions, asOf)).toBe(true);
  });

  it("label matching is case/whitespace-insensitive via normalizeLabel", () => {
    const transactions = [
      { accountId: "acc1", label: "  NETFLIX  ", amountCents: BigInt(-1500), date: utc(2026, 2, 15) },
    ];
    expect(isMissed(series, transactions, asOf)).toBe(false);
  });
});

describe("detectCandidates", () => {
  function monthlyTx(n: number, opts: Partial<{ label: string; accountId: string; amount: number; categoryId: string | null }> = {}) {
    const { label = "Netflix", accountId = "acc1", amount = -1500, categoryId = null } = opts;
    return Array.from({ length: n }, (_, i) => ({
      accountId,
      label,
      amountCents: BigInt(amount),
      date: utc(2026, i, 5),
      categoryId,
    }));
  }

  it("requires at least MIN_OCCURRENCES (3) transactions in a group", () => {
    expect(detectCandidates(monthlyTx(2), new Set())).toEqual([]);
    expect(detectCandidates(monthlyTx(3), new Set())).toHaveLength(1);
  });

  it("detects a monthly pattern and proposes the median amount as-is", () => {
    const [candidate] = detectCandidates(monthlyTx(4), new Set());
    expect(candidate.frequency).toBe("MONTHLY");
    expect(candidate.amountCents).toBe(-1500);
    expect(candidate.accountId).toBe("acc1");
  });

  it("rejects a group whose amounts vary too much to pass the match-ratio threshold", () => {
    const txs = [
      { accountId: "acc1", label: "Varie", amountCents: BigInt(-1000), date: utc(2026, 0, 5), categoryId: null },
      { accountId: "acc1", label: "Varie", amountCents: BigInt(-5000), date: utc(2026, 1, 5), categoryId: null },
      { accountId: "acc1", label: "Varie", amountCents: BigInt(-9000), date: utc(2026, 2, 5), categoryId: null },
    ];
    expect(detectCandidates(txs, new Set())).toEqual([]);
  });

  it("rejects a group whose date spacing doesn't fall into any frequency band", () => {
    // ~15-day gaps: above the weekly band (6-8d), below the monthly band (27-33d)
    const txs = [
      { accountId: "acc1", label: "Irregulier", amountCents: BigInt(-1000), date: utc(2026, 0, 1), categoryId: null },
      { accountId: "acc1", label: "Irregulier", amountCents: BigInt(-1000), date: utc(2026, 0, 16), categoryId: null },
      { accountId: "acc1", label: "Irregulier", amountCents: BigInt(-1000), date: utc(2026, 0, 31), categoryId: null },
    ];
    expect(detectCandidates(txs, new Set())).toEqual([]);
  });

  it("detects weekly and yearly bands too", () => {
    const weekly = [
      { accountId: "acc1", label: "Hebdo", amountCents: BigInt(-500), date: utc(2026, 0, 1), categoryId: null },
      { accountId: "acc1", label: "Hebdo", amountCents: BigInt(-500), date: utc(2026, 0, 8), categoryId: null },
      { accountId: "acc1", label: "Hebdo", amountCents: BigInt(-500), date: utc(2026, 0, 15), categoryId: null },
    ];
    const yearly = [
      { accountId: "acc1", label: "Annuel", amountCents: BigInt(-10000), date: utc(2024, 0, 1), categoryId: null },
      { accountId: "acc1", label: "Annuel", amountCents: BigInt(-10000), date: utc(2025, 0, 1), categoryId: null },
      { accountId: "acc1", label: "Annuel", amountCents: BigInt(-10000), date: utc(2026, 0, 1), categoryId: null },
    ];
    const candidates = detectCandidates([...weekly, ...yearly], new Set());
    const frequencies = candidates.map((c) => c.frequency).sort();
    expect(frequencies).toEqual(["WEEKLY", "YEARLY"].sort());
  });

  it("excludes groups already represented via existingKeys", () => {
    const txs = monthlyTx(4);
    const key = "acc1|netflix";
    expect(detectCandidates(txs, new Set([key]))).toEqual([]);
  });

  it("picks the majority category among the group's transactions", () => {
    const txs = [
      ...monthlyTx(1, { categoryId: "cat-a" }),
      { accountId: "acc1", label: "Netflix", amountCents: BigInt(-1500), date: utc(2026, 1, 5), categoryId: "cat-a" },
      { accountId: "acc1", label: "Netflix", amountCents: BigInt(-1500), date: utc(2026, 2, 5), categoryId: "cat-b" },
    ];
    const [candidate] = detectCandidates(txs, new Set());
    expect(candidate.categoryId).toBe("cat-a");
  });
});

describe("projectDailyCumulative", () => {
  it("produces one point per calendar day over the range, flat until the occurrence day", () => {
    const series = [
      { frequency: "MONTHLY" as const, intervalCount: 1, anchorDate: utc(2026, 0, 10), amountCents: BigInt(-2000) },
    ];
    const points = projectDailyCumulative(series, utc(2026, 0, 1), utc(2026, 0, 20));
    expect(points).toHaveLength(20);
    expect(points.slice(0, 9).every((p) => p.cumulativeCents === 0)).toBe(true); // before day 10
    expect(points[9].cumulativeCents).toBe(-2000); // day 10 (0-indexed 9)
    expect(points.slice(9).every((p) => p.cumulativeCents === -2000)).toBe(true); // stays flat after
  });

  it("sums multiple series landing on the same day", () => {
    const series = [
      { frequency: "MONTHLY" as const, intervalCount: 1, anchorDate: utc(2026, 0, 5), amountCents: BigInt(3000) },
      { frequency: "MONTHLY" as const, intervalCount: 1, anchorDate: utc(2026, 0, 5), amountCents: BigInt(-1000) },
    ];
    const points = projectDailyCumulative(series, utc(2026, 0, 1), utc(2026, 0, 10));
    const day5 = points.find((p) => p.date.getUTCDate() === 5);
    expect(day5?.cumulativeCents).toBe(2000);
  });
});
