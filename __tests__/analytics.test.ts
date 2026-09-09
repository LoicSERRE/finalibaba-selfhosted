import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import {
  computeAnalytics,
  type AnalyticsAccount,
  type AnalyticsInput,
} from "@/lib/domain/analytics";

const NOW = new Date("2026-07-28T12:00:00.000Z");

const BASE_SETTINGS: AnalyticsInput["settings"] = {
  salaryNetCents: BigInt(0),
  monthlyExpensesCents: BigInt(0),
  monthlySavedCents: BigInt(0),
  taxRatePea: 0.172,
  taxRateCto: 0.314,
};

function account(overrides: Partial<AnalyticsAccount>): AnalyticsAccount {
  return {
    id: "acc-1",
    name: "Compte",
    type: "CHECKING",
    investmentSubtype: null,
    investmentStartDate: null,
    taxTreatment: "TAXABLE",
    taxRatePct: null,
    dividendsAlreadyNet: false,
    interestRatePct: null,
    manualValueCents: null,
    liabilityCents: null,
    syncId: null,
    loanAmountCents: null,
    loanTaeg: null,
    loanDurationMonths: null,
    loanDeferralMonths: null,
    loanStartDate: null,
    institution: null,
    holdings: [],
    history: [],
    ...overrides,
  };
}

function baseInput(overrides: Partial<AnalyticsInput>): AnalyticsInput {
  return {
    accounts: [],
    allBalances: [],
    settings: BASE_SETTINGS,
    goals: [],
    yfData: {},
    incomeEventsYtd: [],
    msciWorldHistory: [],
    sp500History: [],
    cac40History: [],
    intlLocale: "fr-FR",
    now: NOW,
    ...overrides,
  };
}

