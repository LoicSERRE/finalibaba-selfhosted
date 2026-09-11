import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { computeAnalytics, type AnalyticsInput } from "@/lib/domain/analytics";
import { computeDashboard, type DashboardInput } from "@/lib/domain/dashboard";

/**
 * A characterization test, not a specification.
 *
 * computeAnalytics is 68 cyclomatic complexity and computeDashboard is 60 -
 * the two most complex functions in this repository, and both of them decide
 * what somebody's net worth says. The existing suites cover 95% of their
 * statements but only ~80% of their branches, which is a comfortable place
 * from which to break something quietly.
 *
 * So this pins the FULL output of both, to the cent, against one deliberately
 * awkward portfolio: every account type, a loan mid-amortisation, a holding
 * with no cost basis, one with a target weight, a property with a mortgage, a
 * car past its purchase price, goals both linked and unlinked, and a balance
 * history with gaps in it.
 *
 * **Do not update these numbers to make a test pass.** They are not a
 * judgement about what the maths SHOULD produce - they are a record of what
 * it DID produce before a refactor, and their only job is to notice that it
 * changed. A deliberate change of behaviour means changing them in the same
 * commit that changes the behaviour, with the reason in the message.
 */

const NOW = new Date("2026-07-28T12:00:00.000Z");

function day(d: string) {
  return new Date(`${d}T12:00:00.000Z`);
}

const HOLDINGS = [
  // Cost basis known, a real gain, and a rebalancing target set.
  { ticker: "IE00B4L5Y983", name: "iShares Core MSCI World", quantity: new Decimal("12.5"), lastPriceCents: BigInt(9_876), costBasisCents: BigInt(100_000) },
  // No cost basis at all: contributes value but must not invent a gain.
  { ticker: "FR0010315770", name: "Lyxor PEA Monde", quantity: new Decimal("40"), lastPriceCents: BigInt(2_501), costBasisCents: null },
  // A loss, so the gain-weighted tax blend has both signs to deal with.
  { ticker: "US0378331005", name: "Apple", quantity: new Decimal("3"), lastPriceCents: BigInt(15_000), costBasisCents: BigInt(60_000) },
];

