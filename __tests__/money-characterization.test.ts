import { describe, expect, it } from "vitest";
import { computeAnalytics } from "@/lib/domain/analytics";
import { computeDashboard, type DashboardInput } from "@/lib/domain/dashboard";
import { ACCOUNTS, BALANCES, INPUT, INPUT_WITH_MARKET_DATA, NOW, stable } from "@/__tests__/fixtures/awkward-portfolio";

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

describe("computeAnalytics with market data, pinned whole", () => {
  // The fixture above leaves yfData and the CAC 40 empty, so the dividend
  // calendar - its join, its sort, its past/soon buckets - was pinned by
  // nothing. Added before the v2.11 complexity split, so that split is
  // checked against what the code did, not against what it was meant to do.
  it("produces exactly the figures it produced before the complexity work", () => {
    expect(stable(computeAnalytics(INPUT_WITH_MARKET_DATA))).toMatchSnapshot();
  });

  it("actually exercises the branches it exists for", () => {
    const result = computeAnalytics(INPUT_WITH_MARKET_DATA);
    const calendar = result.dividendCalendar;
    expect(calendar.some((r) => r.isPast)).toBe(true);
    expect(calendar.some((r) => r.isSoon)).toBe(true);
    expect(calendar.some((r) => r.exDividendDate !== null && !r.isPast && !r.isSoon)).toBe(true);
    expect(result.benchmarkCAGRs?.cac40).toEqual(expect.any(Number));
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
