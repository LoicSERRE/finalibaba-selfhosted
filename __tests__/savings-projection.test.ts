import { describe, expect, it } from "vitest";
import {
  balanceAtOrBefore,
  estimateYearEndInterestCents,
  quinzaineBoundaries,
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

  it("contributes nothing for a quinzaine before the account had any recorded balance", () => {
    // Account's first ever snapshot is in June - the 11 quinzaines before that
    // (Jan 1 through Jun 1) must be skipped, not treated as a 0€ balance.
    const now = new Date("2026-12-31T00:00:00.000Z");
    const balances = [{ recordedAt: new Date("2026-06-01T00:00:00.000Z"), balanceCents: BigInt(5_000_00) }];
    const result = estimateYearEndInterestCents(balances, BigInt(5_000_00), 0.015, now);

    // Only the 13 quinzaines from Jun 1 onward (inclusive) should count.
    const quinzainesCounted = quinzaineBoundaries(2026).filter((b) => b.getTime() >= new Date("2026-06-01T00:00:00.000Z").getTime()).length;
    const expected = BigInt(Math.round((5_000_00 * 0.015 * quinzainesCounted) / 24));
    expect(result).toBe(expected);
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