describe("computeAnalytics", () => {
  it("returns hasData: false and all-zero totals for an empty portfolio", () => {
    const result = computeAnalytics(baseInput({}));

    expect(result.hasData).toBe(false);
    expect(result.netWorth).toBe(BigInt(0));
    expect(result.grossAssets).toBe(BigInt(0));
    expect(result.totalLiabilities).toBe(BigInt(0));
    expect(result.investPerfRows).toEqual([]);
    expect(result.allocationSlices).toEqual([]);
  });

  it("aggregates gross assets, liabilities and net worth across account types", () => {
    const input = baseInput({
      accounts: [
        account({
          id: "checking",
          type: "CHECKING",
          history: [{ balanceCents: BigInt(500_00) }],
        }),
        account({
          id: "real-estate",
          type: "REAL_ESTATE",
          manualValueCents: BigInt(300_000_00),
          liabilityCents: BigInt(200_000_00),
        }),
        account({
          id: "loan",
          type: "LOAN",
          loanAmountCents: BigInt(50_000_00),
          loanTaeg: 3,
          loanDurationMonths: 240,
          loanDeferralMonths: 0,
          loanStartDate: new Date("2026-01-01T00:00:00.000Z"),
        }),
      ],
    });

    const result = computeAnalytics(input);

    expect(result.hasData).toBe(true);
    // grossAssets = checking (500) + real estate (300_000)
    expect(result.grossAssets).toBe(BigInt(300_500_00));
    // totalLiabilities = real estate mortgage (200_000) + loan's own remaining capital
    // (< loanAmountCents since a few months have elapsed since loanStartDate)
    expect(result.totalLiabilities).toBeGreaterThan(BigInt(200_000_00));
    expect(result.totalLiabilities).toBeLessThan(BigInt(250_000_00));
    expect(result.netWorth).toBe(result.grossAssets - result.totalLiabilities);
  });

  it("respects per-account tax treatment: EXEMPT accounts are never taxed, TAXABLE ones are", () => {
    const holding = {
      ticker: "US0000000000",
      name: "Test Stock",
      quantity: new Decimal(10),
      lastPriceCents: BigInt(200_00), // value = 2000€
      costBasisCents: BigInt(1000_00), // gain = 1000€
    };

    const exempt = computeAnalytics(
      baseInput({
        accounts: [
          account({
            id: "isa",
            type: "INVESTMENT",
            taxTreatment: "EXEMPT",
            taxRatePct: null,
            interestRatePct: null,
            holdings: [holding],
          }),
        ],
      })
    );
    expect(exempt.investPerfRows[0].tax).toBe(BigInt(0));
    expect(exempt.totalLatentTax).toBe(BigInt(0));

    const taxable = computeAnalytics(
      baseInput({
        accounts: [
          account({
            id: "cto",
            type: "INVESTMENT",
            taxTreatment: "TAXABLE",
            taxRatePct: 0.3,
            interestRatePct: null, // 30%
            holdings: [holding],
          }),
        ],
      })
    );
    expect(taxable.investPerfRows[0].tax).toBe(BigInt(Math.round(1000_00 * 0.3)));
    expect(taxable.totalLatentTax).toBe(BigInt(Math.round(1000_00 * 0.3)));
  });

  it("computes per-row CAGR from investmentStartDate using the injected `now`, not the real clock", () => {
    const twoYearsAgo = new Date(NOW.getTime() - 2 * 365.25 * 86_400_000);
    const input = baseInput({
      accounts: [
        account({
          id: "cto",
          type: "INVESTMENT",
          taxTreatment: "TAXABLE",
          taxRatePct: 0,
          interestRatePct: null,
          investmentStartDate: twoYearsAgo,
          holdings: [
            {
              ticker: "US0000000000",
              name: null,
              quantity: new Decimal(1),
              lastPriceCents: BigInt(121_00), // value 121, cost 100 -> x1.21 over 2y = 10%/yr
              costBasisCents: BigInt(100_00),
            },
          ],
        }),
      ],
    });

    const result = computeAnalytics(input);

    expect(result.investAllHaveDates).toBe(true);
    expect(result.investCAGR).not.toBeNull();
    expect(result.investCAGR!).toBeCloseTo(10, 0);
    expect(result.investPerfRows[0].cagr).not.toBeNull();
    expect(result.investPerfRows[0].cagr!).toBeCloseTo(10, 0);
  });

  it("compares portfolio CAGR against benchmark indices over the same lookback window", () => {
    const oneYearAgo = new Date(NOW.getTime() - 365.25 * 86_400_000);
    const input = baseInput({
      accounts: [
        account({
          id: "cto",
          type: "INVESTMENT",
          taxTreatment: "TAXABLE",
          taxRatePct: 0,
          interestRatePct: null,
          investmentStartDate: oneYearAgo,
          holdings: [
            {
              ticker: "US0000000000",
              name: null,
              quantity: new Decimal(1),
              lastPriceCents: BigInt(110_00), // +10% over 1 year
              costBasisCents: BigInt(100_00),
            },
          ],
        }),
      ],
      // Benchmark index up only 5% over the same window -> portfolio should beat it
      msciWorldHistory: [
        { date: oneYearAgo, close: 100 },
        { date: NOW, close: 105 },
      ],
    });

    const result = computeAnalytics(input);

    expect(result.benchmarkCAGRs).not.toBeNull();
    expect(result.benchmarkCAGRs!.msciWorld).not.toBeNull();
    expect(result.benchmarkCAGRs!.msciWorld!).toBeCloseTo(5, 0);
    expect(result.investCAGR!).toBeGreaterThan(result.benchmarkCAGRs!.msciWorld!);
  });

  it("prioritizes declared monthly savings over the month-over-month delta for savings rate", () => {
    const input = baseInput({
      settings: {
        ...BASE_SETTINGS,
        salaryNetCents: BigInt(3000_00),
        monthlySavedCents: BigInt(900_00), // 30% declared
      },
      accounts: [account({ history: [{ balanceCents: BigInt(1000_00) }] })],
    });

    const result = computeAnalytics(input);

    expect(result.hasDeclaredSavings).toBe(true);
    expect(result.savingsRate).toBeCloseTo(30, 5);
  });

  it("falls back to the month-over-month net worth delta for savings rate when no monthly amount is declared", () => {
    const input = baseInput({
      settings: {
        ...BASE_SETTINGS,
        salaryNetCents: BigInt(3000_00),
        monthlySavedCents: BigInt(0), // no declared amount -> falls back to the MOM delta
      },
      accounts: [account({ id: "acc-1", history: [{ balanceCents: BigInt(1200_00) }] })],
      allBalances: [
        { accountId: "acc-1", recordedAt: new Date("2026-06-15T12:00:00.000Z"), balanceCents: BigInt(1000_00) },
        { accountId: "acc-1", recordedAt: new Date("2026-07-15T12:00:00.000Z"), balanceCents: BigInt(1200_00) },
      ],
    });

    const result = computeAnalytics(input);

    expect(result.hasDeclaredSavings).toBe(false);
    // momDelta = 1200€ - 1000€ = 200€
    expect(result.savingsRate).toBeCloseTo((200_00 / 3000_00) * 100, 5);
  });

  it("flags a dividend calendar row as isSoon only within a 30-day window and never both isPast and isSoon", () => {
    const soonDate = new Date(NOW.getTime() + 10 * 86_400_000);
    const input = baseInput({
      accounts: [
        account({
          id: "cto",
          type: "INVESTMENT",
          taxTreatment: "TAXABLE",
          taxRatePct: 0.3,
          interestRatePct: null,
          holdings: [
            {
              ticker: "FR0000120073", // Air Liquide - has a DIVIDEND_YIELDS fallback rate
              name: "Air Liquide",
              quantity: new Decimal(10),
              lastPriceCents: BigInt(100_00),
              costBasisCents: BigInt(80_00),
            },
          ],
        }),
      ],
      yfData: {
        "AI.PA": { exDividendDate: soonDate, annualYield: 0.02, annualRatePerShare: 2.5 },
      },
    });

    const result = computeAnalytics(input);

    expect(result.dividendCalendar).toHaveLength(1);
    const row = result.dividendCalendar[0];
    expect(row.isSoon).toBe(true);
    expect(row.isPast).toBe(false);
    expect(row.daysLeft).toBe(10);
  });

  it("skips the tax deduction entirely for an account whose broker already withholds everything", () => {
    const input = baseInput({
      accounts: [
        account({
          id: "tr-cto",
          type: "INVESTMENT",
          taxTreatment: "TAXABLE",
          taxRatePct: 0.314,
          dividendsAlreadyNet: true,
          interestRatePct: null,
          holdings: [
            {
              ticker: "FR0000120073",
              name: "Air Liquide",
              quantity: new Decimal(10),
              lastPriceCents: BigInt(100_00),
              costBasisCents: BigInt(80_00),
            },
          ],
        }),
      ],
      yfData: {
        "AI.PA": { exDividendDate: null, annualYield: 0.02, annualRatePerShare: 2.5 },
      },
    });

    const result = computeAnalytics(input);

    expect(result.dividendCalendar).toHaveLength(1);
    const row = result.dividendCalendar[0];
    expect(row.alreadyNet).toBe(true);
    expect(row.taxRate).toBe(0);
    // Net must equal gross - nothing left for this app to deduct.
    expect(row.annualNetCents).toBe(row.annualEstCents);
    expect(result.annualDividendsNetCents).toBe(result.annualDividendsCents);
  });

  it("still applies the normal FR PFU deduction when dividendsAlreadyNet is false (the default)", () => {
    const input = baseInput({
      accounts: [
        account({
          id: "cto",
          type: "INVESTMENT",
          taxTreatment: "TAXABLE",
          taxRatePct: 0.314,
          dividendsAlreadyNet: false,
          interestRatePct: null,
          holdings: [
            {
              ticker: "FR0000120073",
              name: "Air Liquide",
              quantity: new Decimal(10),
              lastPriceCents: BigInt(100_00),
              costBasisCents: BigInt(80_00),
            },
          ],
        }),
      ],
      yfData: {
        "AI.PA": { exDividendDate: null, annualYield: 0.02, annualRatePerShare: 2.5 },
      },
    });

    const result = computeAnalytics(input);

    const row = result.dividendCalendar[0];
    expect(row.alreadyNet).toBe(false);
    expect(row.taxRate).toBeCloseTo(0.314, 5); // FR_PFU_TOTAL_RATE
    expect(row.annualNetCents).toBeLessThan(row.annualEstCents);
  });
});

