import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import {
  evaluateNetWorthAlert,
  isLoanNearlyPaidOff,
  evaluateAccountBalanceAlert,
  evaluateBudgetOverrunAlert,
  holdingMarketValueCents,
  computeUnrealizedGain,
  evaluatePercentAlert,
} from "@/lib/domain/alerts";

describe("evaluateNetWorthAlert", () => {
  it("never fires on the first evaluation (wasAbove=null), just records the baseline", () => {
    expect(evaluateNetWorthAlert(BigInt(120_000_00), BigInt(100_000_00), null)).toEqual({
      shouldFire: false,
      isAbove: true,
    });
    expect(evaluateNetWorthAlert(BigInt(80_000_00), BigInt(100_000_00), null)).toEqual({
      shouldFire: false,
      isAbove: false,
    });
  });

  it("fires when crossing from below to above", () => {
    expect(evaluateNetWorthAlert(BigInt(110_000_00), BigInt(100_000_00), false)).toEqual({
      shouldFire: true,
      isAbove: true,
    });
  });

  it("fires when crossing from above to below", () => {
    expect(evaluateNetWorthAlert(BigInt(90_000_00), BigInt(100_000_00), true)).toEqual({
      shouldFire: true,
      isAbove: false,
    });
  });

  it("does not fire when staying on the same side", () => {
    expect(evaluateNetWorthAlert(BigInt(150_000_00), BigInt(100_000_00), true)).toEqual({
      shouldFire: false,
      isAbove: true,
    });
    expect(evaluateNetWorthAlert(BigInt(50_000_00), BigInt(100_000_00), false)).toEqual({
      shouldFire: false,
      isAbove: false,
    });
  });

  it("treats exactly-at-threshold as above", () => {
    expect(evaluateNetWorthAlert(BigInt(100_000_00), BigInt(100_000_00), false)).toEqual({
      shouldFire: true,
      isAbove: true,
    });
  });
});

describe("isLoanNearlyPaidOff", () => {
  it("is true at exactly 5% remaining", () => {
    expect(isLoanNearlyPaidOff(BigInt(5_000_00), BigInt(100_000_00))).toBe(true);
  });

  it("is true below 5% remaining", () => {
    expect(isLoanNearlyPaidOff(BigInt(1_000_00), BigInt(100_000_00))).toBe(true);
  });

  it("is false above 5% remaining", () => {
    expect(isLoanNearlyPaidOff(BigInt(10_000_00), BigInt(100_000_00))).toBe(false);
  });

  it("is false for a zero or negative original amount (guards a div-by-zero-shaped input)", () => {
    expect(isLoanNearlyPaidOff(BigInt(0), BigInt(0))).toBe(false);
    expect(isLoanNearlyPaidOff(BigInt(-100), BigInt(-1000))).toBe(false);
  });

  it("is true for a fully paid off loan (remaining 0)", () => {
    expect(isLoanNearlyPaidOff(BigInt(0), BigInt(100_000_00))).toBe(true);
  });
});

describe("evaluateAccountBalanceAlert", () => {
  it("never fires on the first evaluation (wasAbove=null), just records the baseline", () => {
    expect(evaluateAccountBalanceAlert(BigInt(1_500_00), BigInt(1_000_00), null)).toEqual({
      shouldFire: false,
      isAbove: true,
    });
    expect(evaluateAccountBalanceAlert(BigInt(500_00), BigInt(1_000_00), null)).toEqual({
      shouldFire: false,
      isAbove: false,
    });
  });

  it("fires when crossing from below to above", () => {
    expect(evaluateAccountBalanceAlert(BigInt(1_100_00), BigInt(1_000_00), false)).toEqual({
      shouldFire: true,
      isAbove: true,
    });
  });

  it("fires when crossing from above to below", () => {
    expect(evaluateAccountBalanceAlert(BigInt(900_00), BigInt(1_000_00), true)).toEqual({
      shouldFire: true,
      isAbove: false,
    });
  });

  it("does not fire when staying on the same side", () => {
    expect(evaluateAccountBalanceAlert(BigInt(1_500_00), BigInt(1_000_00), true)).toEqual({
      shouldFire: false,
      isAbove: true,
    });
    expect(evaluateAccountBalanceAlert(BigInt(500_00), BigInt(1_000_00), false)).toEqual({
      shouldFire: false,
      isAbove: false,
    });
  });
});

