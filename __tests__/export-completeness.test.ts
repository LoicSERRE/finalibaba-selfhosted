import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Decimal from "decimal.js";
import { computeAnalytics, type AnalyticsInput } from "@/lib/analytics";
import type {
  FiatAccountExport,
  HoldingExport,
  InvestAccountExport,
  RealEstateAccountExport,
  AutomobileAccountExport,
  LoanAccountExport,
} from "@/components/export-accounts-button";

/**
 * These tests don't check *values* - lib/analytics.test.ts and the manual
 * QA already cover that. They check *completeness*: that every field a
 * computation produces is actually wired into the markdown export somewhere.
 *
 * The failure mode this guards against isn't hypothetical - it's exactly
 * what happened with the analytics export (5 whole sections existed on the
 * page but were never exported) and, caught while writing this very test,
 * `LoanAccountExport.durationMonths` (added, computed, but never printed).
 *
 * How it works: extract a function's source text via brace-matching, then
 * assert each field name appears as a substring somewhere in it. It's a
 * heuristic (a comment mentioning the field name would false-pass), not a
 * data-flow proof - but it directly catches the actual bug pattern: adding
 * a field to a result/export type and never touching the builder function
 * at all.
 */

function extractFunctionSource(fileContent: string, functionSignature: string): string {
  const startIdx = fileContent.indexOf(functionSignature);
  if (startIdx === -1) {
    throw new Error(`Could not find "${functionSignature}" - did it get renamed?`);
  }
  const braceStart = fileContent.indexOf("{", startIdx);
  let depth = 0;
  for (let i = braceStart; i < fileContent.length; i++) {
    if (fileContent[i] === "{") depth++;
    else if (fileContent[i] === "}") {
      depth--;
      if (depth === 0) return fileContent.slice(startIdx, i + 1);
    }
  }
  throw new Error(`Unbalanced braces while extracting "${functionSignature}"`);
}

function assertAllFieldsReferenced(
  source: string,
  fields: string[],
  allowlist: Record<string, string>
) {
  const missing = fields.filter((field) => !(field in allowlist) && !source.includes(field));
  expect(
    missing,
    "these fields are never referenced in the export builder - either export them, or add them to the allowlist with a one-line reason why not"
  ).toEqual([]);
}

describe("analytics export completeness", () => {
  it("every AnalyticsResult field is either exported or explicitly excused", () => {
    const analyticsSource = readFileSync(resolve(__dirname, "../lib/analytics.ts"), "utf-8");
    const buildAnalyticsExportSource = extractFunctionSource(
      analyticsSource,
      "export function buildAnalyticsExport("
    );

    const settings: AnalyticsInput["settings"] = {
      savingsGoalCents: BigInt(500_000_00),
      salaryNetCents: BigInt(3_000_00),
      monthlyExpensesCents: BigInt(1_500_00),
      monthlySavedCents: BigInt(500_00),
      taxRatePea: 0.172,
      taxRateCto: 0.314,
    };
    // A populated-enough portfolio that every AnalyticsResult field gets a
    // real (non-default-only) code path - computeAnalytics always returns
    // every key regardless, but this keeps the fixture representative.
    const result = computeAnalytics({
      accounts: [
        {
          id: "cto",
          name: "CTO",
          type: "INVESTMENT",
          investmentSubtype: "CTO",
          investmentStartDate: new Date("2024-01-01T00:00:00.000Z"),
          taxTreatment: "TAXABLE",
          taxRatePct: 0.3,
          manualValueCents: null,
          liabilityCents: null,
          syncId: null,
          loanAmountCents: null,
          loanTaeg: null,
          loanDurationMonths: null,
          loanDeferralMonths: null,
          loanStartDate: null,
          institution: { name: "Trade Republic" },
          holdings: [
            {
              ticker: "US0378331005",
              name: "Apple",
              quantity: new Decimal(10),
              lastPriceCents: BigInt(200_00),
              costBasisCents: BigInt(100_00),
            },
          ],
          history: [],
        },
        {
          id: "re",
          name: "Appartement",
          type: "REAL_ESTATE",
          investmentSubtype: null,
          investmentStartDate: null,
          taxTreatment: "TAXABLE",
          taxRatePct: null,
          manualValueCents: BigInt(300_000_00),
          liabilityCents: BigInt(200_000_00),
          syncId: null,
          loanAmountCents: null,
          loanTaeg: null,
          loanDurationMonths: null,
          loanDeferralMonths: null,
          loanStartDate: null,
          institution: null,
          holdings: [],
          history: [],
        },
      ],
      allBalances: [],
      settings,
      yfData: {},
      incomeEventsYtd: [
        { type: "DIVIDEND", amountCents: BigInt(100_00), taxWithheldCents: BigInt(10_00) },
      ],
      msciWorldHistory: [
        { date: new Date("2024-01-01T00:00:00.000Z"), close: 100 },
        { date: new Date("2026-07-28T00:00:00.000Z"), close: 120 },
      ],
      sp500History: [],
      cac40History: [],
      intlLocale: "fr-FR",
      now: new Date("2026-07-28T12:00:00.000Z"),
    });

    const allowlist: Record<string, string> = {
      hasData: "empty-state render gate, not a data point",
      hasSalary: "render gate - export shows salaryNetCents directly instead",
      hasDeclaredSavings: "render gate - export shows monthlySavedCents/momDeltaCents directly instead",
      hasExpenses: "render gate - export shows monthlyExpensesCents directly instead",
      investAllHaveDates: "render gate for the CAGR/benchmark sections, not a data point itself",
      taxRatePea: "only shown inside a methodology footnote sentence, not a standalone indicator",
      taxRateCto: "only shown inside a methodology footnote sentence, not a standalone indicator",
      dailyHistory: "chart-only raw series (SVG line chart) - performanceRows is the tabular monthly equivalent that IS exported",
      investTotalGainNet: "derivable from investTotalGainCents - investTotalTaxCents, which the export already recomputes inline in its own summary line",
    };

    assertAllFieldsReferenced(buildAnalyticsExportSource, Object.keys(result), allowlist);
  });
});

