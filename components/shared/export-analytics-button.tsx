"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { fmt, sign, downloadFile } from "@/lib/utils/markdown-export";
import { localeToIntl } from "@/lib/utils/format";
import { useTranslations, useLocale } from "next-intl";

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
  netWorthAfterTax: number;
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

// ── Sections ──────────────────────────────────────────────────────────────────

type Section =
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

interface AnalyticsExportStrings {
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
}

// ── Markdown generation ───────────────────────────────────────────────────────

// Same rationale as export-accounts-button.tsx's buildMarkdown - one
// function per every toggleable section keeps it directly, mechanically
// checkable against __tests__/export-completeness.test.ts.
// eslint-disable-next-line sonarjs/cognitive-complexity
function buildMarkdown(
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
    const netLabel = data.hasTaxData ? s.netWorthAfterTax : s.netWorth;
    lines.push(
      `| ${netLabel} | **${fmt(data.hasTaxData ? data.netWorthAfterTax : data.netWorth)}** |`
    );
    lines.push(`| ${s.gross} | ${fmt(data.grossAssets)} |`);
    lines.push(`| ${s.debts} | ${fmt(data.totalLiabilities)} |`);
    if (data.hasTaxData) {
      lines.push(`| ${s.taxes} | ${fmt(data.totalLatentTax)} |`);
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
      const taxStr = a.taxCents !== null ? (a.taxCents > 0 ? `-${fmt(a.taxCents)}` : fmt(0)) : "-";
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

// ── Component ─────────────────────────────────────────────────────────────────

export function ExportAnalyticsButton({ data }: Readonly<{ data: AnalyticsExportData }>) {
  const t = useTranslations("exportAnalytics");
  const intlLocale = localeToIntl(useLocale());

  const sections = [
    { id: "resume" as const, label: t("sectionSummary") },
    { id: "allocation" as const, label: t("sectionAllocation") },
    { id: "performance" as const, label: t("sectionPerformance") },
    { id: "dividendes" as const, label: t("sectionDividends") },
    { id: "revenusReels" as const, label: t("sectionRealIncome") },
    { id: "benchmark" as const, label: t("sectionBenchmark") },
    { id: "radar" as const, label: t("sectionRadar") },
    { id: "topActifs" as const, label: t("sectionTopAssets") },
    { id: "financement" as const, label: t("sectionFinancing") },
    { id: "historique" as const, label: t("sectionHistory") },
  ] satisfies { id: Section; label: string }[];

  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<Section>>(
    new Set(sections.map((s) => s.id))
  );

  const allSelected = sections.every((s) => selected.has(s.id));

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(sections.map((s) => s.id)));
  }

  function toggle(id: Section) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function handleExport() {
    const s: AnalyticsExportStrings = {
      title: t("mdTitle"),
      summary: t("mdSummary"),
      allocation: t("mdAllocation"),
      performance: t("mdPerformance"),
      passive: t("mdPassive"),
      realIncome: t("sectionRealIncome"),
      benchmark: t("sectionBenchmark"),
      radar: t("sectionRadar"),
      topAssets: t("sectionTopAssets"),
      financing: t("sectionFinancing"),
      history: t("mdHistory"),
      netWorthAfterTax: t("mdNetWorthAfterTax"),
      netWorth: t("mdNetWorth"),
      gross: t("mdGross"),
      debts: t("mdDebts"),
      taxes: t("mdTaxes"),
      investedRate: t("mdInvestedRate"),
      savingsRate: t("mdSavingsRate"),
      salary: t("mdSalary"),
      monthlySaved: t("mdMonthlySaved"),
      momDelta: t("mdMomDelta"),
      runway: t("mdRunway"),
      savingsAvailable: t("mdSavingsAvailable"),
      monthlyExpenses: t("mdMonthlyExpenses"),
      goal: t("mdGoal"),
      goalRemaining: t("mdGoalRemaining"),
      indicator: t("mdIndicator"),
      value: t("mdValue"),
      category: t("mdCategory"),
      pct: t("mdPct"),
      colAccount: t("mdColAccount"),
      colInvested: t("mdColInvested"),
      colValue: t("mdColValue"),
      colGrossGain: t("mdColGrossGain"),
      colTax: t("mdColTax"),
      colPerf: t("mdColPerf"),
      colNetWorth: t("mdColNetWorth"),
      colChange: t("mdColChange"),
      colAsset: t("mdColAsset"),
      colEnvelope: t("mdColEnvelope"),
      colYield: t("mdColYield"),
      colAnnualGross: t("mdColAnnualGross"),
      colAnnualNet: t("mdColAnnualNet"),
      colExDiv: t("mdColExDiv"),
      colMonth: t("mdColMonth"),
      colGain: t("mdColGain"),
      colLoan: t("mdColLoan"),
      colEquity: t("mdEquity"),
      colLtv: t("mdColLtv"),
      months: t("mdMonths"),
      ytdDividends: t("mdYtdDividends"),
      ytdInterest: t("mdYtdInterest"),
      ytdTotal: t("mdYtdTotal"),
      yourPortfolio: t("mdYourPortfolio"),
      msciWorld: t("mdMsciWorld"),
      sp500: t("mdSp500"),
      cac40: t("mdCac40"),
      safeVsRisky: t("mdSafeVsRisky"),
      safe: t("mdSafe"),
      risky: t("mdRisky"),
      totalLiabilities: t("mdTotalLiabilities"),
      debtRatio: t("mdDebtRatio"),
      equity: t("mdEquity"),
      goalFmt: (amount, pct) => t("mdGoalFmt", { amount, pct }),
      summaryLine: (params) => t("mdSummaryLine", params),
      cagrSuffix: (cagr) => t("mdCagrSuffix", { cagr }),
      passiveLine: (params) => t("mdPassiveLine", params),
    };
    const md = buildMarkdown(data, selected, s, intlLocale);
    downloadFile(md, "analytique");
    setOpen(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title={t("title")}
      trigger={
        <button type="button" className="flex cursor-pointer items-center gap-1.5 px-3 py-1.5 min-h-[44px] text-sm text-[var(--muted)] border border-[var(--border)] rounded-lg hover:text-[var(--foreground)] hover:border-[var(--accent)]/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]">
          <Download size={14} aria-hidden="true" />
          {t("button")}
        </button>
      }
    >
      <div className="space-y-4">
        {/* Section list */}
        <div className="space-y-3">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleAll}
              className="w-4 h-4 rounded accent-[var(--accent)]"
            />
            <span className="text-sm font-medium text-[var(--foreground)]">
              {t("selectAll")}
            </span>
          </label>
          <div className="border-t border-[var(--border)]" />
          {sections.map((s) => (
            <label key={s.id} className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={selected.has(s.id)}
                onChange={() => toggle(s.id)}
                className="w-4 h-4 rounded accent-[var(--accent)]"
              />
              <span className="text-sm text-[var(--foreground)]">{s.label}</span>
            </label>
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--border)]">
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            {t("cancel")}
          </Button>
          <Button type="button" onClick={handleExport} disabled={selected.size === 0}>
            <Download size={14} aria-hidden="true" />
            {t("export")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
