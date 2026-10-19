/**
 * The analytics markdown document. Pure: data in, one string out.
 *
 * Split out of components/shared/export-analytics-button.tsx at v2.10.3, where
 * 639 lines were 230 of string building, 120 of type declarations and a button.
 * Those types moved to lib/domain/analytics-export.ts, which returns them -
 * lib/ was importing them back out of a component, the wrong way round.
 */
import { exportFormat, nameMentions, type ExportFormat } from "@/lib/utils/markdown-export";
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
  goalFmt: (amount: string, pct: string) => string;
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

type Renderer = (data: AnalyticsExportData, s: AnalyticsExportStrings, f: ExportFormat) => string[];

function summaryCashFlowRows(data: AnalyticsExportData, s: AnalyticsExportStrings, f: ExportFormat): string[] {
  const rows: string[] = [];
  if (data.savingsRate !== null) {
    rows.push(`| ${s.savingsRate} | ${f.signedPct(data.savingsRate, 1)} |`);
  }
  if (data.salaryNetCents > 0) rows.push(`| ${s.salary} | ${f.money(data.salaryNetCents)} |`);
  // Declared monthly savings win over the month-on-month delta, which is
  // distorted by transfers and market moves.
  if (data.monthlySavedCents > 0) {
    rows.push(`| ${s.monthlySaved} | ${f.money(data.monthlySavedCents)} |`);
  } else if (data.momDeltaCents !== null) {
    rows.push(`| ${s.momDelta} | ${f.signedMoney(data.momDeltaCents)} |`);
  }
  if (data.runwayMonths !== null) {
    rows.push(`| ${s.runway} | ${Math.floor(data.runwayMonths)} ${s.months} |`);
    rows.push(`| ${s.savingsAvailable} | ${f.money(data.savingsCents)} |`);
    rows.push(`| ${s.monthlyExpenses} | ${f.money(data.monthlyExpensesCents)} |`);
  }
  return rows;
}

function summaryGoalRows(data: AnalyticsExportData, s: AnalyticsExportStrings, f: ExportFormat): string[] {
  return data.goals.flatMap((goal) => {
    const rows = [`| ${s.goal} - ${goal.name} | ${s.goalFmt(f.money(goal.targetCents), f.pct(goal.pct))} |`];
    if (goal.remainingCents > 0) rows.push(`| ${s.goalRemaining} - ${goal.name} | ${f.money(goal.remainingCents)} |`);
    return rows;
  });
}

const renderSummary: Renderer = (data, s, f) => {
  // data.netWorth is already net of latent tax; the label only says so
  // explicitly when there is a deduction to speak of.
  const netLabel = data.hasTaxData ? s.netWorthAfterTax : s.netWorth;
  const taxRows = data.hasTaxData
    ? [`| ${s.taxes} | ${f.money(data.totalLatentTax)} |`, `| ${s.netWorth} | ${f.money(data.netWorthBeforeTax)} |`]
    : [];
  return [
    `## ${s.summary}`, "",
    `| ${s.indicator} | ${s.value} |`,
    "|---|---|",
    `| ${netLabel} | **${f.money(data.netWorth)}** |`,
    `| ${s.gross} | ${f.money(data.grossAssets)} |`,
    `| ${s.debts} | ${f.money(data.totalLiabilities)} |`,
    ...taxRows,
    `| ${s.investedRate} | ${f.pct(data.investedPct)} |`,
    ...summaryCashFlowRows(data, s, f),
    ...summaryGoalRows(data, s, f),
    "",
  ];
};

const renderAllocation: Renderer = (data, s, f) => {
  if (data.allocationSlices.length === 0) return [];
  return [
    `## ${s.allocation}`, "",
    `| ${s.category} | ${s.value} | ${s.pct} |`,
    "|---|---|---|",
    ...data.allocationSlices.map((slice) => `| ${slice.name} | ${f.money(slice.valueCents)} | ${f.pct(slice.pct)} |`),
    "",
  ];
};

function labelWithSubtype(name: string, subtype: string | null): string {
  return subtype && !nameMentions(name, subtype) ? `${name} (${subtype})` : name;
}

