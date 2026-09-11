import { describe, expect, it } from "vitest";
import { buildMarkdown, type ExportStrings } from "@/lib/utils/accounts-markdown";
import { fmt } from "@/lib/utils/markdown-export";
import type {
  FiatAccountExport,
  InvestAccountExport,
  RealEstateAccountExport,
  AutomobileAccountExport,
  LoanAccountExport,
} from "@/lib/domain/accounts-export";

/**
 * The accounts export document.
 *
 * This function had never been tested, and could not be: it lived inside
 * components/shared/export-accounts-button.tsx, which sonar.coverage.exclusions
 * drops wholesale, so it reported no coverage rather than 0%. v2.10.4 moved it
 * to lib/utils, which is the only reason this file can exist.
 *
 * What it pins is what an export actually gets wrong. Not the currency
 * formatting - Intl owns that - but the builder's own decisions: which
 * sections appear, how many decimals a figure is asked for, and above all
 * what an ABSENT value renders as. This repo has already shipped both halves
 * of that last one: a real 0,46 EUR dividend printed as "0 €" in the tax
 * report while the page beside it showed the cents, and the recurring
 * "an absent value rendered as a legitimate zero" pattern the release audit
 * names in its own right.
 */

const S: ExportStrings = {
  title: "TITLE", cash: "CASH", investments: "INVEST", realEstate: "REALESTATE",
  autos: "AUTOS", loans: "LOANS", balance: "BALANCE", delta: "DELTA", total: "TOTAL",
  gain: "GAIN", tax: "TAX", value: "VALUE", liability: "LIABILITY", equity: "EQUITY",
  purchasePrice: "PURCHASE", currentValue: "CURRENT", netValue: "NETVALUE",
  institution: "INSTITUTION", loanDue: "LOANDUE", colAsset: "ASSET", colIsin: "ISIN",
  colQty: "QTY", colPrice: "PRICE", colValue: "VAL", colPct: "PCT", colGain: "G",
  colTarget: "TGT", amountBorrowed: "BORROWED", remaining: "REMAINING", taeg: "TAEG",
  duration: "DURATION", months: "MONTHS", currentPayment: "PAYMENT", totalCost: "COST",
  projectedEnd: "END", progress: "PROGRESS",
  typeLabels: { CHECKING: "Compte courant", INVESTMENT: "Titres", CRYPTO: "Crypto" },
};

const FIAT: FiatAccountExport = {
  id: "f1", name: "Courant", institutionName: "LCL", type: "CHECKING",
  balanceCents: 123_456, deltaCents: 0,
};

const HOLDING = {
  ticker: "IE00B4L5Y983", name: "iShares Core MSCI World", quantity: "12.5",
  lastPriceCents: 9_876, valueCents: 123_450, pct: 80,
  costBasisCents: 100_000, gainCents: 23_450, gainPct: 23.45,
  taxCents: 7_363, currency: "EUR", targetPct: 60,
};

const INVEST: InvestAccountExport = {
  id: "i1", name: "PEA", institutionName: "Bourso", type: "INVESTMENT",
  investmentSubtype: "PEA", totalCents: 123_450, gainCents: 23_450, taxCents: 7_363,
  holdings: [HOLDING],
};

function build(over: Partial<{
  fiat: FiatAccountExport[]; invest: InvestAccountExport[];
  realEstate: RealEstateAccountExport[]; automobiles: AutomobileAccountExport[];
  loans: LoanAccountExport[];
}> = {}) {
  return buildMarkdown(
    over.fiat ?? [], over.invest ?? [], over.realEstate ?? [],
    over.automobiles ?? [], over.loans ?? [], S
  );
}

describe("section gating", () => {
  it("omits a section entirely rather than printing an empty heading", () => {
    const md = build();
    for (const heading of ["CASH", "INVEST", "REALESTATE", "AUTOS", "LOANS"]) {
      expect(md).not.toContain(`## ${heading}`);
    }
    // The document still exists - a portfolio with nothing in it is a valid
    // export, not an error.
    expect(md).toContain("# TITLE");
  });

  it("prints only the sections that have accounts", () => {
    const md = build({ fiat: [FIAT] });
    expect(md).toContain("## CASH");
    expect(md).not.toContain("## INVEST");
  });
});

describe("an absent value is never rendered as zero", () => {
  it("prints a dash for an unknown holding gain, not 0 EUR", () => {
    const md = build({
      invest: [{ ...INVEST, holdings: [{ ...HOLDING, gainCents: null, gainPct: null }] }],
    });
    const row = md.split("\n").find((l) => l.includes("IE00B4L5Y983"))!;
    expect(row).toContain("| - |");
    expect(row).not.toContain(fmt(0));
  });

  it("prints a dash for an unset rebalancing target, not 0%", () => {
    const md = build({ invest: [{ ...INVEST, holdings: [{ ...HOLDING, targetPct: null }] }] });
    // Asserted on the last cell rather than by searching for "0%": the weight
    // column next to it legitimately reads "80%", which contains it.
    const row = md.split("\n").find((l) => l.includes("IE00B4L5Y983"))!;
    expect(row.endsWith("| - |")).toBe(true);
    expect(build({ invest: [INVEST] }).split("\n").find((l) => l.includes("IE00B4L5Y983"))!.endsWith("| 60% |")).toBe(true);
  });

  it("omits the account gain line entirely when the gain is unknown", () => {
    const md = build({ invest: [{ ...INVEST, gainCents: null }] });
    expect(md).not.toContain("**GAIN**");
    // The total is still stated - only the unknown figure disappears.
    expect(md).toContain(`**TOTAL** : ${fmt(123_450)}`);
  });
});