describe("evaluateBudgetOverrunAlert", () => {
  it("does not fire when under or at budget", () => {
    expect(evaluateBudgetOverrunAlert(BigInt(50_00), BigInt(100_00), "2026-08", null)).toEqual({
      shouldFire: false,
    });
    expect(evaluateBudgetOverrunAlert(BigInt(100_00), BigInt(100_00), "2026-08", null)).toEqual({
      shouldFire: false,
    });
  });

  it("fires the first time it goes over budget in a period", () => {
    expect(evaluateBudgetOverrunAlert(BigInt(150_00), BigInt(100_00), "2026-08", null)).toEqual({
      shouldFire: true,
    });
  });

  it("does not re-fire within the same period once already fired", () => {
    expect(evaluateBudgetOverrunAlert(BigInt(200_00), BigInt(100_00), "2026-08", "2026-08")).toEqual({
      shouldFire: false,
    });
  });

  it("re-arms in a new period even if it fired in the previous one", () => {
    expect(evaluateBudgetOverrunAlert(BigInt(150_00), BigInt(100_00), "2026-09", "2026-08")).toEqual({
      shouldFire: true,
    });
  });
});

describe("holdingMarketValueCents", () => {
  it("multiplies quantity by lastPriceCents", () => {
    expect(holdingMarketValueCents({ quantity: new Decimal(10), lastPriceCents: BigInt(150_00) })).toBe(BigInt(1_500_00));
  });

  it("rounds fractional quantities to the nearest cent", () => {
    expect(holdingMarketValueCents({ quantity: new Decimal("2.5"), lastPriceCents: BigInt(100_00) })).toBe(BigInt(250_00));
  });
});

describe("computeUnrealizedGain", () => {
  it("sums gain and cost basis across holdings, skipping unknown cost basis", () => {
    const holdings = [
      { quantity: new Decimal(10), lastPriceCents: BigInt(150_00), costBasisCents: BigInt(1_000_00) }, // value 1500, gain +500
      { quantity: new Decimal(5), lastPriceCents: BigInt(20_00), costBasisCents: BigInt(150_00) }, // value 100, gain -50
      { quantity: new Decimal(1), lastPriceCents: BigInt(50_00), costBasisCents: null }, // unknown cost basis, skipped entirely
    ];
    expect(computeUnrealizedGain(holdings)).toEqual({
      gainCents: BigInt(450_00),
      gainPct: (450_00 / 1_150_00) * 100,
    });
  });

  it("returns a zero gain and null percentage for an empty holdings list", () => {
    expect(computeUnrealizedGain([])).toEqual({ gainCents: BigInt(0), gainPct: null });
  });

  it("returns null percentage when every considered holding has unknown cost basis", () => {
    const holdings = [{ quantity: new Decimal(1), lastPriceCents: BigInt(100_00), costBasisCents: null }];
    expect(computeUnrealizedGain(holdings)).toEqual({ gainCents: BigInt(0), gainPct: null });
  });
});

describe("evaluatePercentAlert", () => {
  it("never fires on the first evaluation (wasAbove=null), just records the baseline", () => {
    expect(evaluatePercentAlert(25, 20, null)).toEqual({ shouldFire: false, isAbove: true });
    expect(evaluatePercentAlert(15, 20, null)).toEqual({ shouldFire: false, isAbove: false });
  });

  it("fires when crossing from below to above", () => {
    expect(evaluatePercentAlert(21, 20, false)).toEqual({ shouldFire: true, isAbove: true });
  });

  it("fires when crossing from above to below", () => {
    expect(evaluatePercentAlert(19, 20, true)).toEqual({ shouldFire: true, isAbove: false });
  });

  it("does not fire when staying on the same side", () => {
    expect(evaluatePercentAlert(30, 20, true)).toEqual({ shouldFire: false, isAbove: true });
  });
});
