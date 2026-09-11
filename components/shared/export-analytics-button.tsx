"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { downloadFile } from "@/lib/utils/markdown-export";
import { localeToIntl } from "@/lib/utils/format";
import { useTranslations, useLocale } from "next-intl";
import type { AnalyticsExportData } from "@/lib/domain/analytics-export";
import { buildMarkdown, type Section, type AnalyticsExportStrings } from "@/lib/utils/analytics-markdown";

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
      passiveMissingRates: (params) => t("mdPassiveMissingRates", params),
      passiveWeightedRate: (params) => t("mdPassiveWeightedRate", params),
      passiveYearEndEstimate: (params) => t("mdPassiveYearEndEstimate", params),
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
