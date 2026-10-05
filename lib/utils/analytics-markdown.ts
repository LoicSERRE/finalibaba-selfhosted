/**
 * The analytics markdown document. Pure: data in, one string out.
 *
 * Split out of components/shared/export-analytics-button.tsx at v2.10.3, where
 * 639 lines were 230 of string building, 120 of type declarations and a button.
 * Those types moved to lib/domain/analytics-export.ts, which returns them -
 * lib/ was importing them back out of a component, the wrong way round.
 */
import { fmt, sign } from "@/lib/utils/markdown-export";
import type { AnalyticsExportData } from "@/lib/domain/analytics-export";

// ── Sections ──────────────────────────────────────────────────────────────────

export type Section =
  | "resume"
  | "allocation"
  | "performance"
  | "dividendes"
  | "revenusReels"
  | "benchmark"
  | "radar"
  | "topActifs"
  | "financement"
  | "historique";

// ── Markdown strings interface ────────────────────────────────────────────────

export interface AnalyticsExportStrings {
  title: string;
  summary: string;
  allocation: string;
  performance: string;
  passive: string;
  realIncome: string;
  benchmark: string;
  radar: string;
  topAssets: string;
  financing: string;
  history: string;
  netWorthAfterTax: string;
  netWorth: string;
  gross: string;
  debts: string;
  taxes: string;
  investedRate: string;
  savingsRate: string;
  salary: string;
  monthlySaved: string;
  momDelta: string;
  runway: string;
  savingsAvailable: string;
  monthlyExpenses: string;
  goal: string;
  goalRemaining: string;
  indicator: string;
  value: string;
  category: string;
  pct: string;
  colAccount: string;
  colInvested: string;
  colValue: string;
  colGrossGain: string;
  colTax: string;
  colPerf: string;
  colNetWorth: string;
  colChange: string;
  colAsset: string;
  colEnvelope: string;
  colYield: string;
  colAnnualGross: string;
  colAnnualNet: string;
  colExDiv: string;
  colMonth: string;
  colGain: string;
  colLoan: string;
  colEquity: string;
  colLtv: string;
  months: string;
  ytdDividends: string;
  ytdInterest: string;
  ytdTotal: string;
  yourPortfolio: string;
  msciWorld: string;
  sp500: string;
  cac40: string;
  safeVsRisky: string;
  safe: string;
  risky: string;
  totalLiabilities: string;
  debtRatio: string;
  equity: string;
  goalFmt: (amount: string, pct: number) => string;
  summaryLine: (params: {
    invested: string;
    value: string;
    gain: string;
    netGain: string;
    perf: string;
    cagr: string;
  }) => string;
  cagrSuffix: (cagr: string) => string;
  passiveLine: (params: {
    annual: string;
    monthly: string;
    dividends: string;
    interest: string;
  }) => string;
  passiveMissingRates: (params: { count: number }) => string;
  passiveWeightedRate: (params: { rate: string }) => string;
  passiveYearEndEstimate: (params: { amount: string }) => string;
}

// ── Markdown generation ───────────────────────────────────────────────────────

// One pure function per toggleable section, each answering "what does this
// section print" and nothing else - including the empty answer when there is
// nothing to say. buildMarkdown only decides which sections were asked for,
// in a fixed order, so the "ticked AND non-empty" double gate the tests pin
// lives in exactly one place per section. Same section list as
// __tests__/export-completeness.test.ts checks against.
//
// Every renderer returns its own lines including the trailing blank line, so
// the document is the plain concatenation of what each one returns - which is
// what the characterization snapshots in __tests__/analytics-markdown.test.ts
// hold it to, byte for byte.

type Renderer = (data: AnalyticsExportData, s: AnalyticsExportStrings, intlLocale: string) => string[];

function signedFixed(value: number, digits = 1): string {
  return `${sign(value)}${value.toFixed(digits)}`;
}

