import { describe, expect, it } from "vitest";
import {
  balanceAtOrBefore,
  estimateYearEndInterestCents,
  estimateYearEndInterestSeries,
  quinzaineBoundaries,
  rateAtDate,
} from "@/lib/domain/savings-projection";

describe("quinzaineBoundaries", () => {
  it("returns 24 UTC-midnight dates, the 1st and 16th of every month, in order", () => {
    const boundaries = quinzaineBoundaries(2026);
    expect(boundaries).toHaveLength(24);
    expect(boundaries[0].toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(boundaries[1].toISOString()).toBe("2026-01-16T00:00:00.000Z");
    expect(boundaries[22].toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(boundaries[23].toISOString()).toBe("2026-12-16T00:00:00.000Z");
    for (let i = 1; i < boundaries.length; i++) {
      expect(boundaries[i].getTime()).toBeGreaterThan(boundaries[i - 1].getTime());
    }
  });
});

describe("balanceAtOrBefore", () => {
  const balances = [
    { recordedAt: new Date("2026-02-01T00:00:00.000Z"), balanceCents: BigInt(1000_00) },
    { recordedAt: new Date("2026-03-01T00:00:00.000Z"), balanceCents: BigInt(1500_00) },
    { recordedAt: new Date("2026-05-01T00:00:00.000Z"), balanceCents: BigInt(2000_00) },
  ];

  it("picks the most recent snapshot at or before the target date", () => {
    expect(balanceAtOrBefore(balances, new Date("2026-04-01T00:00:00.000Z"))).toBe(BigInt(1500_00));
  });

  it("is inclusive of an exact match", () => {
    expect(balanceAtOrBefore(balances, new Date("2026-03-01T00:00:00.000Z"))).toBe(BigInt(1500_00));
  });

  it("returns null when nothing is old enough - account did not exist yet", () => {
    expect(balanceAtOrBefore(balances, new Date("2026-01-01T00:00:00.000Z"))).toBeNull();
  });

  it("returns the newest snapshot when the target date is after all of them", () => {
    expect(balanceAtOrBefore(balances, new Date("2026-12-31T00:00:00.000Z"))).toBe(BigInt(2000_00));
  });
});

describe("estimateYearEndInterestCents", () => {
  it("equals balance * rate for a year with a constant balance throughout", () => {
    const now = new Date("2026-07-01T00:00:00.000Z");
    const balances = [{ recordedAt: new Date("2025-01-01T00:00:00.000Z"), balanceCents: BigInt(10_000_00) }];
    const result = estimateYearEndInterestCents(balances, BigInt(10_000_00), 0.015, now);
    // 24 quinzaines * (10,000€ * 1.5% / 24) = 10,000€ * 1.5% = 150€
    expect(result).toBe(BigInt(150_00));
  });

  it("returns 0 for a 0% (or negative) rate", () => {
    const now = new Date("2026-07-01T00:00:00.000Z");
    expect(estimateYearEndInterestCents([], BigInt(10_000_00), 0, now)).toBe(BigInt(0));
  });

  it("uses real historical balances for past quinzaines and today's balance for future ones", () => {
    const now = new Date("2026-07-01T00:00:00.000Z"); // Jan 1 through Jul 1 boundary = 13 past quinzaines
    const balances = [{ recordedAt: new Date("2025-06-01T00:00:00.000Z"), balanceCents: BigInt(1_000_00) }];
    const currentBalance = BigInt(10_000_00);
    const result = estimateYearEndInterestCents(balances, currentBalance, 0.015, now);

    const allLowYear = estimateYearEndInterestCents(balances, BigInt(1_000_00), 0.015, now);
    const allHighYear = estimateYearEndInterestCents([{ recordedAt: new Date("2025-01-01T00:00:00.000Z"), balanceCents: currentBalance }], currentBalance, 0.015, now);
    // A balance that grew mid-year must land strictly between "it was always
    // low" and "it was always high" - neither extreme is the honest answer.
    expect(Number(result)).toBeGreaterThan(Number(allLowYear));
    expect(Number(result)).toBeLessThan(Number(allHighYear));
  });

  it("extrapolates backward from the earliest known balance for a quinzaine before it, rather than skipping", () => {
    // Account's first ever snapshot in this app is in June - the sync only
    // started tracking it then, but the account itself (and its balance)
    // existed before that too. The 11 quinzaines before June 1 use the same
    // 5,000€ the earliest snapshot records, same as the whole year would if
    // the balance never moved - this is the real-world case a stale-balance
    // Livret hits, and the fix for the bug this test used to pin (silently
    // treating those 11 quinzaines as a 0€ balance instead).
    const now = new Date("2026-12-31T00:00:00.000Z");
    const balances = [{ recordedAt: new Date("2026-06-01T00:00:00.000Z"), balanceCents: BigInt(5_000_00) }];
    const result = estimateYearEndInterestCents(balances, BigInt(5_000_00), 0.015, now);

    // All 24 quinzaines count now, each at the same 5,000€ balance.
    expect(result).toBe(BigInt(Math.round((5_000_00 * 0.015 * 24) / 24)));
  });

  it("still contributes nothing when the account has no balance history at all", () => {
    const now = new Date("2026-12-31T00:00:00.000Z");
    expect(estimateYearEndInterestCents([], BigInt(5_000_00), 0.015, now)).toBe(BigInt(0));
  });

  it("projects every not-yet-started quinzaine from the current balance, not the last known one", () => {
    const now = new Date("2026-01-01T00:00:00.000Z"); // only the very first quinzaine has started
    const balances = [{ recordedAt: new Date("2025-01-01T00:00:00.000Z"), balanceCents: BigInt(1_000_00) }];
    const currentBalance = BigInt(20_000_00); // a big deposit just landed
    const result = estimateYearEndInterestCents(balances, currentBalance, 0.015, now);

    // 1 quinzaine at the old 1,000€ + 23 quinzaines projected at the new 20,000€.
    const expected = BigInt(Math.round((1_000_00 * 0.015) / 24 + (23 * 20_000_00 * 0.015) / 24));
    expect(result).toBe(expected);
  });
});

describe("estimateYearEndInterestSeries", () => {
  it("extrapolates backward for a date before the first snapshot, exactly as the single-value function does", () => {
    // The regression this pins: the series used to skip such a date while
    // estimateYearEndInterestCents extrapolated backward, so the chart
    // contradicted the headline it sits under. A flat 5,000€ account
    // synced only from June must read the same on both, at every point.
    const balances = [{ recordedAt: new Date("2026-06-01T00:00:00.000Z"), balanceCents: BigInt(5_000_00) }];
    const dates = [new Date("2026-01-01T00:00:00.000Z"), new Date("2026-06-01T00:00:00.000Z")];
    const points = estimateYearEndInterestSeries(balances, 0.015, dates);

    expect(points).toHaveLength(2);
    for (const point of points) {
      expect(point.estimatedCents).toBe(estimateYearEndInterestCents(balances, BigInt(5_000_00), 0.015, point.date));
    }
    // A balance that never moved projects the same year-end figure all year -
    // no step, which is the whole point.
    expect(points[0].estimatedCents).toBe(points[1].estimatedCents);
  });

  it("matches estimateYearEndInterestCents evaluated at each point, using the balance known as of that point", () => {
    const balances = [
      { recordedAt: new Date("2026-01-01T00:00:00.000Z"), balanceCents: BigInt(5_000_00) },
      { recordedAt: new Date("2026-07-01T00:00:00.000Z"), balanceCents: BigInt(8_000_00) },
    ];
    const evaluationDates = [new Date("2026-03-01T00:00:00.000Z"), new Date("2026-09-01T00:00:00.000Z")];
    const points = estimateYearEndInterestSeries(balances, 0.015, evaluationDates);

    expect(points).toHaveLength(2);
    // On March 1st, only the 5,000€ balance was known yet - re-running the
    // year-end projection AS OF that date must use it as the "current"
    // balance for every quinzaine still ahead of March 1st, not the 8,000€
    // that only exists later in real time.
    expect(points[0].estimatedCents).toBe(estimateYearEndInterestCents(balances, BigInt(5_000_00), 0.015, evaluationDates[0]));
    // By September 1st the 8,000€ balance was already known.
    expect(points[1].estimatedCents).toBe(estimateYearEndInterestCents(balances, BigInt(8_000_00), 0.015, evaluationDates[1]));
    // And the estimate genuinely moved between the two evaluation dates.
    expect(points[1].estimatedCents).not.toBe(points[0].estimatedCents);
  });

  it("returns an empty series for an account with no balance history at all", () => {
    const points = estimateYearEndInterestSeries([], 0.015, [new Date("2026-06-01T00:00:00.000Z")]);
    expect(points).toEqual([]);
  });
});

describe("rateAtDate", () => {
  const AUG = new Date(Date.UTC(2026, 7, 1));

  it("uses today's rate when nothing was ever recorded", () => {
    expect(rateAtDate(0.017, [], new Date(Date.UTC(2026, 2, 15)))).toBeCloseTo(0.017, 10);
  });

  it("uses the recorded rate before its date and today's rate from it on", () => {
    // A row says what the account paid UNTIL a date, so one row plus the
    // current rate describes a whole French regulated year: 1.5% until
    // 1 August 2026, 1.7% after.
    const history = [{ ratePct: 0.015, until: AUG }];
    expect(rateAtDate(0.017, history, new Date(Date.UTC(2026, 6, 31)))).toBeCloseTo(0.015, 10);
    expect(rateAtDate(0.017, history, AUG)).toBeCloseTo(0.017, 10);
    expect(rateAtDate(0.017, history, new Date(Date.UTC(2026, 8, 1)))).toBeCloseTo(0.017, 10);
  });

  it("picks the earliest row still open, with several changes on file", () => {
    const history = [
      { ratePct: 0.03, until: new Date(Date.UTC(2025, 1, 1)) },
      { ratePct: 0.024, until: new Date(Date.UTC(2026, 1, 1)) },
      { ratePct: 0.015, until: AUG },
    ];
    expect(rateAtDate(0.017, history, new Date(Date.UTC(2024, 5, 1)))).toBeCloseTo(0.03, 10);
    expect(rateAtDate(0.017, history, new Date(Date.UTC(2025, 5, 1)))).toBeCloseTo(0.024, 10);
    expect(rateAtDate(0.017, history, new Date(Date.UTC(2026, 5, 1)))).toBeCloseTo(0.015, 10);
    expect(rateAtDate(0.017, history, new Date(Date.UTC(2026, 10, 1)))).toBeCloseTo(0.017, 10);
  });
});

describe("estimateYearEndInterestCents across a rate change", () => {
  const balances = [{ recordedAt: new Date(Date.UTC(2026, 0, 1)), balanceCents: BigInt(1_000_000) }];
  const now = new Date(Date.UTC(2026, 11, 31));

  it("values each fortnight at the rate that fortnight carried", () => {
    // 10 000 EUR held all year. 14 of the 24 fortnights start before
    // 1 August and pay 1.5%; the other 10 pay 1.7%.
    const mixed = estimateYearEndInterestCents(balances, BigInt(1_000_000), 0.017, now, [
      { ratePct: 0.015, until: new Date(Date.UTC(2026, 7, 1)) },
    ]);
    const expected = Math.round((1_000_000 * 0.015 * 14) / 24 + (1_000_000 * 0.017 * 10) / 24);
    expect(Number(mixed)).toBe(expected);

    // And it sits between the two figures a single rate would have produced -
    // which is the whole point: whichever one was stored, the year was wrong
    // by the spread over half of it.
    const allOld = estimateYearEndInterestCents(balances, BigInt(1_000_000), 0.015, now);
    const allNew = estimateYearEndInterestCents(balances, BigInt(1_000_000), 0.017, now);
    expect(Number(mixed)).toBeGreaterThan(Number(allOld));
    expect(Number(mixed)).toBeLessThan(Number(allNew));
  });

  it("still earns for the fortnights covered when the rate has since gone to zero", () => {
    const earned = estimateYearEndInterestCents(balances, BigInt(1_000_000), 0, now, [
      { ratePct: 0.02, until: new Date(Date.UTC(2026, 6, 1)) },
    ]);
    expect(Number(earned)).toBeGreaterThan(0);
  });
});
