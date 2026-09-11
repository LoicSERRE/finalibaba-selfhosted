/**
 * The serialized (no BigInt) export payload for ExportAnalyticsButton. Kept
 * out of the computation because it needs allocation-category and account-type
 * labels already translated, which is an i18n concern the pure maths stays
 * free of.
 */
import type { AnalyticsResult } from "@/lib/domain/analytics-types";

// ── Serialized types (no BigInt) ──────────────────────────────────────────────

export type AllocationSliceExport = {
  name: string;
  valueCents: number;
  pct: number;
};

export type InvestPerfRowExport = {
  name: string;
  institution: string;
  subtype: string | null;
  valueCents: number;
  costBasisCents: number;
  gainCents: number;
  taxCents: number;
  returnPct: number;
};

export type DividendRowExport = {
  name: string;
  symbol: string;
  country: string;
  subtype: string | null;
  valueCents: number;
  annualEstCents: number;
  annualNetCents: number;
  taxRate: number;
  divYield: number;
  exDividendDate: string | null; // ISO string
};

export type PerfRowExport = {
  date: string;
  netWorth: number;
  delta: number | null;
  deltaPct: number | null;
};

export type BenchmarkExport = {
  investCAGR: number;
  msciWorld: number | null;
  sp500: number | null;
  cac40: number | null;
};

export type TopAssetRowExport = {
  name: string;
  institution: string;
  typeLabel: string;
  subtype: string | null;
  valueCents: number;
  gainCents: number | null;
  taxCents: number | null;
  pct: number;
};

export type DebtAccountRowExport = {
  name: string;
  institution: string;
  typeLabel: string;
  valueCents: number;
  liabilityCents: number;
  equityCents: number;
  ltv: number;
};

export type AnalyticsExportData = {
  netWorth: number;
  netWorthBeforeTax: number;
  grossAssets: number;
  totalLiabilities: number;
  totalLatentTax: number;
  investedPct: number;
  hasTaxData: boolean;
  savingsRate: number | null;
  salaryNetCents: number;
  monthlySavedCents: number;
  momDeltaCents: number | null;
  runwayMonths: number | null;
  savingsCents: number;
  monthlyExpensesCents: number;
  goals: { name: string; targetCents: number; pct: number; remainingCents: number }[];
  allocationSlices: AllocationSliceExport[];
  investPerfRows: InvestPerfRowExport[];
  investTotalValueCents: number;
  investTotalCostBasisCents: number;
  investTotalGainCents: number;
  investTotalTaxCents: number;
  investReturnPct: number;
  investCAGR: number | null;
  dividendRows: DividendRowExport[];
  annualDividendsCents: number;
  annualDividendsNetCents: number;
  annualInterestCents: number;
  accountsMissingInterestRate: number;
  weightedSavingsRatePct: number | null;
  estimatedYearEndSavingsInterestCents: number;
  annualPassiveCents: number;
  monthlyPassiveCents: number;
  performanceRows: PerfRowExport[];
  // Real tracked income (IncomeEvent, year-to-date) - distinct from the
  // Yahoo-yield-model estimate above, see lib/analytics.ts.
  realYtdDividendsNetCents: number;
  realYtdInterestNetCents: number;
  realYtdPassiveNetCents: number;
  // Benchmark comparison (null when investCAGR itself is null)
  benchmark: BenchmarkExport | null;
  // Allocation radar
  garantisCents: number;
  risquesCents: number;
  garantisPct: number;
  // Top assets (top 10 by value)
  topAssets: TopAssetRowExport[];
  // Financing / debt analysis
  debtAccounts: DebtAccountRowExport[];
  debtRatio: number;
};


/**
 * Builds the serialized (no BigInt) export payload for ExportAnalyticsButton.
 * Kept separate from computeAnalytics because it needs allocation category
 * (and account type) labels already translated, which is a rendering/i18n
 * concern the pure computation above must stay free of.
 */
