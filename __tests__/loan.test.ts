import { describe, expect, it } from "vitest";
import {
  calcCurrentCapital,
  calcMonthlyPayments,
  calcLoanStats,
  hasLoanParams,
  type LoanParams,
} from "@/lib/loan";

describe("calcCurrentCapital", () => {
  it("returns the full amount before the loan starts", () => {
    const params: LoanParams = {
      loanAmountCents: BigInt(1_200_000),
      loanTaeg: 3,
      loanDurationMonths: 120,
      loanDeferralMonths: 0,
      loanStartDate: new Date("2026-01-01"),
    };
    expect(calcCurrentCapital(params, new Date("2025-06-01"))).toBe(BigInt(1_200_000));
  });

  it("returns 0 once the full duration has elapsed", () => {
    const params: LoanParams = {
      loanAmountCents: BigInt(1_200_000),
      loanTaeg: 3,
      loanDurationMonths: 120,
      loanDeferralMonths: 0,
      loanStartDate: new Date("2020-01-01"),
    };
    expect(calcCurrentCapital(params, new Date("2030-01-01"))).toBe(BigInt(0));
    expect(calcCurrentCapital(params, new Date("2035-01-01"))).toBe(BigInt(0));
  });

  it("leaves the capital unchanged throughout the deferral period (interest-only)", () => {
    const params: LoanParams = {
      loanAmountCents: BigInt(1_200_000),
      loanTaeg: 3,
      loanDurationMonths: 120,
      loanDeferralMonths: 12,
      loanStartDate: new Date("2020-01-01"),
    };
    expect(calcCurrentCapital(params, new Date("2020-06-01"))).toBe(BigInt(1_200_000));
    // Exactly at the deferral boundary - still untouched (elapsed <= D)
    expect(calcCurrentCapital(params, new Date("2021-01-01"))).toBe(BigInt(1_200_000));
  });

  it("amortizes linearly at 0% TAEG", () => {
    const params: LoanParams = {
      loanAmountCents: BigInt(1_200_000), // 12 000€
      loanTaeg: 0,
      loanDurationMonths: 120,
      loanDeferralMonths: 0,
      loanStartDate: new Date("2020-01-01"),
    };
    // Halfway through a 0% loan -> exactly half the capital remains
    expect(calcCurrentCapital(params, new Date("2025-01-01"))).toBe(BigInt(600_000));
  });

  it("satisfies the amortization identity month over month at a real interest rate", () => {
    // remaining(m+1) = remaining(m) * (1+r) - monthlyPayment, the textbook
    // amortization recurrence - verifying this independently of the formula
    // used inside calcCurrentCapital itself is what actually catches a typo
    // in the exponent/sign rather than just re-asserting the same formula.
    const params: LoanParams = {
      loanAmountCents: BigInt(20_000_000), // 200 000€
      loanTaeg: 3.5,
      loanDurationMonths: 240,
      loanDeferralMonths: 0,
      loanStartDate: new Date("2020-01-01"),
    };
    const r = 3.5 / 100 / 12;
    const { amortPaymentCents } = calcMonthlyPayments(params);

    for (const month of [1, 12, 60, 239]) {
      const before = calcCurrentCapital(params, new Date(2020, month - 1, 1));
      const after = calcCurrentCapital(params, new Date(2020, month, 1));
      const expected = Number(before) * (1 + r) - Number(amortPaymentCents);
      // Two independent roundings (before/after computed via Math.round in
      // cents) mean this can be off by a cent or two, not more.
      expect(Number(after)).toBeCloseTo(expected, -1);
    }
  });

  it("strictly decreases month over month while amortizing", () => {
    const params: LoanParams = {
      loanAmountCents: BigInt(20_000_000),
      loanTaeg: 4,
      loanDurationMonths: 180,
      loanDeferralMonths: 0,
      loanStartDate: new Date("2020-01-01"),
    };
    let prev = calcCurrentCapital(params, new Date(2020, 0, 1));
    for (let m = 1; m <= 179; m++) {
      const curr = calcCurrentCapital(params, new Date(2020, m, 1));
      expect(curr).toBeLessThan(prev);
      prev = curr;
    }
  });
});