const ACCOUNTS: AnalyticsInput["accounts"] = [
  {
    id: "cur", name: "Courant", type: "CHECKING", investmentSubtype: null,
    investmentStartDate: null, taxTreatment: "EXEMPT", taxRatePct: null,
    dividendsAlreadyNet: false, interestRatePct: null, manualValueCents: null,
    liabilityCents: null, syncId: "lcl:1", loanAmountCents: null, loanTaeg: null,
    loanDurationMonths: null, loanDeferralMonths: null, loanStartDate: null,
    institution: { name: "LCL" }, holdings: [], history: [{ balanceCents: BigInt(2_345_67) }],
  },
  {
    id: "liv", name: "Livret A", type: "SAVINGS", investmentSubtype: null,
    investmentStartDate: null, taxTreatment: "EXEMPT", taxRatePct: null,
    dividendsAlreadyNet: false, interestRatePct: 0.017, manualValueCents: null,
    liabilityCents: null, syncId: null, loanAmountCents: null, loanTaeg: null,
    loanDurationMonths: null, loanDeferralMonths: null, loanStartDate: null,
    institution: { name: "LCL" }, holdings: [], history: [{ balanceCents: BigInt(15_000_00) }],
  },
  {
    // Interest-bearing with NO rate set: must count as unknown, not as zero.
    id: "lep", name: "LEP", type: "SAVINGS", investmentSubtype: null,
    investmentStartDate: null, taxTreatment: "EXEMPT", taxRatePct: null,
    dividendsAlreadyNet: false, interestRatePct: null, manualValueCents: null,
    liabilityCents: null, syncId: null, loanAmountCents: null, loanTaeg: null,
    loanDurationMonths: null, loanDeferralMonths: null, loanStartDate: null,
    institution: { name: "LCL" }, holdings: [], history: [{ balanceCents: BigInt(3_000_00) }],
  },
  {
    id: "pea", name: "PEA", type: "INVESTMENT", investmentSubtype: "PEA",
    investmentStartDate: day("2021-03-15"), taxTreatment: "TAXABLE", taxRatePct: 0.186,
    dividendsAlreadyNet: false, interestRatePct: null, manualValueCents: null,
    liabilityCents: null, syncId: null, loanAmountCents: null, loanTaeg: null,
    loanDurationMonths: null, loanDeferralMonths: null, loanStartDate: null,
    institution: { name: "Bourso" }, holdings: HOLDINGS.slice(0, 2), history: [],
  },
  {
    id: "cto", name: "CTO", type: "INVESTMENT", investmentSubtype: "CTO",
    investmentStartDate: day("2024-01-01"), taxTreatment: "TAXABLE", taxRatePct: 0.314,
    dividendsAlreadyNet: false, interestRatePct: null, manualValueCents: null,
    liabilityCents: null, syncId: null, loanAmountCents: null, loanTaeg: null,
    loanDurationMonths: null, loanDeferralMonths: null, loanStartDate: null,
    institution: { name: "Trade Republic" }, holdings: [HOLDINGS[2]], history: [],
  },
  {
    id: "cry", name: "Crypto", type: "CRYPTO", investmentSubtype: null,
    investmentStartDate: day("2023-06-01"), taxTreatment: "TAXABLE", taxRatePct: 0.314,
    dividendsAlreadyNet: false, interestRatePct: null, manualValueCents: null,
    liabilityCents: null, syncId: null, loanAmountCents: null, loanTaeg: null,
    loanDurationMonths: null, loanDeferralMonths: null, loanStartDate: null,
    institution: null,
    holdings: [{ ticker: "BTC", name: "Bitcoin", quantity: new Decimal("0.15"), lastPriceCents: BigInt(6_000_000), costBasisCents: BigInt(500_000) }],
    history: [],
  },
  {
    id: "app", name: "Appartement", type: "REAL_ESTATE", investmentSubtype: null,
    investmentStartDate: null, taxTreatment: "EXEMPT", taxRatePct: null,
    dividendsAlreadyNet: false, interestRatePct: null,
    manualValueCents: BigInt(300_000_00), liabilityCents: BigInt(180_000_00),
    syncId: null, loanAmountCents: null, loanTaeg: null, loanDurationMonths: null,
    loanDeferralMonths: null, loanStartDate: null, institution: null, holdings: [], history: [],
  },
  {
    id: "car", name: "Voiture", type: "AUTOMOBILE", investmentSubtype: null,
    investmentStartDate: null, taxTreatment: "EXEMPT", taxRatePct: null,
    dividendsAlreadyNet: false, interestRatePct: null,
    manualValueCents: BigInt(9_500_00), liabilityCents: BigInt(0),
    syncId: null, loanAmountCents: null, loanTaeg: null, loanDurationMonths: null,
    loanDeferralMonths: null, loanStartDate: null, institution: null, holdings: [], history: [],
  },
  {
    id: "loan", name: "Prêt immo", type: "LOAN", investmentSubtype: null,
    investmentStartDate: null, taxTreatment: "EXEMPT", taxRatePct: null,
    dividendsAlreadyNet: false, interestRatePct: null, manualValueCents: null,
    liabilityCents: null, syncId: null,
    loanAmountCents: BigInt(200_000_00), loanTaeg: 1.9, loanDurationMonths: 240,
    loanDeferralMonths: 0, loanStartDate: day("2021-01-01"),
    institution: { name: "LCL" }, holdings: [], history: [],
  },
];

/** Deliberately gappy: two accounts, uneven days, not every account every day. */
const BALANCES: AnalyticsInput["allBalances"] = [
  { accountId: "cur", recordedAt: day("2026-05-01"), balanceCents: BigInt(2_000_00) },
  { accountId: "liv", recordedAt: day("2026-05-01"), balanceCents: BigInt(14_000_00) },
  { accountId: "cur", recordedAt: day("2026-06-15"), balanceCents: BigInt(2_500_00) },
  { accountId: "liv", recordedAt: day("2026-07-01"), balanceCents: BigInt(15_000_00) },
  { accountId: "cur", recordedAt: day("2026-07-20"), balanceCents: BigInt(2_345_67) },
];

