import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import {
  computeFiatRow,
  computeInvestRow,
  computeRealEstateRow,
  computeAutomobileRow,
  computeLoanRow,
  computeTabTotals,
  toFiatExport,
  toInvestExport,
  toLoanExport,
  type FiatAccountInput,
  type InvestAccountInput,
  type LoanInput,
} from "@/lib/accounts-page";

const NOW = new Date("2026-07-28T12:00:00.000Z");

describe("computeFiatRow", () => {
  it("computes delta against the previous history entry and reverses sparkValues to chronological order", () => {
    const account: FiatAccountInput = {
      id: "1",
      name: "Compte",
      type: "CHECKING",
      institution: { name: "LCL", logoUrl: null },
      history: [{ balanceCents: BigInt(1200_00) }, { balanceCents: BigInt(1000_00) }, { balanceCents: BigInt(900_00) }],
    };
    const row = computeFiatRow(account);
    expect(row.currentCents).toBe(BigInt(1200_00));
    expect(row.deltaCents).toBe(BigInt(200_00));
    // history is most-recent-first; sparkValues must be chronological (oldest first)
    expect(row.sparkValues).toEqual([900_00, 1000_00, 1200_00]);
  });

  it("has zero delta when there's only one history entry", () => {
    const account: FiatAccountInput = {
      id: "1",
      name: "Compte",
      type: "CHECKING",
      institution: null,
      history: [{ balanceCents: BigInt(500_00) }],
    };
    const row = computeFiatRow(account);
    expect(row.deltaCents).toBe(BigInt(0));
    expect(row.institutionName).toBeNull();
  });
});

describe("computeInvestRow", () => {
  const holding = {
    id: "h1",
    ticker: "US0000000000",
    name: "Test Stock",
    quantity: new Decimal(10),
    lastPriceCents: BigInt(200_00), // value 2000
    costBasisCents: BigInt(1000_00), // gain 1000
    currency: "EUR",
    targetPct: 0.3,
  };

  it("computes account-level gain/tax by summing holdings with a known cost basis", () => {
    const account: InvestAccountInput = {
      id: "acc",
      name: "CTO",
      type: "INVESTMENT",
      investmentSubtype: "CTO",
      taxTreatment: "TAXABLE",
      taxRatePct: 0.3,
      institution: { name: "Trade Republic", logoUrl: null },
      holdings: [holding],
    };
    const row = computeInvestRow(account);
    expect(row.totalCents).toBe(BigInt(2000_00));
    expect(row.hasCostBasis).toBe(true);
    expect(row.gainCents).toBe(BigInt(1000_00));
    expect(row.taxCents).toBe(BigInt(300_00));
    expect(row.hasTaxRate).toBe(true);
    expect(row.holdings[0].targetPct).toBe(30); // 0.3 ratio -> 30 display percent
  });

  it("never taxes an EXEMPT account even with a cost basis and a gain", () => {
    const account: InvestAccountInput = {
      id: "isa",
      name: "ISA",
      type: "INVESTMENT",
      investmentSubtype: null,
      taxTreatment: "EXEMPT",
      taxRatePct: null,
      institution: null,
      holdings: [holding],
    };
    const row = computeInvestRow(account);
    expect(row.gainCents).toBe(BigInt(1000_00));
    expect(row.taxCents).toBe(BigInt(0));
    expect(row.hasTaxRate).toBe(true); // EXEMPT still resolves to a rate (0), just an untaxed one
  });

  it("hides the tax column entirely (hasTaxRate: false) only for TAXABLE with no rate set", () => {
    const account: InvestAccountInput = {
      id: "cto",
      name: "CTO",
      type: "INVESTMENT",
      investmentSubtype: null,
      taxTreatment: "TAXABLE",
      taxRatePct: null,
      institution: null,
      holdings: [holding],
    };
    const row = computeInvestRow(account);
    expect(row.hasTaxRate).toBe(false);
    expect(row.holdings[0].taxCents).toBeNull();
  });

  it("a holding with no cost basis reports null gain/tax without affecting the account total", () => {
    const account: InvestAccountInput = {
      id: "cto",
      name: "CTO",
      type: "INVESTMENT",
      investmentSubtype: null,
      taxTreatment: "TAXABLE",
      taxRatePct: 0.3,
      institution: null,
      holdings: [{ ...holding, costBasisCents: null }],
    };
    const row = computeInvestRow(account);
    expect(row.hasCostBasis).toBe(false);
    expect(row.totalCents).toBe(BigInt(2000_00));
    expect(row.holdings[0].gainCents).toBeNull();
    expect(row.holdings[0].taxCents).toBeNull();
  });
});

