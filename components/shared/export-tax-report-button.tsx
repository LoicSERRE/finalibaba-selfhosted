"use client";

import { Download } from "lucide-react";
import { downloadFile } from "@/lib/utils/markdown-export";
import { buildTaxReportMarkdown } from "@/lib/utils/tax-report-markdown";
import type { TaxReportExportData } from "@/lib/domain/tax-report-export";
import { localeToIntl } from "@/lib/utils/format";
import { useLocale, useTranslations } from "next-intl";

export function ExportTaxReportButton({ data }: Readonly<{ data: TaxReportExportData }>) {
  const t = useTranslations("taxReport");
  const intlLocale = localeToIntl(useLocale());

  function handleExport() {
    const md = buildTaxReportMarkdown(
      data,
      {
        title: t("title"),
        summary: t("mdSummary"),
        indicator: t("mdIndicator"),
        value: t("mdValue"),
        realizedGains: t("realizedGains"),
        estimatedTaxOnGains: t("estimatedTaxOnGains"),
        dividendsGross: t("dividendsGross"),
        dividendsNet: t("dividendsNet"),
        interestGross: t("interestGross"),
        interestNet: t("interestNet"),
        dividendIncome: t("dividendIncome"),
        interestIncome: t("interestIncome"),
        colDate: t("colDate"),
        colTicker: t("colTicker"),
        colAccount: t("colAccount"),
        colProceeds: t("colProceeds"),
        colCostBasis: t("colCostBasis"),
        colGain: t("colGain"),
        colTax: t("colTax"),
        colValue: t("colValue"),
      },
      intlLocale
    );
    downloadFile(md, t("mdFileName", { year: String(data.year) }));
  }

  return (
    <button
      type="button"
      onClick={handleExport}
      className="flex cursor-pointer items-center gap-1.5 px-3 py-1.5 min-h-[44px] text-sm text-[var(--muted)] border border-[var(--border)] rounded-lg hover:text-[var(--foreground)] hover:border-[var(--accent)]/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]"
    >
      <Download size={14} aria-hidden="true" />
      {t("export")}
    </button>
  );
}