function summaryCashFlowRows(data: AnalyticsExportData, s: AnalyticsExportStrings): string[] {
  const rows: string[] = [];
  if (data.savingsRate !== null) {
    rows.push(`| ${s.savingsRate} | ${signedFixed(data.savingsRate)}% |`);
  }
  if (data.salaryNetCents > 0) rows.push(`| ${s.salary} | ${fmt(data.salaryNetCents)} |`);
  // Declared monthly savings win over the month-on-month delta, which is
  // distorted by transfers and market moves.
  if (data.monthlySavedCents > 0) {
    rows.push(`| ${s.monthlySaved} | ${fmt(data.monthlySavedCents)} |`);
  } else if (data.momDeltaCents !== null) {
    rows.push(`| ${s.momDelta} | ${sign(data.momDeltaCents)}${fmt(data.momDeltaCents)} |`);
  }
  if (data.runwayMonths !== null) {
    rows.push(`| ${s.runway} | ${Math.floor(data.runwayMonths)} ${s.months} |`);
    rows.push(`| ${s.savingsAvailable} | ${fmt(data.savingsCents)} |`);
    rows.push(`| ${s.monthlyExpenses} | ${fmt(data.monthlyExpensesCents)} |`);
  }
  return rows;
}

function summaryGoalRows(data: AnalyticsExportData, s: AnalyticsExportStrings): string[] {
  return data.goals.flatMap((goal) => {
    const rows = [`| ${s.goal} - ${goal.name} | ${s.goalFmt(fmt(goal.targetCents), goal.pct)} |`];
    if (goal.remainingCents > 0) rows.push(`| ${s.goalRemaining} - ${goal.name} | ${fmt(goal.remainingCents)} |`);
    return rows;
  });
}

const renderSummary: Renderer = (data, s) => {
  // data.netWorth is already net of latent tax; the label only says so
  // explicitly when there is a deduction to speak of.
  const netLabel = data.hasTaxData ? s.netWorthAfterTax : s.netWorth;
  const taxRows = data.hasTaxData
    ? [`| ${s.taxes} | ${fmt(data.totalLatentTax)} |`, `| ${s.netWorth} | ${fmt(data.netWorthBeforeTax)} |`]
    : [];
  return [
    `## ${s.summary}`, "",
    `| ${s.indicator} | ${s.value} |`,
    "|---|---|",
    `| ${netLabel} | **${fmt(data.netWorth)}** |`,
    `| ${s.gross} | ${fmt(data.grossAssets)} |`,
    `| ${s.debts} | ${fmt(data.totalLiabilities)} |`,
    ...taxRows,
    `| ${s.investedRate} | ${data.investedPct}% |`,
    ...summaryCashFlowRows(data, s),
    ...summaryGoalRows(data, s),
    "",
  ];
};

const renderAllocation: Renderer = (data, s) => {
  if (data.allocationSlices.length === 0) return [];
  return [
    `## ${s.allocation}`, "",
    `| ${s.category} | ${s.value} | ${s.pct} |`,
    "|---|---|---|",
    ...data.allocationSlices.map((slice) => `| ${slice.name} | ${fmt(slice.valueCents)} | ${slice.pct}% |`),
    "",
  ];
};

function labelWithSubtype(name: string, subtype: string | null): string {
  return subtype ? `${name} (${subtype})` : name;
}

function performanceSummaryLine(data: AnalyticsExportData, s: AnalyticsExportStrings): string {
  const netGain = data.investTotalGainCents - data.investTotalTaxCents;
  const cagrSuffix = data.investCAGR !== null ? s.cagrSuffix(signedFixed(data.investCAGR)) : "";
  return s.summaryLine({
    invested: fmt(data.investTotalCostBasisCents),
    value: fmt(data.investTotalValueCents),
    gain: `${sign(data.investTotalGainCents)}${fmt(data.investTotalGainCents)}`,
    netGain: `${sign(netGain)}${fmt(netGain)}`,
    perf: signedFixed(data.investReturnPct),
    cagr: cagrSuffix,
  });
}

const renderPerformance: Renderer = (data, s) => {
  if (data.investPerfRows.length === 0) return [];
  return [
    `## ${s.performance}`, "",
    `| ${s.colAccount} | ${s.colValue} | ${s.colInvested} | ${s.colGrossGain} | ${s.colTax} | ${s.colPerf} |`,
    "|---|---|---|---|---|---|",
    ...data.investPerfRows.map(
      (r) =>
        `| ${labelWithSubtype(r.name, r.subtype)} | ${fmt(r.valueCents)} | ${fmt(r.costBasisCents)} | ${sign(r.gainCents)}${fmt(r.gainCents)} | -${fmt(r.taxCents)} | ${signedFixed(r.returnPct)}% |`
    ),
    "",
    performanceSummaryLine(data, s),
    "",
  ];
};

