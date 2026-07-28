import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { computeAccountDetail, type AccountDetailAccount } from "@/lib/account-detail";

const NOW = new Date("2026-07-28T12:00:00.000Z");

function account(overrides: Partial<AccountDetailAccount>): AccountDetailAccount {
  return {
    id: "acc-1",
    name: "Compte",
    type: "CHECKING",
    syncId: null,
    gocardlessAccountId: null,
    investmentSubtype: null,
    investmentStartDate: null,
    taxTreatment: "TAXABLE",
    taxRatePct: null,
    manualValueCents: null,
    liabilityCents: null,
    purchasePriceCents: null,
    insuranceMonthlyCents: null,
    loanAmountCents: null,
    loanTaeg: null,
    loanDurationMonths: null,
    loanDeferralMonths: null,
    loanStartDate: null,
    institution: null,
    holdings: [],
    history: [],
    transactions: [],
    ...overrides,
  };
}

describe("computeAccountDetail - fiat accounts", () => {
  it("takes currentValue from the most recent history entry", () => {
    const result = computeAccountDetail({
      account: account({
        history: [
          { id: "h2", balanceCents: BigInt(1500_00), recordedAt: new Date("2026-07-01") },
          { id: "h1", balanceCents: BigInt(1000_00), recordedAt: new Date("2026-06-01") },
        ],
      }),
      intlLocale: "fr-FR",
      now: NOW,
    });
    expect(result.currentValue).toBe(BigInt(1500_00));
    expect(result.isFiat).toBe(true);
  });

  it("computes latestDelta as the most recent minus the second-most-recent balance", () => {
    const result = computeAccountDetail({
      account: account({
        history: [
          { id: "h2", balanceCents: BigInt(1500_00), recordedAt: new Date("2026-07-01") },
          { id: "h1", balanceCents: BigInt(1000_00), recordedAt: new Date("2026-06-01") },
        ],
      }),
      intlLocale: "fr-FR",
      now: NOW,
    });
    expect(result.latestDelta).toBe(BigInt(500_00));
  });

  it("returns latestDelta null with fewer than 2 history entries", () => {
    const result = computeAccountDetail({
      account: account({ history: [{ id: "h1", balanceCents: BigInt(1000_00), recordedAt: new Date() }] }),
      intlLocale: "fr-FR",
      now: NOW,
    });
    expect(result.latestDelta).toBeNull();
  });

  it("computes per-row deltas in historyRows, oldest entry has a null delta", () => {
    const result = computeAccountDetail({
      account: account({
        history: [
          { id: "h3", balanceCents: BigInt(1500_00), recordedAt: new Date("2026-07-01") },
          { id: "h2", balanceCents: BigInt(1200_00), recordedAt: new Date("2026-06-01") },
          { id: "h1", balanceCents: BigInt(1000_00), recordedAt: new Date("2026-05-01") },
        ],
      }),
      intlLocale: "fr-FR",
      now: NOW,
    });
    expect(result.historyRows[0].delta).toBe(BigInt(300_00)); // 1500 - 1200
    expect(result.historyRows[1].delta).toBe(BigInt(200_00)); // 1200 - 1000
    expect(result.historyRows[2].delta).toBeNull(); // oldest entry, nothing before it
  });
});