function performanceSummaryLine(data: AnalyticsExportData, s: AnalyticsExportStrings, f: ExportFormat): string {
  const netGain = data.investTotalGainCents - data.investTotalTaxCents;
  const cagrSuffix = data.investCAGR !== null ? s.cagrSuffix(f.signedPct(data.investCAGR, 1)) : "";
  return s.summaryLine({
    invested: f.money(data.investTotalCostBasisCents),
    value: f.money(data.investTotalValueCents),
    gain: f.signedMoney(data.investTotalGainCents),
    netGain: f.signedMoney(netGain),
    perf: f.signedPct(data.investReturnPct, 1),
    cagr: cagrSuffix,
  });
}

const renderPerformance: Renderer = (data, s, f) => {
  if (data.investPerfRows.length === 0) return [];
  return [
    `## ${s.performance}`, "",
    `| ${s.colAccount} | ${s.colValue} | ${s.colInvested} | ${s.colGrossGain} | ${s.colTax} | ${s.colPerf} |`,
    "|---|---|---|---|---|---|",
    ...data.investPerfRows.map(
      (r) =>
        `| ${labelWithSubtype(r.name, r.subtype)} | ${f.money(r.valueCents)} | ${f.money(r.costBasisCents)} | ${f.signedMoney(r.gainCents)} | -${f.money(r.taxCents)} | ${f.signedPct(r.returnPct, 1)} |`
    ),
    "",
    performanceSummaryLine(data, s, f),
    "",
  ];
};

// A document someone plans with must not quietly under-report. The interest
// half of the passive figure only counts accounts whose rate is set, and an
// unset rate is invisible everywhere else in the app - so if any are missing,
// the export says so rather than presenting a partial total as a complete one.
function passiveNotes(data: AnalyticsExportData, s: AnalyticsExportStrings, f: ExportFormat): string[] {
  const notes: string[] = [];
  if (data.accountsMissingInterestRate > 0) {
    notes.push("", `> ${s.passiveMissingRates({ count: data.accountsMissingInterestRate })}`);
  }
  if (data.weightedSavingsRatePct !== null) {
    notes.push("", s.passiveWeightedRate({ rate: f.pct(data.weightedSavingsRatePct * 100, 2) }));
  }
  if (data.estimatedYearEndSavingsInterestCents > 0) {
    notes.push("", s.passiveYearEndEstimate({ amount: f.money(data.estimatedYearEndSavingsInterestCents) }));
  }
  return notes;
}

function exDividendCell(date: AnalyticsExportData["dividendRows"][number]["exDividendDate"], f: ExportFormat): string {
  if (!date) return "-";
  return f.shortDate(new Date(date));
}

function dividendTable(data: AnalyticsExportData, s: AnalyticsExportStrings, f: ExportFormat): string[] {
  if (data.dividendRows.length === 0) return [];
  return [
    `| ${s.colAsset} | ${s.colEnvelope} | ${s.colYield} | ${s.colAnnualGross} | ${s.colAnnualNet} | ${s.colExDiv} |`,
    "|---|---|---|---|---|---|",
    ...data.dividendRows.map(
      (r) =>
        `| ${r.name} | ${r.subtype ?? "CTO"} | ${f.pct(r.divYield * 100, 2)} | ${f.money(r.annualEstCents)} | ${f.money(r.annualNetCents)} | ${exDividendCell(r.exDividendDate, f)} |`
    ),
    "",
  ];
}

const renderPassive: Renderer = (data, s, f) => {
  if (data.annualPassiveCents <= 0) return [];
  return [
    `## ${s.passive}`, "",
    s.passiveLine({
      annual: f.money(data.annualPassiveCents),
      monthly: f.money(data.monthlyPassiveCents),
      dividends: f.money(data.annualDividendsCents),
      interest: f.money(data.annualInterestCents),
    }),
    ...passiveNotes(data, s, f),
    "",
    ...dividendTable(data, s, f),
  ];
};

