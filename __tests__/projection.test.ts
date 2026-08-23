import { describe, expect, it } from "vitest";
import { projectNetWorth } from "@/lib/domain/projection";

describe("projectNetWorth", () => {
  it("year 0 always equals the current net worth exactly", () => {
    const points = projectNetWorth({
      currentCents: 123_456_00,
      annualContributionCents: 5_000_00,
      annualReturnRate: 0.07,
      horizonYears: 30,
    });
    expect(points[0]).toEqual({ year: 0, netWorthCents: 123_456_00, netWorthAfterTaxCents: 123_456_00 });
  });

  it("stays flat with zero contribution and zero return", () => {
    const points = projectNetWorth({
      currentCents: 10_000_00,
      annualContributionCents: 0,
      annualReturnRate: 0,
      horizonYears: 5,
    });
    expect(points.map((p) => p.netWorthCents)).toEqual([10_000_00, 10_000_00, 10_000_00, 10_000_00, 10_000_00, 10_000_00]);
  });

  it("compounds correctly with no contribution (pure growth)", () => {
    const points = projectNetWorth({
      currentCents: 10_000_00,
      annualContributionCents: 0,
      annualReturnRate: 0.1,
      horizonYears: 2,
    });
    // 10_000 * 1.1^2 = 12_100
    expect(points[2].netWorthCents).toBe(Math.round(10_000_00 * 1.1 ** 2));
  });

  it("adds contributions linearly with zero return", () => {
    const points = projectNetWorth({
      currentCents: 10_000_00,
      annualContributionCents: 2_000_00,
      annualReturnRate: 0,
      horizonYears: 3,
    });
    expect(points[3].netWorthCents).toBe(10_000_00 + 2_000_00 * 3);
  });

  it("matches the closed-form lump-sum + annuity formula at year 10", () => {
    const currentCents = 50_000_00;
    const annualContributionCents = 6_000_00;
    const r = 0.06;
    const points = projectNetWorth({
      currentCents,
      annualContributionCents,
      annualReturnRate: r,
      horizonYears: 10,
    });
    const expected = currentCents * (1 + r) ** 10 + (annualContributionCents * ((1 + r) ** 10 - 1)) / r;
    expect(points[10].netWorthCents).toBe(Math.round(expected));
  });

  it("defaults to no tax applied (netWorthAfterTaxCents equals netWorthCents)", () => {
    const points = projectNetWorth({
      currentCents: 10_000_00,
      annualContributionCents: 2_000_00,
      annualReturnRate: 0.07,
      horizonYears: 5,
    });
    for (const p of points) {
      expect(p.netWorthAfterTaxCents).toBe(p.netWorthCents);
    }
  });

  it("taxes only the projected gain, never the contributions (hand-computed)", () => {
    const currentCents = 10_000_00;
    const annualContributionCents = 1_000_00;
    const r = 0.05;
    const effectiveTaxRate = 0.3;
    const points = projectNetWorth({
      currentCents,
      annualContributionCents,
      annualReturnRate: r,
      horizonYears: 3,
      effectiveTaxRate,
    });
    // year 3: NW = 10_000*1.05^3 + 1_000*((1.05^3-1)/0.05)
    const netWorthCents = currentCents * 1.05 ** 3 + (annualContributionCents * (1.05 ** 3 - 1)) / 0.05;
    const cumulativeContributions = annualContributionCents * 3;
    const gainCents = netWorthCents - currentCents - cumulativeContributions;
    const expectedAfterTax = netWorthCents - gainCents * effectiveTaxRate;
    expect(points[3].netWorthCents).toBe(Math.round(netWorthCents));
    expect(points[3].netWorthAfterTaxCents).toBe(Math.round(expectedAfterTax));
    // Sanity: after-tax must be strictly less than pre-tax once there's a real gain.
    expect(points[3].netWorthAfterTaxCents).toBeLessThan(points[3].netWorthCents);
  });

  it("never taxes a loss (negative return, zero contribution)", () => {
    const points = projectNetWorth({
      currentCents: 10_000_00,
      annualContributionCents: 0,
      annualReturnRate: -0.1,
      horizonYears: 2,
      effectiveTaxRate: 0.3,
    });
    // NW(2) = 10_000 * 0.9^2 = 8_100 - a loss, gain(t) < 0, so no tax is
    // applied and after-tax must equal pre-tax exactly (mirrors
    // totalLatentTax's own "only positive gains are taxed" rule).
    expect(points[2].netWorthCents).toBeLessThan(1_000_000);
    expect(points[2].netWorthAfterTaxCents).toBe(points[2].netWorthCents);
  });

  it("year 0 is never taxed even with a nonzero rate (no gain yet)", () => {
    const points = projectNetWorth({
      currentCents: 50_000_00,
      annualContributionCents: 0,
      annualReturnRate: 0.08,
      horizonYears: 1,
      effectiveTaxRate: 0.3,
    });
    expect(points[0].netWorthAfterTaxCents).toBe(50_000_00);
  });
});