describe("computeAnalytics - weighted average savings rate", () => {
  it("weights by balance, not a plain average across accounts", () => {
    // 15,000€ at 1.5% + 5,000€ at 3.0% - a plain average would be 2.25%,
    // but the bigger balance should dominate: weighted = 1.875%.
    const input = baseInput({
      accounts: [
        account({ id: "livret-a", type: "SAVINGS", interestRatePct: 0.015, history: [{ balanceCents: BigInt(15_000_00) }] }),
        account({ id: "ldds", type: "SAVINGS", interestRatePct: 0.03, history: [{ balanceCents: BigInt(5_000_00) }] }),
      ],
    });

    const result = computeAnalytics(input);

    expect(result.weightedSavingsRatePct).toBeCloseTo(0.01875, 6);
  });

  it("excludes an account with no rate set, rather than treating it as 0%", () => {
    const input = baseInput({
      accounts: [
        account({ id: "livret-a", type: "SAVINGS", interestRatePct: 0.015, history: [{ balanceCents: BigInt(10_000_00) }] }),
        account({ id: "unknown", type: "SAVINGS", interestRatePct: null, history: [{ balanceCents: BigInt(50_000_00) }] }),
      ],
    });

    const result = computeAnalytics(input);

    // If the unknown-rate account were wrongly averaged in at 0%, this would
    // be nowhere near 1.5% - it must equal the one known-rate account alone.
    expect(result.weightedSavingsRatePct).toBeCloseTo(0.015, 6);
  });

  it("is null when no SAVINGS account has a known rate", () => {
    const input = baseInput({
      accounts: [account({ id: "unknown", type: "SAVINGS", interestRatePct: null, history: [{ balanceCents: BigInt(1_000_00) }] })],
    });

    const result = computeAnalytics(input);

    expect(result.weightedSavingsRatePct).toBeNull();
  });

  it("includes a genuine 0% account in the weighting, unlike a null one", () => {
    const input = baseInput({
      accounts: [
        account({ id: "livret-a", type: "SAVINGS", interestRatePct: 0.015, history: [{ balanceCents: BigInt(10_000_00) }] }),
        account({ id: "zero-rate", type: "SAVINGS", interestRatePct: 0, history: [{ balanceCents: BigInt(10_000_00) }] }),
      ],
    });

    const result = computeAnalytics(input);

    // Equal balances, one at 1.5% and one at 0% -> average is 0.75%.
    expect(result.weightedSavingsRatePct).toBeCloseTo(0.0075, 6);
  });
});