describe("computeAccountDetail - investment tax treatment", () => {
  const holding = {
    id: "h1",
    ticker: "US0000000000",
    name: "Test Stock",
    quantity: new Decimal(10),
    lastPriceCents: BigInt(200_00), // value = 2000€
    costBasisCents: BigInt(1000_00), // gain = 1000€
    targetPct: null,
    currency: "EUR",
    nativePriceCents: null,
    nativeCostBasisCents: null,
  };

  it("computes 0 tax for an EXEMPT account regardless of gain", () => {
    const result = computeAccountDetail({
      account: account({ type: "INVESTMENT", taxTreatment: "EXEMPT", holdings: [holding] }),
      intlLocale: "fr-FR",
      now: NOW,
    });
    expect(result.holdingsWithTax[0].taxCents).toBe(BigInt(0));
    expect(result.totalTax).toBe(BigInt(0));
    expect(result.netAfterTax).toBe(result.currentValue); // no tax subtracted
  });

  it("computes tax on the gain at the account's own rate for TAXABLE accounts", () => {
    const result = computeAccountDetail({
      account: account({ type: "INVESTMENT", taxTreatment: "TAXABLE", taxRatePct: 0.3, holdings: [holding] }),
      intlLocale: "fr-FR",
      now: NOW,
    });
    expect(result.holdingsWithTax[0].gainCents).toBe(BigInt(1000_00));
    expect(result.holdingsWithTax[0].taxCents).toBe(BigInt(Math.round(1000_00 * 0.3)));
    expect(result.netAfterTax).toBe(result.currentValue - result.totalTax);
  });

  it("never taxes a loss (per-position and in the netted total)", () => {
    const losingHolding = { ...holding, lastPriceCents: BigInt(50_00) }; // value 500, cost 1000 -> loss
    const result = computeAccountDetail({
      account: account({ type: "INVESTMENT", taxTreatment: "TAXABLE", taxRatePct: 0.3, holdings: [losingHolding] }),
      intlLocale: "fr-FR",
      now: NOW,
    });
    expect(result.holdingsWithTax[0].gainCents).toBe(BigInt(-500_00));
    expect(result.holdingsWithTax[0].taxCents).toBe(BigInt(0));
    expect(result.totalTax).toBe(BigInt(0));
  });

  it("nets gains and losses across holdings before computing the account-level tax", () => {
    const winner = { ...holding, id: "h-win", lastPriceCents: BigInt(300_00) }; // gain +2000
    const loser = { ...holding, id: "h-lose", lastPriceCents: BigInt(50_00) }; // loss -500
    const result = computeAccountDetail({
      account: account({ type: "INVESTMENT", taxTreatment: "TAXABLE", taxRatePct: 0.3, holdings: [winner, loser] }),
      intlLocale: "fr-FR",
      now: NOW,
    });
    // net gain = 2000 - 500 = 1500, taxed at 30%
    expect(result.totalGain).toBe(BigInt(1500_00));
    expect(result.totalTax).toBe(BigInt(Math.round(1500_00 * 0.3)));
  });

  it("leaves gainCents/taxCents null for a holding with no cost basis (unknown P&L)", () => {
    const noCostBasis = { ...holding, costBasisCents: null };
    const result = computeAccountDetail({
      account: account({ type: "INVESTMENT", taxTreatment: "TAXABLE", taxRatePct: 0.3, holdings: [noCostBasis] }),
      intlLocale: "fr-FR",
      now: NOW,
    });
    expect(result.holdingsWithTax[0].gainCents).toBeNull();
    expect(result.holdingsWithTax[0].taxCents).toBeNull();
    expect(result.hasCostBasis).toBe(false);
  });
});

describe("computeAccountDetail - rebalancing", () => {
  it("suggests selling an overweight holding and buying an underweight one", () => {
    const overweight = {
      id: "h-over", ticker: "OVER", name: null, quantity: new Decimal(10),
      lastPriceCents: BigInt(100_00), costBasisCents: null, targetPct: 0.3, // target 30%, actual will be higher
      currency: "EUR", nativePriceCents: null, nativeCostBasisCents: null,
    };
    const underweight = {
      id: "h-under", ticker: "UNDER", name: null, quantity: new Decimal(1),
      lastPriceCents: BigInt(100_00), costBasisCents: null, targetPct: 0.5, // target 50%, actual much lower
      currency: "EUR", nativePriceCents: null, nativeCostBasisCents: null,
    };
    const result = computeAccountDetail({
      account: account({ type: "INVESTMENT", holdings: [overweight, underweight] }),
      intlLocale: "fr-FR",
      now: NOW,
    });
    // total value = 1000 + 100 = 1100. overweight pct = round(1000/1100*100) = 91%, target 30% -> overweight
    // underweight pct = round(100/1100*100) = 9%, target 50% -> underweight
    const overRow = result.rebalancingRows.find((r) => r.ticker === "OVER")!;
    const underRow = result.rebalancingRows.find((r) => r.ticker === "UNDER")!;
    expect(overRow.isOverweight).toBe(true);
    expect(underRow.isOverweight).toBe(false);
  });

  it("excludes holdings with no targetPct from the rebalancing plan", () => {
    const untargeted = {
      id: "h1", ticker: "NOTARGET", name: null, quantity: new Decimal(1),
      lastPriceCents: BigInt(100_00), costBasisCents: null, targetPct: null,
      currency: "EUR", nativePriceCents: null, nativeCostBasisCents: null,
    };
    const result = computeAccountDetail({
      account: account({ type: "INVESTMENT", holdings: [untargeted] }),
      intlLocale: "fr-FR",
      now: NOW,
    });
    expect(result.rebalancingRows).toEqual([]);
  });

  it("hides the suggested-trade amount when drift in points rounds to exactly 0, even if the raw cents drift isn't 0", () => {
    // 3 holdings so percentages round cleanly and one lands 1pt off target
    // in raw terms but 0pt after Math.round - this is the exact case the
    // original inline JSX guarded with `driftPts !== 0`, not just
    // `driftValueCents !== 0`.
    const a = {
      id: "a", ticker: "A", name: null, quantity: new Decimal(1),
      lastPriceCents: BigInt(3900), costBasisCents: null, targetPct: 0.39,
      currency: "EUR", nativePriceCents: null, nativeCostBasisCents: null,
    };
    const b = {
      id: "b", ticker: "B", name: null, quantity: new Decimal(1),
      lastPriceCents: BigInt(6100), costBasisCents: null, targetPct: 0.61,
      currency: "EUR", nativePriceCents: null, nativeCostBasisCents: null,
    };
    const result = computeAccountDetail({
      account: account({ type: "INVESTMENT", holdings: [a, b] }),
      intlLocale: "fr-FR",
      now: NOW,
    });
    const rowA = result.rebalancingRows.find((r) => r.ticker === "A")!;
    expect(rowA.driftPts).toBe(0);
    expect(rowA.showSuggestion).toBe(false);
  });
});