// A document someone plans with must not quietly under-report. The interest
// half of the passive figure only counts accounts whose rate is set, and an
// unset rate is invisible everywhere else in the app - so if any are missing,
// the export says so rather than presenting a partial total as a complete one.
function passiveNotes(data: AnalyticsExportData, s: AnalyticsExportStrings): string[] {
  const notes: string[] = [];
  if (data.accountsMissingInterestRate > 0) {
    notes.push("", `> ${s.passiveMissingRates({ count: data.accountsMissingInterestRate })}`);
  }
  if (data.weightedSavingsRatePct !== null) {
    notes.push("", s.passiveWeightedRate({ rate: (data.weightedSavingsRatePct * 100).toFixed(2) }));
  }
  if (data.estimatedYearEndSavingsInterestCents > 0) {
    notes.push("", s.passiveYearEndEstimate({ amount: fmt(data.estimatedYearEndSavingsInterestCents) }));
  }
  return notes;
}

function exDividendCell(date: AnalyticsExportData["dividendRows"][number]["exDividendDate"], intlLocale: string): string {
  if (!date) return "-";
  return new Date(date).toLocaleDateString(intlLocale, { day: "numeric", month: "short", year: "numeric" });
}

function dividendTable(data: AnalyticsExportData, s: AnalyticsExportStrings, intlLocale: string): string[] {
  if (data.dividendRows.length === 0) return [];
  return [
    `| ${s.colAsset} | ${s.colEnvelope} | ${s.colYield} | ${s.colAnnualGross} | ${s.colAnnualNet} | ${s.colExDiv} |`,
    "|---|---|---|---|---|---|",
    ...data.dividendRows.map(
      (r) =>
        `| ${r.name} | ${r.subtype ?? "CTO"} | ${(r.divYield * 100).toFixed(2)}% | ${fmt(r.annualEstCents)} | ${fmt(r.annualNetCents)} | ${exDividendCell(r.exDividendDate, intlLocale)} |`
    ),
    "",
  ];
}

const renderPassive: Renderer = (data, s, intlLocale) => {
  if (data.annualPassiveCents <= 0) return [];
  return [
    `## ${s.passive}`, "",
    s.passiveLine({
      annual: fmt(data.annualPassiveCents),
      monthly: fmt(data.monthlyPassiveCents),
      dividends: fmt(data.annualDividendsCents),
      interest: fmt(data.annualInterestCents),
    }),
    ...passiveNotes(data, s),
    "",
    ...dividendTable(data, s, intlLocale),
  ];
};

const renderRealIncome: Renderer = (data, s) => {
  if (data.realYtdPassiveNetCents <= 0) return [];
  return [
    `## ${s.realIncome}`, "",
    `| ${s.indicator} | ${s.value} |`,
    "|---|---|",
    `| ${s.ytdDividends} | ${fmt(data.realYtdDividendsNetCents)} |`,
    `| ${s.ytdInterest} | ${fmt(data.realYtdInterestNetCents)} |`,
    `| ${s.ytdTotal} | **${fmt(data.realYtdPassiveNetCents)}** |`,
    "",
  ];
};

const renderBenchmark: Renderer = (data, s) => {
  const benchmark = data.benchmark;
  if (benchmark === null) return [];
  const cagrCell = (v: number) => `${signedFixed(v)}%`;
  // An index with no history is left out rather than shown as 0%.
  const indices: [string, number | null][] = [
    [s.msciWorld, benchmark.msciWorld],
    [s.sp500, benchmark.sp500],
    [s.cac40, benchmark.cac40],
  ];
  return [
    `## ${s.benchmark}`, "",
    `| ${s.indicator} | CAGR |`,
    "|---|---|",
    `| ${s.yourPortfolio} | **${cagrCell(benchmark.investCAGR)}** |`,
    ...indices.filter(([, v]) => v !== null).map(([label, v]) => `| ${label} | ${cagrCell(v!)} |`),
    "",
  ];
};