describe("computeAnalytics - year-end savings interest projection", () => {
  it("wires estimateYearEndInterestCents through for every SAVINGS account with a known rate", () => {
    const input = baseInput({
      accounts: [
        account({ id: "livret-a", type: "SAVINGS", interestRatePct: 0.015, history: [{ balanceCents: BigInt(10_000_00) }] }),
        account({ id: "cto", type: "INVESTMENT", interestRatePct: null, history: [] }), // must be ignored - not SAVINGS
      ],
      allBalances: [
        { accountId: "livret-a", recordedAt: new Date("2025-01-01T00:00:00.000Z"), balanceCents: BigInt(10_000_00) },
      ],
    });

    const result = computeAnalytics(input);

    // Constant 10,000€ all year at 1.5% -> exactly 150€, same closed-form
    // check as the pure function's own test.
    expect(result.estimatedYearEndSavingsInterestCents).toBe(BigInt(150_00));
  });

  it("is 0 when no SAVINGS account has a positive rate", () => {
    const input = baseInput({
      accounts: [account({ id: "livret-a", type: "SAVINGS", interestRatePct: null, history: [{ balanceCents: BigInt(10_000_00) }] })],
    });

    expect(computeAnalytics(input).estimatedYearEndSavingsInterestCents).toBe(BigInt(0));
  });

  it("also returns a history series showing how the estimate has moved through the year", () => {
    const input = baseInput({
      accounts: [account({ id: "livret-a", type: "SAVINGS", interestRatePct: 0.015, history: [{ balanceCents: BigInt(10_000_00) }] })],
      allBalances: [
        { accountId: "livret-a", recordedAt: new Date("2025-01-01T00:00:00.000Z"), balanceCents: BigInt(10_000_00) },
      ],
    });

    const result = computeAnalytics(input);

    expect(result.estimatedYearEndInterestHistory.length).toBeGreaterThan(0);
    // Every point is dated at or before NOW (2026-07-28) and carries a
    // non-negative estimate - a constant balance all year means every
    // point should equal the same final 150€ figure.
    for (const point of result.estimatedYearEndInterestHistory) {
      expect(new Date(point.isoDate).getTime()).toBeLessThanOrEqual(NOW.getTime());
      expect(point.estimatedCents).toBe(150_00);
    }
  });

  it("history series is empty when no SAVINGS account has any balance history yet", () => {
    const input = baseInput({
      accounts: [account({ id: "livret-a", type: "SAVINGS", interestRatePct: 0.015, history: [{ balanceCents: BigInt(10_000_00) }] })],
      allBalances: [],
    });

    expect(computeAnalytics(input).estimatedYearEndInterestHistory).toEqual([]);
  });
});

