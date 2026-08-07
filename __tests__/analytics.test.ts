import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import {
  computeAnalytics,
  type AnalyticsAccount,
  type AnalyticsInput,
} from "@/lib/domain/analytics";

const NOW = new Date("2026-07-28T12:00:00.000Z");

const BASE_SETTINGS: AnalyticsInput["settings"] = {
  savingsGoalCents: BigInt(0),
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
            taxRatePct: 0.3, // 30%
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
});
