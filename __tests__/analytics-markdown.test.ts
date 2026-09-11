import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { buildMarkdown, type Section, type AnalyticsExportStrings } from "@/lib/utils/analytics-markdown";
import { buildAnalyticsExport } from "@/lib/domain/analytics-export";
import { computeAnalytics, type AnalyticsInput } from "@/lib/domain/analytics";
import type { AnalyticsExportData } from "@/lib/domain/analytics-export";

/**
 * The analytics export document, at 52 cyclomatic complexity the second most
 * complex function in this repository and, until v2.10.4 moved it out of
 * components/, one that nothing could measure or reach.
 *
 * Its whole job is ten independent sections behind a DOUBLE gate: the user
 * ticked it, AND there is something to say. Getting either half wrong is
 * silent - an export is downloaded, not watched - so that pairing is what
 * these pin, along with the absent-versus-zero distinction this repo keeps
 * re-learning.
 *
 * The fixture is a real computeAnalytics result pushed through the real
 * buildAnalyticsExport rather than a hand-written payload, so a field that
 * changes shape upstream breaks these too instead of drifting past them.
 */

const ALL: Section[] = [
  "resume", "allocation", "performance", "dividendes", "revenusReels",
  "benchmark", "radar", "topActifs", "financement", "historique",
];

/** Every string is its own key, so an assertion names what it is looking at. */
const S = new Proxy({} as AnalyticsExportStrings, {
  get(_t, prop: string) {
    // Every parameterised string, echoed with its arguments so a test can see
    // both that it was called and what it was handed.
    if (prop === "summaryLine") return (p: Record<string, string>) => `SUMMARYLINE:${JSON.stringify(p)}`;
    if (prop === "passiveLine") return (p: Record<string, string>) => `PASSIVELINE:${JSON.stringify(p)}`;
    if (prop === "goalFmt") return (amount: string, pct: number) => `GOALFMT:${amount}:${pct}`;
    if (prop === "cagrSuffix") return (cagr: string) => `CAGRSUFFIX:${cagr}`;
    if (prop === "passiveMissingRates") return (p: { count: number }) => `MISSINGRATES:${p.count}`;
    if (prop === "passiveWeightedRate") return (p: { rate: string }) => `WEIGHTEDRATE:${p.rate}`;
    if (prop === "passiveYearEndEstimate") return (p: { amount: string }) => `YEAREND:${p.amount}`;
    return prop.toUpperCase();
  },
});

function analyticsResult(over: Partial<AnalyticsInput> = {}) {
  const settings: AnalyticsInput["settings"] = {
    salaryNetCents: BigInt(3_000_00),
    monthlyExpensesCents: BigInt(1_500_00),
    monthlySavedCents: BigInt(500_00),
    taxRatePea: 0.172,
    taxRateCto: 0.314,
  };
  return computeAnalytics({
    accounts: [
      {
        id: "cto", name: "CTO", type: "INVESTMENT", investmentSubtype: "CTO",
        investmentStartDate: new Date("2024-01-01T00:00:00.000Z"),
        taxTreatment: "TAXABLE", taxRatePct: 0.3, dividendsAlreadyNet: false,
        interestRatePct: null, manualValueCents: null, liabilityCents: null,
        syncId: null, loanAmountCents: null, loanTaeg: null, loanDurationMonths: null,
        loanDeferralMonths: null, loanStartDate: null,
        institution: { name: "Trade Republic" },
        holdings: [{
          ticker: "US0378331005", name: "Apple", quantity: new Decimal(10),
          lastPriceCents: BigInt(200_00), costBasisCents: BigInt(100_00),
        }],
        history: [],
      },
    ],
    allBalances: [],
    settings,
    goals: [{ id: "g1", name: "Patrimoine", targetCents: BigInt(500_000_00), targetDate: null, accountId: null }],
    yfData: {},
    incomeEventsYtd: [{ type: "DIVIDEND", amountCents: BigInt(100_00), taxWithheldCents: BigInt(10_00) }],
    msciWorldHistory: [
      { date: new Date("2024-01-01T00:00:00.000Z"), close: 100 },
      { date: new Date("2026-07-28T00:00:00.000Z"), close: 120 },
    ],
    sp500History: [],
    cac40History: [],
    intlLocale: "fr-FR",
    now: new Date("2026-07-28T12:00:00.000Z"),
    ...over,
  });
}