const INPUT: AnalyticsInput = {
  accounts: ACCOUNTS,
  allBalances: BALANCES,
  settings: {
    salaryNetCents: BigInt(3_200_00),
    monthlyExpensesCents: BigInt(1_850_00),
    monthlySavedCents: BigInt(900_00),
    taxRatePea: 0.186,
    taxRateCto: 0.314,
  },
  goals: [
    { id: "g1", name: "Patrimoine", targetCents: BigInt(500_000_00), targetDate: null, accountId: null },
    { id: "g2", name: "Fonds d'urgence", targetCents: BigInt(20_000_00), targetDate: day("2027-01-01"), accountId: "liv" },
  ],
  yfData: {},
  incomeEventsYtd: [
    { type: "DIVIDEND", amountCents: BigInt(146), taxWithheldCents: BigInt(22) },
    { type: "INTEREST", amountCents: BigInt(87_50), taxWithheldCents: null },
  ],
  msciWorldHistory: [
    { date: day("2021-01-01"), close: 80 },
    { date: day("2024-01-01"), close: 100 },
    { date: day("2026-07-28"), close: 131.5 },
  ],
  sp500History: [
    { date: day("2021-01-01"), close: 3700 },
    { date: day("2026-07-28"), close: 5600 },
  ],
  cac40History: [],
  intlLocale: "fr-FR",
  now: NOW,
};

const DASHBOARD_INPUT: DashboardInput = {
  accounts: ACCOUNTS.map((a) => ({
    id: a.id, name: a.name, type: a.type, institutionId: null,
    institution: a.institution, taxTreatment: a.taxTreatment, taxRatePct: a.taxRatePct,
    manualValueCents: a.manualValueCents, liabilityCents: a.liabilityCents,
    loanAmountCents: a.loanAmountCents, loanTaeg: a.loanTaeg,
    loanDurationMonths: a.loanDurationMonths, loanDeferralMonths: a.loanDeferralMonths,
    loanStartDate: a.loanStartDate, holdings: a.holdings, history: a.history,
  })) as DashboardInput["accounts"],
  allBalances: BALANCES,
  intlLocale: "fr-FR",
  now: NOW,
};

/** BigInt and Decimal do not survive JSON; render them as their own digits. */
function stable(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_k, v) => {
      if (typeof v === "bigint") return `${v}n`;
      if (v instanceof Decimal) return v.toString();
      return v;
    })
  );
}

describe("computeAnalytics, pinned whole", () => {
  it("produces exactly the figures it produced before the complexity work", () => {
    expect(stable(computeAnalytics(INPUT))).toMatchSnapshot();
  });

  it("still answers with every key it is expected to have", () => {
    // A snapshot catches a changed value; this catches a key quietly vanishing,
    // which a snapshot update would otherwise absorb without comment.
    const result = computeAnalytics(INPUT);
    expect(Object.keys(result).length).toBeGreaterThan(40);
    for (const key of ["netWorth", "grossAssets", "totalLatentTax", "totalLiabilities", "assetRows", "allocationSlices"]) {
      expect(result).toHaveProperty(key);
    }
  });
});

describe("computeDashboard, pinned whole", () => {
  it("produces exactly the figures it produced before the complexity work", () => {
    expect(stable(computeDashboard(DASHBOARD_INPUT))).toMatchSnapshot();
  });
});

describe("the one invariant the two share", () => {
  it("agrees with itself on net worth", () => {
    // Three screens once disagreed about what net worth is (v2.10.0). They are
    // computed by two different functions from the same accounts, so the only
    // thing keeping them equal is that nobody changes one of them alone.
    const a = computeAnalytics(INPUT);
    const d = computeDashboard(DASHBOARD_INPUT);
    expect(a.netWorth).toEqual(d.netWorth);
  });
});