describe("computeAccountDetail - loans", () => {
  it("wires calcLoanStats with the injected `now`, not the real clock", () => {
    const result = computeAccountDetail({
      account: account({
        type: "LOAN",
        loanAmountCents: BigInt(100_000_00),
        loanTaeg: 0,
        loanDurationMonths: 100,
        loanDeferralMonths: 0,
        loanStartDate: new Date("2020-01-01"),
      }),
      intlLocale: "fr-FR",
      now: new Date("2020-01-01"), // exactly at the start
    });
    expect(result.isLoan).toBe(true);
    expect(result.loanStats).not.toBeNull();
    expect(result.loanStats!.currentCapitalCents).toBe(BigInt(100_000_00)); // untouched at month 0
    expect(result.currentValue).toBe(BigInt(100_000_00));
  });

  it("falls back to liabilityCents when the loan params are incomplete", () => {
    const result = computeAccountDetail({
      account: account({ type: "LOAN", liabilityCents: BigInt(5000_00) }), // no loanAmountCents/Taeg/etc
      intlLocale: "fr-FR",
      now: NOW,
    });
    expect(result.loanStats).toBeNull();
    expect(result.currentValue).toBe(BigInt(5000_00));
  });
});

describe("computeAccountDetail - real estate / automobile", () => {
  it("computes equity and LTV from manualValueCents and liabilityCents", () => {
    const result = computeAccountDetail({
      account: account({ type: "REAL_ESTATE", manualValueCents: BigInt(300_000_00), liabilityCents: BigInt(210_000_00) }),
      intlLocale: "fr-FR",
      now: NOW,
    });
    expect(result.equity).toBe(BigInt(90_000_00));
    expect(result.ltv).toBe(70); // 210k / 300k = 70%
  });

  it("returns ltv 0 (not NaN/Infinity) when value is 0", () => {
    const result = computeAccountDetail({
      account: account({ type: "AUTOMOBILE", manualValueCents: BigInt(0), liabilityCents: BigInt(5000_00) }),
      intlLocale: "fr-FR",
      now: NOW,
    });
    expect(result.ltv).toBe(0);
  });
});

describe("computeAccountDetail - CSV import eligibility", () => {
  it("allows CSV import only for unsynced fiat accounts without a GoCardless link", () => {
    const eligible = computeAccountDetail({
      account: account({ type: "CHECKING", syncId: null, gocardlessAccountId: null }),
      intlLocale: "fr-FR",
      now: NOW,
    });
    expect(eligible.canImportCsv).toBe(true);

    const synced = computeAccountDetail({
      account: account({ type: "CHECKING", syncId: "lcl:123" }),
      intlLocale: "fr-FR",
      now: NOW,
    });
    expect(synced.canImportCsv).toBe(false);

    const gocardless = computeAccountDetail({
      account: account({ type: "CHECKING", gocardlessAccountId: "gc-123" }),
      intlLocale: "fr-FR",
      now: NOW,
    });
    expect(gocardless.canImportCsv).toBe(false);

    const investment = computeAccountDetail({
      account: account({ type: "INVESTMENT" }),
      intlLocale: "fr-FR",
      now: NOW,
    });
    expect(investment.canImportCsv).toBe(false);
  });
});