function payload(over: Partial<AnalyticsInput> = {}): AnalyticsExportData {
  return buildAnalyticsExport(analyticsResult(over), { investments: "Investissements" }, { INVESTMENT: "Titres" });
}

function build(sections: Section[], data: AnalyticsExportData = payload()) {
  return buildMarkdown(data, new Set(sections), S, "fr-FR");
}

describe("the user's section choice is honoured", () => {
  it("prints nothing but the title when nothing is selected", () => {
    const md = build([]);
    expect(md).toContain("TITLE");
    for (const heading of ["SUMMARY", "ALLOCATION", "PERFORMANCE", "TOPASSETS", "HISTORY"]) {
      expect(md).not.toContain(`## ${heading}`);
    }
  });

  it("prints one section when one is selected, and not its neighbours", () => {
    const md = build(["resume"]);
    expect(md).toContain("## SUMMARY");
    expect(md).not.toContain("## ALLOCATION");
    expect(md).not.toContain("## TOPASSETS");
  });

  it("never invents a section the caller did not ask for", () => {
    const md = build(["allocation"]);
    expect(md).not.toContain("## SUMMARY");
  });
});

describe("a selected section with nothing to say prints nothing", () => {
  it("drops the allocation heading when there are no slices", () => {
    const data = { ...payload(), allocationSlices: [] };
    expect(build(["allocation"], data)).not.toContain("## ALLOCATION");
  });

  it("drops performance, top assets, financing and history the same way", () => {
    const data = {
      ...payload(),
      investPerfRows: [], topAssets: [], debtAccounts: [], performanceRows: [],
    };
    const md = build(ALL, data);
    for (const heading of ["PERFORMANCE", "TOPASSETS", "FINANCING", "HISTORY"]) {
      expect(md).not.toContain(`## ${heading}`);
    }
  });

  it("drops the passive-income section when the estimate is zero", () => {
    const data = { ...payload(), annualPassiveCents: 0 };
    expect(build(["dividendes"], data)).not.toContain("## PASSIVE");
  });

  it("drops the real-income section when nothing was actually received", () => {
    const data = { ...payload(), realYtdPassiveNetCents: 0 };
    expect(build(["revenusReels"], data)).not.toContain("## REALINCOME");
  });

  it("drops the benchmark section when no index could be fetched", () => {
    const data = { ...payload(), benchmark: null };
    expect(build(["benchmark"], data)).not.toContain("## BENCHMARK");
  });
});

describe("an absent value is never rendered as zero", () => {
  it("prints a dash for a top asset whose gain and tax are unknown", () => {
    const base = payload();
    const data = {
      ...base,
      topAssets: [{ ...base.topAssets[0], gainCents: null, taxCents: null }],
    };
    const rows = build(["topActifs"], data)
      .split("\n")
      .filter((l) => l.startsWith("|") && !l.includes("---") && !l.includes("COLASSET"));
    expect(rows).not.toHaveLength(0);
    expect(rows.every((r) => r.includes("| - |"))).toBe(true);
  });

  it("prints a zero tax as a real figure, and a positive one as a deduction", () => {
    // The nested ternary this was written from reads: unknown -> "-",
    // positive -> "-X", otherwise -> 0. All three branches are distinct and
    // only one of them means "nothing owed".
    const base = payload();
    const zero = build(["topActifs"], { ...base, topAssets: [{ ...base.topAssets[0], taxCents: 0 }] });
    const owed = build(["topActifs"], { ...base, topAssets: [{ ...base.topAssets[0], taxCents: 12_34 }] });
    expect(zero).not.toContain("| - |");
    expect(owed).toMatch(/\|\s-\d/);
  });
});

describe("the whole document", () => {
  it("renders every section together without throwing", () => {
    const md = build(ALL);
    expect(md).toContain("## SUMMARY");
    expect(md.length).toBeGreaterThan(200);
  });

  it("is deterministic for the same input", () => {
    expect(build(ALL)).toEqual(build(ALL));
  });
});