describe("calcMonthlyPayments", () => {
  it("charges nothing for the deferral period and a plain division for amortization at 0% TAEG", () => {
    const params: LoanParams = {
      loanAmountCents: BigInt(1_200_000), // 12 000€
      loanTaeg: 0,
      loanDurationMonths: 120,
      loanDeferralMonths: 0,
      loanStartDate: new Date("2020-01-01"),
    };
    const { deferralPaymentCents, amortPaymentCents } = calcMonthlyPayments(params);
    expect(deferralPaymentCents).toBe(BigInt(0));
    expect(amortPaymentCents).toBe(BigInt(10_000)); // 12 000 / 120 = 100€/month
  });

  it("computes a positive interest-only payment during deferral at a real rate", () => {
    const params: LoanParams = {
      loanAmountCents: BigInt(20_000_000), // 200 000€
      loanTaeg: 3,
      loanDurationMonths: 240,
      loanDeferralMonths: 12,
      loanStartDate: new Date("2020-01-01"),
    };
    const { deferralPaymentCents } = calcMonthlyPayments(params);
    // P * r = 200 000 * 0.0025 = 500€/month interest-only
    expect(deferralPaymentCents).toBe(BigInt(50_000));
  });

  it("returns a 0 amortization payment when the deferral consumes the entire duration", () => {
    const params: LoanParams = {
      loanAmountCents: BigInt(1_000_000),
      loanTaeg: 2,
      loanDurationMonths: 24,
      loanDeferralMonths: 24,
      loanStartDate: new Date("2020-01-01"),
    };
    expect(calcMonthlyPayments(params).amortPaymentCents).toBe(BigInt(0));
  });
});

describe("calcLoanStats", () => {
  const params: LoanParams = {
    loanAmountCents: BigInt(20_000_000),
    loanTaeg: 3,
    loanDurationMonths: 240,
    loanDeferralMonths: 12,
    loanStartDate: new Date("2020-01-01"),
  };

  it("reports status 'deferral' before the deferral period ends", () => {
    const stats = calcLoanStats(params, BigInt(0), new Date("2020-06-01"));
    expect(stats.status).toBe("deferral");
    expect(stats.currentMonthlyBaseCents).toBe(stats.deferralPaymentCents);
  });

  it("reports status 'amortizing' between deferral end and full duration", () => {
    const stats = calcLoanStats(params, BigInt(0), new Date("2025-01-01"));
    expect(stats.status).toBe("amortizing");
    expect(stats.currentMonthlyBaseCents).toBe(stats.amortPaymentCents);
  });

  it("reports status 'finished' and a 0 monthly payment once the duration is over", () => {
    const stats = calcLoanStats(params, BigInt(0), new Date("2041-01-01"));
    expect(stats.status).toBe("finished");
    expect(stats.currentMonthlyBaseCents).toBe(BigInt(0));
    expect(stats.currentCapitalCents).toBe(BigInt(0));
  });

  it("clamps progressPct to [0, 100] outside the loan's actual timeline", () => {
    const before = calcLoanStats(params, BigInt(0), new Date("2019-01-01"));
    expect(before.progressPct).toBe(0);
    const after = calcLoanStats(params, BigInt(0), new Date("2050-01-01"));
    expect(after.progressPct).toBe(100);
  });

  it("computes endDate as loanStartDate + N months", () => {
    const stats = calcLoanStats(params, BigInt(0), new Date("2025-01-01"));
    expect(stats.endDate.getFullYear()).toBe(2040);
    expect(stats.endDate.getMonth()).toBe(0); // January
  });

  it("adds insurance on top of the base payment for currentMonthlyTotalCents and totalCostCents", () => {
    const insurance = BigInt(2_000); // 20€/month
    const withInsurance = calcLoanStats(params, insurance, new Date("2025-01-01"));
    const withoutInsurance = calcLoanStats(params, BigInt(0), new Date("2025-01-01"));

    expect(withInsurance.currentMonthlyTotalCents).toBe(withoutInsurance.currentMonthlyBaseCents + insurance);
    expect(withInsurance.totalCostCents).toBe(
      withoutInsurance.totalInterestCents + insurance * BigInt(params.loanDurationMonths)
    );
  });
});

describe("hasLoanParams", () => {
  it("is true only when all four required fields are present", () => {
    expect(
      hasLoanParams({
        loanAmountCents: BigInt(1000),
        loanTaeg: 3,
        loanDurationMonths: 12,
        loanStartDate: new Date(),
      })
    ).toBe(true);
  });

  it.each([
    ["loanAmountCents", { loanAmountCents: null, loanTaeg: 3, loanDurationMonths: 12, loanStartDate: new Date() }],
    ["loanTaeg", { loanAmountCents: BigInt(1000), loanTaeg: null, loanDurationMonths: 12, loanStartDate: new Date() }],
    ["loanDurationMonths", { loanAmountCents: BigInt(1000), loanTaeg: 3, loanDurationMonths: null, loanStartDate: new Date() }],
    ["loanStartDate", { loanAmountCents: BigInt(1000), loanTaeg: 3, loanDurationMonths: 12, loanStartDate: null }],
  ])("is false when %s is missing", (_field, account) => {
    expect(hasLoanParams(account)).toBe(false);
  });
});