describe("figures that are zero, which is not the same thing", () => {
  it("omits the delta line when a balance did not move", () => {
    expect(build({ fiat: [FIAT] })).not.toContain("**DELTA**");
  });

  it("prints the delta with an explicit plus when it did", () => {
    const md = build({ fiat: [{ ...FIAT, deltaCents: 5_000 }] });
    expect(md).toContain(`**DELTA** : +${fmt(5_000)}`);
  });

  it("prints a negative delta without inventing a sign", () => {
    const md = build({ fiat: [{ ...FIAT, deltaCents: -5_000 }] });
    expect(md).toContain(`**DELTA** : ${fmt(-5_000)}`);
    expect(md).not.toContain("+-");
  });

  it("omits tax when none is owed rather than printing -0 EUR", () => {
    const md = build({ invest: [{ ...INVEST, taxCents: 0 }] });
    expect(md).not.toContain("**TAX**");
    expect(md).not.toContain(`-${fmt(0)}`);
  });
});

describe("decimals", () => {
  it("asks for cents on a unit price and not on a total", () => {
    // The bug this guards against is one this repo has already shipped: a real
    // 0,46 EUR figure printed as "0 €" because the export took fmt's 0-decimal
    // default while the screen beside it showed two.
    const md = build({ invest: [{ ...INVEST, holdings: [{ ...HOLDING, lastPriceCents: 46 }] }] });
    const row = md.split("\n").find((l) => l.includes("IE00B4L5Y983"))!;
    expect(row).toContain(fmt(46, 2));
    expect(fmt(46, 2)).not.toEqual(fmt(46));
  });
});

describe("labels and fallbacks", () => {
  it("falls back to the ticker when a holding has no name", () => {
    const md = build({ invest: [{ ...INVEST, holdings: [{ ...HOLDING, name: null }] }] });
    const row = md.split("\n").find((l) => l.includes("IE00B4L5Y983"))!;
    expect(row).toContain("| IE00B4L5Y983 | IE00B4L5Y983 |");
  });

  it("marks a foreign-currency holding and leaves a euro one unmarked", () => {
    const usd = build({ invest: [{ ...INVEST, holdings: [{ ...HOLDING, currency: "USD" }] }] });
    expect(usd).toContain("· USD |");
    expect(build({ invest: [INVEST] })).not.toContain("· EUR |");
  });

  it("falls back to the raw type when no label was translated for it", () => {
    const md = build({ fiat: [{ ...FIAT, type: "MEAL_VOUCHER" }] });
    expect(md).toContain("MEAL_VOUCHER");
  });

  it("appends the wrapper subtype for securities but never for crypto", () => {
    expect(build({ invest: [INVEST] })).toContain("Titres · PEA");
    const crypto = build({
      invest: [{ ...INVEST, type: "CRYPTO", investmentSubtype: "PEA" }],
    });
    expect(crypto).toContain("Crypto");
    expect(crypto).not.toContain("Crypto · PEA");
  });
});

describe("real estate and automobiles", () => {
  const HOUSE: RealEstateAccountExport = {
    id: "r1", name: "Appartement", institutionName: "-",
    valueCents: 30_000_000, liabilityCents: 0, equityCents: 30_000_000, ltv: 0,
  };

  it("hides liability, equity and LTV for a property owned outright", () => {
    const md = build({ realEstate: [HOUSE] });
    expect(md).toContain(`**VALUE** : ${fmt(30_000_000)}`);
    expect(md).not.toContain("**LIABILITY**");
    expect(md).not.toContain("**LTV**");
  });

  it("shows them as soon as something is owed", () => {
    const md = build({
      realEstate: [{ ...HOUSE, liabilityCents: 20_000_000, equityCents: 10_000_000, ltv: 67 }],
    });
    expect(md).toContain("**LIABILITY**");
    expect(md).toContain("**LTV** : 67%");
  });

  it("omits a purchase price nobody entered", () => {
    const car: AutomobileAccountExport = {
      id: "a1", name: "Voiture", institutionName: "-", valueCents: 1_000_000,
      purchasePriceCents: 0, liabilityCents: 0, equityCents: 1_000_000,
      depreciationCents: null, depreciationPct: null,
    };
    const md = build({ automobiles: [car] });
    expect(md).not.toContain("**PURCHASE**");
    expect(md).toContain("**CURRENT**");
  });
});

describe("loans", () => {
  const LOAN: LoanAccountExport = {
    id: "l1", name: "Prêt immo", institutionName: "LCL",
    amountBorrowedCents: 20_000_000, remainingCapitalCents: 15_000_000,
    taeg: 1.9, durationMonths: 240, currentPaymentCents: 95_000,
    totalCostCents: 2_800_000, progressPct: 25, projectedEnd: "mars 2044",
  };

  it("states every figure a loan is judged on", () => {
    const md = build({ loans: [LOAN] });
    for (const expected of [
      `**BORROWED** : ${fmt(20_000_000)}`,
      `**REMAINING** : ${fmt(15_000_000)}`,
      "**TAEG** : 1.90%", // toFixed(2): a rate is quoted to the hundredth
      "**DURATION** : 240 MONTHS",
      `**PAYMENT** : ${fmt(95_000)}`,
      `**COST** : ${fmt(2_800_000)}`,
      "**END** : mars 2044",
      "**PROGRESS** : 25%",
    ]) {
      expect(md).toContain(expected);
    }
  });
});
