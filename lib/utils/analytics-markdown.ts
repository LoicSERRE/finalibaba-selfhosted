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

// Same rationale as export-accounts-button.tsx's buildMarkdown - one
// function per every toggleable section keeps it directly, mechanically
// checkable against __tests__/export-completeness.test.ts.
// eslint-disable-next-line sonarjs/cognitive-complexity
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
  const lines: string[] = [`# ${s.title} - ${date}`, ""];

  // ── Global summary ──
  if (sections.has("resume")) {
    lines.push(`## ${s.summary}`, "");
    lines.push(`| ${s.indicator} | ${s.value} |`);
    lines.push("|---|---|");
    // data.netWorth is already net of latent tax; the label only says so
    // explicitly when there is a deduction to speak of.
    const netLabel = data.hasTaxData ? s.netWorthAfterTax : s.netWorth;
    lines.push(`| ${netLabel} | **${fmt(data.netWorth)}** |`);
    lines.push(`| ${s.gross} | ${fmt(data.grossAssets)} |`);
    lines.push(`| ${s.debts} | ${fmt(data.totalLiabilities)} |`);
    if (data.hasTaxData) {
      lines.push(`| ${s.taxes} | ${fmt(data.totalLatentTax)} |`);
      lines.push(`| ${s.netWorth} | ${fmt(data.netWorthBeforeTax)} |`);
    }
    lines.push(`| ${s.investedRate} | ${data.investedPct}% |`);
    if (data.savingsRate !== null) {
      lines.push(
        `| ${s.savingsRate} | ${sign(data.savingsRate)}${data.savingsRate.toFixed(1)}% |`
      );
    }
    if (data.salaryNetCents > 0) {
      lines.push(`| ${s.salary} | ${fmt(data.salaryNetCents)} |`);
    }
    if (data.monthlySavedCents > 0) {
      lines.push(`| ${s.monthlySaved} | ${fmt(data.monthlySavedCents)} |`);
    } else if (data.momDeltaCents !== null) {
      lines.push(`| ${s.momDelta} | ${sign(data.momDeltaCents)}${fmt(data.momDeltaCents)} |`);
    }
    if (data.runwayMonths !== null) {
      lines.push(`| ${s.runway} | ${Math.floor(data.runwayMonths)} ${s.months} |`);
      lines.push(`| ${s.savingsAvailable} | ${fmt(data.savingsCents)} |`);
      lines.push(`| ${s.monthlyExpenses} | ${fmt(data.monthlyExpensesCents)} |`);
    }
    for (const goal of data.goals) {
      lines.push(`| ${s.goal} - ${goal.name} | ${s.goalFmt(fmt(goal.targetCents), goal.pct)} |`);
      if (goal.remainingCents > 0) {
        lines.push(`| ${s.goalRemaining} - ${goal.name} | ${fmt(goal.remainingCents)} |`);
      }
    }
    lines.push("");
  }

  // ── Allocation ──
  if (sections.has("allocation") && data.allocationSlices.length > 0) {
    lines.push(`## ${s.allocation}`, "");
    lines.push(`| ${s.category} | ${s.value} | ${s.pct} |`);
    lines.push("|---|---|---|");
    for (const slice of data.allocationSlices) {
      lines.push(`| ${slice.name} | ${fmt(slice.valueCents)} | ${slice.pct}% |`);
    }
    lines.push("");
  }

  // ── Performance investissements ──
  if (sections.has("performance") && data.investPerfRows.length > 0) {
    lines.push(`## ${s.performance}`, "");
    lines.push(
      `| ${s.colAccount} | ${s.colValue} | ${s.colInvested} | ${s.colGrossGain} | ${s.colTax} | ${s.colPerf} |`
    );
    lines.push("|---|---|---|---|---|---|");
    for (const r of data.investPerfRows) {
      const label = r.subtype ? `${r.name} (${r.subtype})` : r.name;
      lines.push(
        `| ${label} | ${fmt(r.valueCents)} | ${fmt(r.costBasisCents)} | ${sign(r.gainCents)}${fmt(r.gainCents)} | -${fmt(r.taxCents)} | ${sign(r.returnPct)}${r.returnPct.toFixed(1)}% |`
      );
    }
    lines.push("");
    const netGain = data.investTotalGainCents - data.investTotalTaxCents;
    const cagrSuffix =
      data.investCAGR !== null
        ? s.cagrSuffix(`${sign(data.investCAGR)}${data.investCAGR.toFixed(1)}`)
        : "";
    lines.push(
      s.summaryLine({
        invested: fmt(data.investTotalCostBasisCents),
        value: fmt(data.investTotalValueCents),
        gain: `${sign(data.investTotalGainCents)}${fmt(data.investTotalGainCents)}`,
        netGain: `${sign(netGain)}${fmt(netGain)}`,
        perf: `${sign(data.investReturnPct)}${data.investReturnPct.toFixed(1)}`,
        cagr: cagrSuffix,
      })
    );
    lines.push("");
  }

  // ── Revenus passifs & dividendes ──
  if (sections.has("dividendes") && data.annualPassiveCents > 0) {
    lines.push(`## ${s.passive}`, "");
    lines.push(
      s.passiveLine({
        annual: fmt(data.annualPassiveCents),
        monthly: fmt(data.monthlyPassiveCents),
        dividends: fmt(data.annualDividendsCents),
        interest: fmt(data.annualInterestCents),
      })
    );
    // A document someone plans with must not quietly under-report. The
    // interest half of this figure only counts accounts whose rate is set,
    // and an unset rate is invisible everywhere else in the app - so if any
    // are missing, the export says so rather than presenting a partial total
    // as a complete one.
    if (data.accountsMissingInterestRate > 0) {
      lines.push("", `> ${s.passiveMissingRates({ count: data.accountsMissingInterestRate })}`);
    }
    if (data.weightedSavingsRatePct !== null) {
      lines.push("", s.passiveWeightedRate({ rate: (data.weightedSavingsRatePct * 100).toFixed(2) }));
    }
    if (data.estimatedYearEndSavingsInterestCents > 0) {
      lines.push("", s.passiveYearEndEstimate({ amount: fmt(data.estimatedYearEndSavingsInterestCents) }));
    }
    lines.push("");
    if (data.dividendRows.length > 0) {
      lines.push(
        `| ${s.colAsset} | ${s.colEnvelope} | ${s.colYield} | ${s.colAnnualGross} | ${s.colAnnualNet} | ${s.colExDiv} |`
      );
      lines.push("|---|---|---|---|---|---|");
      for (const r of data.dividendRows) {
        const envelope = r.subtype ?? "CTO";
        const yieldStr = `${(r.divYield * 100).toFixed(2)}%`;
        const exDiv = r.exDividendDate
          ? new Date(r.exDividendDate).toLocaleDateString(intlLocale, {
              day: "numeric",
              month: "short",
              year: "numeric",
            })
          : "-";
        lines.push(
          `| ${r.name} | ${envelope} | ${yieldStr} | ${fmt(r.annualEstCents)} | ${fmt(r.annualNetCents)} | ${exDiv} |`
        );
      }
      lines.push("");
    }
  }

  // ── Revenus réels perçus (IncomeEvent, année en cours) ──
  if (sections.has("revenusReels") && data.realYtdPassiveNetCents > 0) {
    lines.push(`## ${s.realIncome}`, "");
    lines.push(`| ${s.indicator} | ${s.value} |`);
    lines.push("|---|---|");
    lines.push(`| ${s.ytdDividends} | ${fmt(data.realYtdDividendsNetCents)} |`);
    lines.push(`| ${s.ytdInterest} | ${fmt(data.realYtdInterestNetCents)} |`);
    lines.push(`| ${s.ytdTotal} | **${fmt(data.realYtdPassiveNetCents)}** |`);
    lines.push("");
  }

  // ── Comparaison aux indices ──
  if (sections.has("benchmark") && data.benchmark !== null) {
    lines.push(`## ${s.benchmark}`, "");
    lines.push(`| ${s.indicator} | CAGR |`);
    lines.push("|---|---|");
    const cagrCell = (v: number) => `${sign(v)}${v.toFixed(1)}%`;
    lines.push(`| ${s.yourPortfolio} | **${cagrCell(data.benchmark.investCAGR)}** |`);
    if (data.benchmark.msciWorld !== null) lines.push(`| ${s.msciWorld} | ${cagrCell(data.benchmark.msciWorld)} |`);
    if (data.benchmark.sp500 !== null) lines.push(`| ${s.sp500} | ${cagrCell(data.benchmark.sp500)} |`);
    if (data.benchmark.cac40 !== null) lines.push(`| ${s.cac40} | ${cagrCell(data.benchmark.cac40)} |`);
    lines.push("");
  }

  // ── Radar d'allocation ──
  if (sections.has("radar")) {
    lines.push(`## ${s.radar}`, "");
    lines.push(`| ${s.indicator} | ${s.value} |`);
    lines.push("|---|---|");
    lines.push(`| ${s.safeVsRisky} | ${s.safe} ${fmt(data.garantisCents)} (${data.garantisPct}%) · ${s.risky} ${fmt(data.risquesCents)} (${100 - data.garantisPct}%) |`);
    lines.push("");
  }

  // ── Mes actifs (top 10) ──
  if (sections.has("topActifs") && data.topAssets.length > 0) {
    lines.push(`## ${s.topAssets}`, "");
    lines.push(`| ${s.colAsset} | ${s.category} | ${s.colValue} | ${s.colGain} | ${s.colTax} | ${s.pct} |`);
    lines.push("|---|---|---|---|---|---|");
    for (const a of data.topAssets) {
      const label = a.subtype ? `${a.name} (${a.subtype})` : a.name;
      const gainStr = a.gainCents !== null ? `${sign(a.gainCents)}${fmt(a.gainCents)}` : "-";
      let taxStr = "-";
      if (a.taxCents !== null) taxStr = a.taxCents > 0 ? `-${fmt(a.taxCents)}` : fmt(0);
      lines.push(`| ${label} | ${a.typeLabel} | ${fmt(a.valueCents)} | ${gainStr} | ${taxStr} | ${a.pct}% |`);
    }
    lines.push("");
  }

  // ── Analyse du financement ──
  if (sections.has("financement") && data.debtAccounts.length > 0) {
    lines.push(`## ${s.financing}`, "");
    lines.push(`| ${s.indicator} | ${s.value} |`);
    lines.push("|---|---|");
    lines.push(`| ${s.totalLiabilities} | ${fmt(data.totalLiabilities)} |`);
    lines.push(`| ${s.debtRatio} | ${data.debtRatio}% |`);
    lines.push(`| ${s.equity} | ${fmt(data.grossAssets - data.totalLiabilities)} |`);
    lines.push("");
    lines.push(`| ${s.colAsset} | ${s.colValue} | ${s.colLoan} | ${s.colEquity} | ${s.colLtv} |`);
    lines.push("|---|---|---|---|---|");
    for (const a of data.debtAccounts) {
      lines.push(`| ${a.name} | ${fmt(a.valueCents)} | ${fmt(a.liabilityCents)} | ${fmt(a.equityCents)} | ${a.ltv}% |`);
    }
    lines.push("");
  }

  // ── Historique mensuel ──
  if (sections.has("historique") && data.performanceRows.length > 0) {
    lines.push(`## ${s.history}`, "");
    lines.push(`| ${s.colMonth} | ${s.colNetWorth} | ${s.colChange} | ${s.pct} |`);
    lines.push("|---|---|---|---|");
    for (const r of data.performanceRows) {
      const delta = r.delta !== null ? `${sign(r.delta)}${fmt(r.delta)}` : "-";
      const deltaPct =
        r.deltaPct !== null ? `${sign(r.deltaPct)}${r.deltaPct.toFixed(1)}%` : "-";
      lines.push(`| ${r.date} | ${fmt(r.netWorth)} | ${delta} | ${deltaPct} |`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