describe("accounts export completeness", () => {
  const source = readFileSync(resolve(__dirname, "../components/export-accounts-button.tsx"), "utf-8");
  const buildMarkdownSource = extractFunctionSource(source, "function buildMarkdown(");

  const idAllowlist: Record<string, string> = {
    id: "React key / selection-dialog identity only, never rendered as text",
  };

  it("every FiatAccountExport field is referenced in buildMarkdown", () => {
    const fixture: FiatAccountExport = {
      id: "1",
      name: "Compte courant",
      institutionName: "LCL",
      type: "CHECKING",
      balanceCents: 100_00,
      deltaCents: 5_00,
    };
    assertAllFieldsReferenced(buildMarkdownSource, Object.keys(fixture), idAllowlist);
  });

  it("every HoldingExport field is referenced in buildMarkdown", () => {
    const fixture: HoldingExport = {
      ticker: "AAPL",
      name: "Apple",
      quantity: "10",
      lastPriceCents: 200_00,
      valueCents: 2000_00,
      pct: 50,
      costBasisCents: 100_00,
      gainCents: 1900_00,
      gainPct: 950,
      taxCents: 300_00,
      currency: "USD",
      targetPct: 30,
    };
    assertAllFieldsReferenced(buildMarkdownSource, Object.keys(fixture), {
      costBasisCents: "only the derived gain is shown on the account page too - not an omission specific to the export",
    });
  });

  it("every InvestAccountExport field is referenced in buildMarkdown", () => {
    const fixture: InvestAccountExport = {
      id: "1",
      name: "PEA",
      institutionName: "Trade Republic",
      type: "INVESTMENT",
      investmentSubtype: "PEA",
      totalCents: 10_000_00,
      gainCents: 2_000_00,
      taxCents: 300_00,
      holdings: [],
    };
    assertAllFieldsReferenced(buildMarkdownSource, Object.keys(fixture), idAllowlist);
  });

  it("every RealEstateAccountExport field is referenced in buildMarkdown", () => {
    const fixture: RealEstateAccountExport = {
      id: "1",
      name: "Appartement",
      institutionName: "",
      valueCents: 300_000_00,
      liabilityCents: 200_000_00,
      equityCents: 100_000_00,
      ltv: 66,
    };
    assertAllFieldsReferenced(buildMarkdownSource, Object.keys(fixture), idAllowlist);
  });

  it("every AutomobileAccountExport field is referenced in buildMarkdown", () => {
    const fixture: AutomobileAccountExport = {
      id: "1",
      name: "Voiture",
      institutionName: "",
      valueCents: 20_000_00,
      purchasePriceCents: 25_000_00,
      liabilityCents: 5_000_00,
      equityCents: 15_000_00,
      depreciationCents: -5_000_00,
      depreciationPct: -20,
    };
    assertAllFieldsReferenced(buildMarkdownSource, Object.keys(fixture), idAllowlist);
  });

  it("every LoanAccountExport field is referenced in buildMarkdown", () => {
    const fixture: LoanAccountExport = {
      id: "1",
      name: "Prêt immobilier",
      institutionName: "",
      amountBorrowedCents: 200_000_00,
      remainingCapitalCents: 150_000_00,
      taeg: 3.5,
      durationMonths: 240,
      currentPaymentCents: 1_000_00,
      totalCostCents: 80_000_00,
      progressPct: 20,
      projectedEnd: "juin 2042",
    };
    assertAllFieldsReferenced(buildMarkdownSource, Object.keys(fixture), idAllowlist);
  });
});