describe("computeRealEstateRow / computeAutomobileRow", () => {
  it("computes LTV as liability/value, floored at 0 when value is 0", () => {
    const row = computeRealEstateRow({
      id: "1",
      name: "Appart",
      institution: null,
      manualValueCents: BigInt(300_000_00),
      liabilityCents: BigInt(150_000_00),
    });
    expect(row.ltv).toBe(50);
    expect(row.equityCents).toBe(BigInt(150_000_00));

    const zeroValue = computeRealEstateRow({
      id: "2",
      name: "Appart 2",
      institution: null,
      manualValueCents: null,
      liabilityCents: BigInt(1000_00),
    });
    expect(zeroValue.ltv).toBe(0);
  });

  it("computes automobile depreciation only when a purchase price is set", () => {
    const withPurchase = computeAutomobileRow({
      id: "1",
      name: "Voiture",
      institution: null,
      manualValueCents: BigInt(20_000_00),
      purchasePriceCents: BigInt(25_000_00),
      liabilityCents: null,
      insuranceMonthlyCents: null,
    });
    expect(withPurchase.depreciationCents).toBe(BigInt(-5_000_00));
    expect(withPurchase.depreciationPct).toBe(-20);

    const withoutPurchase = computeAutomobileRow({
      id: "2",
      name: "Voiture 2",
      institution: null,
      manualValueCents: BigInt(20_000_00),
      purchasePriceCents: null,
      liabilityCents: null,
      insuranceMonthlyCents: null,
    });
    expect(withoutPurchase.depreciationCents).toBeNull();
    expect(withoutPurchase.depreciationPct).toBeNull();
  });
});

describe("computeLoanRow", () => {
  it("returns hasParams: false for a loan missing required fields, without throwing", () => {
    const loan: LoanInput = {
      id: "1",
      name: "Prêt incomplet",
      institution: null,
      loanAmountCents: null,
      loanTaeg: null,
      loanDurationMonths: null,
      loanDeferralMonths: null,
      loanStartDate: null,
      insuranceMonthlyCents: null,
      liabilityCents: BigInt(5000_00),
    };
    const row = computeLoanRow(loan, NOW);
    expect(row.hasParams).toBe(false);
  });

  it("computes full loan stats when all params are present", () => {
    const loan: LoanInput = {
      id: "1",
      name: "Prêt auto",
      institution: { name: "LCL", logoUrl: null },
      loanAmountCents: BigInt(12_000_00),
      loanTaeg: 5.9,
      loanDurationMonths: 48,
      loanDeferralMonths: 0,
      loanStartDate: new Date("2024-01-01T00:00:00.000Z"),
      insuranceMonthlyCents: BigInt(10_00),
      liabilityCents: null,
    };
    const row = computeLoanRow(loan, NOW);
    expect(row.hasParams).toBe(true);
    if (row.hasParams) {
      expect(row.stats.currentCapitalCents).toBeGreaterThan(BigInt(0));
      expect(row.stats.currentCapitalCents).toBeLessThan(BigInt(12_000_00));
      expect(row.institutionName).toBe("LCL");
    }
  });
});

describe("computeTabTotals", () => {
  it("sums each tab from its own row set independently", () => {
    const totals = computeTabTotals({
      fiatRows: [computeFiatRow({ id: "1", name: "A", type: "CHECKING", institution: null, history: [{ balanceCents: BigInt(100_00) }] })],
      investRows: [],
      realEstateRows: [],
      automobileRows: [],
      loanTotalCents: BigInt(500_00),
    });
    expect(totals.liquidites).toBe(BigInt(100_00));
    expect(totals.investissements).toBe(BigInt(0));
    expect(totals.credits).toBe(BigInt(500_00));
  });
});

describe("export mappers", () => {
  it("toFiatExport converts BigInt cents to plain numbers and falls back institutionName to an empty string", () => {
    const row = computeFiatRow({ id: "1", name: "A", type: "CHECKING", institution: null, history: [{ balanceCents: BigInt(100_00) }] });
    const exported = toFiatExport(row);
    expect(exported.balanceCents).toBe(100_00);
    expect(exported.institutionName).toBe("");
  });

  it("toInvestExport nulls out gain/tax when the account has no cost basis at all, even though internal gainCents defaults to 0n", () => {
    const row = computeInvestRow({
      id: "acc",
      name: "CTO",
      type: "INVESTMENT",
      investmentSubtype: null,
      taxTreatment: "TAXABLE",
      taxRatePct: 0.3,
      institution: null,
      holdings: [],
    });
    const exported = toInvestExport(row);
    expect(exported.gainCents).toBeNull();
    expect(exported.taxCents).toBeNull();
  });

  it("toLoanExport returns null for a loan missing params instead of throwing", () => {
    const row = computeLoanRow(
      {
        id: "1",
        name: "Incomplet",
        institution: null,
        loanAmountCents: null,
        loanTaeg: null,
        loanDurationMonths: null,
        loanDeferralMonths: null,
        loanStartDate: null,
        insuranceMonthlyCents: null,
        liabilityCents: null,
      },
      NOW
    );
    expect(toLoanExport(row, "fr-FR")).toBeNull();
  });
});