export function buildAnalyticsExport(
  result: AnalyticsResult,
  allocationLabels: Record<string, string>,
  typeLabels: Record<string, string>
): AnalyticsExportData {
  return {
    netWorth: Number(result.netWorth),
    netWorthBeforeTax: Number(result.netWorthBeforeTax),
    grossAssets: Number(result.grossAssets),
    totalLiabilities: Number(result.totalLiabilities),
    totalLatentTax: Number(result.totalLatentTax),
    investedPct: result.investedPct,
    hasTaxData: result.hasTaxData,
    savingsRate: result.savingsRate ?? null,
    salaryNetCents: Number(result.salaryNetCents),
    monthlySavedCents: Number(result.monthlySavedCents),
    momDeltaCents: result.momDelta ?? null,
    runwayMonths: result.runwayMonths ?? null,
    savingsCents: Number(result.savingsCents),
    monthlyExpensesCents: Number(result.monthlyExpensesCents),
    goals: result.goals.map((g) => ({
      name: g.name,
      targetCents: Number(g.targetCents),
      pct: g.pct,
      remainingCents: Number(g.remaining),
    })),
    allocationSlices: result.allocationSlices.map((s) => ({
      name: allocationLabels[s.key] ?? s.key,
      valueCents: s.value,
      pct: result.totalAllocation > 0 ? Math.round((s.value / result.totalAllocation) * 100) : 0,
    })),
    investPerfRows: result.investPerfRows.map((r) => ({
      name: r.name,
      institution: r.institution,
      subtype: r.subtype,
      valueCents: Number(r.value),
      costBasisCents: Number(r.costBasis),
      gainCents: Number(r.gain),
      taxCents: Number(r.tax),
      returnPct: r.returnPct,
    })),
    investTotalValueCents: Number(result.investTotalValue),
    investTotalCostBasisCents: Number(result.investTotalCostBasis),
    investTotalGainCents: Number(result.investTotalGain),
    investTotalTaxCents: Number(result.investTotalTax),
    investReturnPct: result.investReturnPct,
    investCAGR: result.investCAGR ?? null,
    dividendRows: result.dividendCalendar.map((r) => ({
      name: r.name,
      symbol: r.symbol,
      country: r.country,
      subtype: r.subtype,
      valueCents: Number(r.valueCents),
      annualEstCents: Number(r.annualEstCents),
      annualNetCents: Number(r.annualNetCents),
      taxRate: r.taxRate,
      divYield: r.divYield,
      exDividendDate: r.exDividendDate ? r.exDividendDate.toISOString() : null,
    })),
    annualDividendsCents: Number(result.annualDividendsCents),
    annualDividendsNetCents: Number(result.annualDividendsNetCents),
    annualInterestCents: Number(result.annualInterestCents),
    accountsMissingInterestRate: result.accountsMissingInterestRate,
    weightedSavingsRatePct: result.weightedSavingsRatePct,
    estimatedYearEndSavingsInterestCents: Number(result.estimatedYearEndSavingsInterestCents),
    annualPassiveCents: Number(result.annualPassiveCents),
    monthlyPassiveCents: result.monthlyPassiveCents,
    performanceRows: result.performanceRows.map((r) => ({
      date: r.date,
      netWorth: r.netWorth,
      delta: r.delta ?? null,
      deltaPct: r.deltaPct ?? null,
    })),
    realYtdDividendsNetCents: Number(result.realYtdDividendsNetCents),
    realYtdInterestNetCents: Number(result.realYtdInterestNetCents),
    realYtdPassiveNetCents: Number(result.realYtdPassiveNetCents),
    benchmark:
      result.investCAGR !== null && result.benchmarkCAGRs !== null
        ? {
            investCAGR: result.investCAGR,
            msciWorld: result.benchmarkCAGRs.msciWorld,
            sp500: result.benchmarkCAGRs.sp500,
            cac40: result.benchmarkCAGRs.cac40,
          }
        : null,
    garantisCents: Number(result.garantis),
    risquesCents: Number(result.risques),
    garantisPct: result.garantisPct,
    topAssets: result.topAssets.map((a) => ({
      name: a.name,
      institution: a.institution,
      typeLabel: typeLabels[a.type] ?? a.type,
      subtype: a.subtype,
      valueCents: Number(a.value),
      gainCents: a.gain !== null ? Number(a.gain) : null,
      taxCents: a.tax !== null ? Number(a.tax) : null,
      pct: a.pct,
    })),
    debtAccounts: result.debtAccounts.map((a) => ({
      name: a.name,
      institution: a.institution,
      typeLabel: typeLabels[a.type] ?? a.type,
      valueCents: Number(a.value),
      liabilityCents: Number(a.liability),
      equityCents: Number(a.equity),
      ltv: a.ltv,
    })),
    debtRatio: result.debtRatio,
  };
}