describe("computeAnalytics - goals (v1.14)", () => {
  it("returns an empty goals array when no goal is configured", () => {
    const result = computeAnalytics(baseInput({}));
    expect(result.goals).toEqual([]);
  });

  it("a net-worth-tracking goal (accountId: null) tracks total net worth", () => {
    const input = baseInput({
      accounts: [
        account({ id: "checking", type: "CHECKING", history: [{ balanceCents: BigInt(10_000_00) }] }),
      ],
      goals: [{ id: "goal-1", name: "Patrimoine", targetCents: BigInt(20_000_00), targetDate: null, accountId: null }],
    });

    const result = computeAnalytics(input);

    expect(result.goals).toHaveLength(1);
    expect(result.goals[0].currentCents).toBe(result.netWorth);
    expect(result.goals[0].currentCents).toBe(BigInt(10_000_00));
    expect(result.goals[0].pct).toBe(50);
    expect(result.goals[0].accountName).toBeNull();
  });

  it("an account-linked goal tracks that account's own current value, not net worth", () => {
    const input = baseInput({
      accounts: [
        account({ id: "checking", name: "Compte courant", type: "CHECKING", history: [{ balanceCents: BigInt(1_000_00) }] }),
        account({ id: "savings", name: "Livret A", type: "SAVINGS", history: [{ balanceCents: BigInt(4_000_00) }] }),
      ],
      goals: [{ id: "goal-1", name: "Fonds d'urgence", targetCents: BigInt(8_000_00), targetDate: null, accountId: "savings" }],
    });

    const result = computeAnalytics(input);

    expect(result.goals[0].currentCents).toBe(BigInt(4_000_00));
    expect(result.goals[0].currentCents).not.toBe(result.netWorth);
    expect(result.goals[0].pct).toBe(50);
    expect(result.goals[0].accountName).toBe("Livret A");
  });
});