const renderRadar: Renderer = (data, s) => [
  `## ${s.radar}`, "",
  `| ${s.indicator} | ${s.value} |`,
  "|---|---|",
  `| ${s.safeVsRisky} | ${s.safe} ${fmt(data.garantisCents)} (${data.garantisPct}%) · ${s.risky} ${fmt(data.risquesCents)} (${100 - data.garantisPct}%) |`,
  "",
];

function topAssetTaxCell(taxCents: number | null): string {
  if (taxCents === null) return "-";
  return taxCents > 0 ? `-${fmt(taxCents)}` : fmt(0);
}

const renderTopAssets: Renderer = (data, s) => {
  if (data.topAssets.length === 0) return [];
  return [
    `## ${s.topAssets}`, "",
    `| ${s.colAsset} | ${s.category} | ${s.colValue} | ${s.colGain} | ${s.colTax} | ${s.pct} |`,
    "|---|---|---|---|---|---|",
    ...data.topAssets.map((a) => {
      const gainStr = a.gainCents !== null ? `${sign(a.gainCents)}${fmt(a.gainCents)}` : "-";
      return `| ${labelWithSubtype(a.name, a.subtype)} | ${a.typeLabel} | ${fmt(a.valueCents)} | ${gainStr} | ${topAssetTaxCell(a.taxCents)} | ${a.pct}% |`;
    }),
    "",
  ];
};

const renderFinancing: Renderer = (data, s) => {
  if (data.debtAccounts.length === 0) return [];
  return [
    `## ${s.financing}`, "",
    `| ${s.indicator} | ${s.value} |`,
    "|---|---|",
    `| ${s.totalLiabilities} | ${fmt(data.totalLiabilities)} |`,
    `| ${s.debtRatio} | ${data.debtRatio}% |`,
    `| ${s.equity} | ${fmt(data.grossAssets - data.totalLiabilities)} |`,
    "",
    `| ${s.colAsset} | ${s.colValue} | ${s.colLoan} | ${s.colEquity} | ${s.colLtv} |`,
    "|---|---|---|---|---|",
    ...data.debtAccounts.map(
      (a) => `| ${a.name} | ${fmt(a.valueCents)} | ${fmt(a.liabilityCents)} | ${fmt(a.equityCents)} | ${a.ltv}% |`
    ),
    "",
  ];
};

const renderHistory: Renderer = (data, s) => {
  if (data.performanceRows.length === 0) return [];
  return [
    `## ${s.history}`, "",
    `| ${s.colMonth} | ${s.colNetWorth} | ${s.colChange} | ${s.pct} |`,
    "|---|---|---|---|",
    ...data.performanceRows.map((r) => {
      const delta = r.delta !== null ? `${sign(r.delta)}${fmt(r.delta)}` : "-";
      const deltaPct = r.deltaPct !== null ? `${signedFixed(r.deltaPct)}%` : "-";
      return `| ${r.date} | ${fmt(r.netWorth)} | ${delta} | ${deltaPct} |`;
    }),
    "",
  ];
};

// Document order. A Section missing here would never print; the type makes
// adding one to the union without a renderer a compile error.
const RENDERERS: Record<Section, Renderer> = {
  resume: renderSummary,
  allocation: renderAllocation,
  performance: renderPerformance,
  dividendes: renderPassive,
  revenusReels: renderRealIncome,
  benchmark: renderBenchmark,
  radar: renderRadar,
  topActifs: renderTopAssets,
  financement: renderFinancing,
  historique: renderHistory,
};

export function buildMarkdown(
  data: AnalyticsExportData,
  sections: Set<Section>,
  s: AnalyticsExportStrings,
  intlLocale: string
): string {
  const date = new Date().toLocaleDateString(intlLocale, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const body = (Object.keys(RENDERERS) as Section[])
    .filter((section) => sections.has(section))
    .flatMap((section) => RENDERERS[section](data, s, intlLocale));
  return [`# ${s.title} - ${date}`, "", ...body].join("\n");
}