const renderRealIncome: Renderer = (data, s, f) => {
  if (data.realYtdPassiveNetCents <= 0) return [];
  return [
    `## ${s.realIncome}`, "",
    `| ${s.indicator} | ${s.value} |`,
    "|---|---|",
    `| ${s.ytdDividends} | ${f.money(data.realYtdDividendsNetCents)} |`,
    `| ${s.ytdInterest} | ${f.money(data.realYtdInterestNetCents)} |`,
    `| ${s.ytdTotal} | **${f.money(data.realYtdPassiveNetCents)}** |`,
    "",
  ];
};

const renderBenchmark: Renderer = (data, s, f) => {
  const benchmark = data.benchmark;
  if (benchmark === null) return [];
  const cagrCell = (v: number) => f.signedPct(v, 1);
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

const renderRadar: Renderer = (data, s, f) => [
  `## ${s.radar}`, "",
  `| ${s.indicator} | ${s.value} |`,
  "|---|---|",
  `| ${s.safeVsRisky} | ${s.safe} ${f.money(data.garantisCents)} (${f.pct(data.garantisPct)}) · ${s.risky} ${f.money(data.risquesCents)} (${f.pct(100 - data.garantisPct)}) |`,
  "",
];

function topAssetTaxCell(taxCents: number | null, f: ExportFormat): string {
  if (taxCents === null) return "-";
  return taxCents > 0 ? `-${f.money(taxCents)}` : f.money(0);
}

const renderTopAssets: Renderer = (data, s, f) => {
  if (data.topAssets.length === 0) return [];
  return [
    `## ${s.topAssets}`, "",
    `| ${s.colAsset} | ${s.category} | ${s.colValue} | ${s.colGain} | ${s.colTax} | ${s.pct} |`,
    "|---|---|---|---|---|---|",
    ...data.topAssets.map((a) => {
      const gainStr = a.gainCents !== null ? f.signedMoney(a.gainCents) : "-";
      return `| ${labelWithSubtype(a.name, a.subtype)} | ${a.typeLabel} | ${f.money(a.valueCents)} | ${gainStr} | ${topAssetTaxCell(a.taxCents, f)} | ${f.pct(a.pct)} |`;
    }),
    "",
  ];
};

const renderFinancing: Renderer = (data, s, f) => {
  if (data.debtAccounts.length === 0) return [];
  return [
    `## ${s.financing}`, "",
    `| ${s.indicator} | ${s.value} |`,
    "|---|---|",
    `| ${s.totalLiabilities} | ${f.money(data.totalLiabilities)} |`,
    `| ${s.debtRatio} | ${f.pct(data.debtRatio)} |`,
    `| ${s.equity} | ${f.money(data.grossAssets - data.totalLiabilities)} |`,
    "",
    `| ${s.colAsset} | ${s.colValue} | ${s.colLoan} | ${s.colEquity} | ${s.colLtv} |`,
    "|---|---|---|---|---|",
    ...data.debtAccounts.map(
      (a) => `| ${a.name} | ${f.money(a.valueCents)} | ${f.money(a.liabilityCents)} | ${f.money(a.equityCents)} | ${f.pct(a.ltv)} |`
    ),
    "",
  ];
};

const renderHistory: Renderer = (data, s, f) => {
  if (data.performanceRows.length === 0) return [];
  return [
    `## ${s.history}`, "",
    `| ${s.colMonth} | ${s.colNetWorth} | ${s.colChange} | ${s.pct} |`,
    "|---|---|---|---|",
    ...data.performanceRows.map((r) => {
      const delta = r.delta !== null ? f.signedMoney(r.delta) : "-";
      const deltaPct = r.deltaPct !== null ? f.signedPct(r.deltaPct, 1) : "-";
      return `| ${r.date} | ${f.money(r.netWorth)} | ${delta} | ${deltaPct} |`;
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
  const f = exportFormat(intlLocale);
  const body = (Object.keys(RENDERERS) as Section[])
    .filter((section) => sections.has(section))
    .flatMap((section) => RENDERERS[section](data, s, f));
  return [`# ${s.title} - ${f.longDate(new Date())}`, "", ...body].join("\n");
}
