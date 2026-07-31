"use client";

import { Download } from "lucide-react";
import { fmt, sign, downloadFile } from "@/lib/utils/markdown-export";
import { useTranslations } from "next-intl";

export type TaxReportExportData = {
  year: number;
  totalRealizedGainCents: number;
  totalGainTaxCents: number;
  totalDividendsGrossCents: number;
  totalDividendsNetCents: number;
  totalInterestGrossCents: number;
  totalInterestNetCents: number;
  sales: {
    ticker: string;
    accountName: string;
    date: string;
    proceedsCents: number;
    costBasisCents: number;
    gainCents: number;
    taxCents: number;
  }[];
  dividends: { ticker: string | null; accountName: string; date: string; grossCents: number; netCents: number }[];
  interest: { accountName: string; date: string; grossCents: number; netCents: number }[];
};

export function ExportTaxReportButton({ data }: { data: TaxReportExportData }) {
  const t = useTranslations("taxReport");

  function handleExport() {
    const lines: string[] = [`# ${t("title")} ${data.year}`, ""];

    lines.push(`## ${t("mdSummary")}`, "");
    lines.push(`| ${t("mdIndicator")} | ${t("mdValue")} |`);
    lines.push("|---|---|");
    lines.push(`| ${t("realizedGains")} | ${sign(data.totalRealizedGainCents)}${fmt(data.totalRealizedGainCents)} |`);
    lines.push(`| ${t("estimatedTaxOnGains")} | -${fmt(data.totalGainTaxCents)} |`);
    lines.push(`| ${t("dividendsGross")} | ${fmt(data.totalDividendsGrossCents)} |`);
    lines.push(`| ${t("dividendsNet")} | ${fmt(data.totalDividendsNetCents)} |`);
    lines.push(`| ${t("interestGross")} | ${fmt(data.totalInterestGrossCents)} |`);
    lines.push(`| ${t("interestNet")} | ${fmt(data.totalInterestNetCents)} |`);
    lines.push("");

    if (data.sales.length > 0) {
      lines.push(`## ${t("realizedGains")}`, "");
      lines.push(`| ${t("colDate")} | ${t("colTicker")} | ${t("colAccount")} | ${t("colProceeds")} | ${t("colCostBasis")} | ${t("colGain")} | ${t("colTax")} |`);
      lines.push("|---|---|---|---|---|---|---|");
      for (const s of data.sales) {
        lines.push(
          `| ${s.date} | ${s.ticker} | ${s.accountName} | ${fmt(s.proceedsCents)} | ${fmt(s.costBasisCents)} | ${sign(s.gainCents)}${fmt(s.gainCents)} | -${fmt(s.taxCents)} |`
        );
      }
      lines.push("");
    }

    if (data.dividends.length > 0) {
      lines.push(`## ${t("dividendIncome")}`, "");
      lines.push(`| ${t("colDate")} | ${t("colTicker")} | ${t("colAccount")} | ${t("colValue")} |`);
      lines.push("|---|---|---|---|");
      for (const e of data.dividends) {
        lines.push(`| ${e.date} | ${e.ticker ?? "-"} | ${e.accountName} | ${fmt(e.netCents)} |`);
      }
      lines.push("");
    }

    if (data.interest.length > 0) {
      lines.push(`## ${t("interestIncome")}`, "");
      lines.push(`| ${t("colDate")} | ${t("colAccount")} | ${t("colValue")} |`);
      lines.push("|---|---|---|");
      for (const e of data.interest) {
        lines.push(`| ${e.date} | ${e.accountName} | ${fmt(e.netCents)} |`);
      }
      lines.push("");
    }

    downloadFile(lines.join("\n"), `rapport-fiscal-${data.year}`);
  }

  return (
    <button
      onClick={handleExport}
      className="flex cursor-pointer items-center gap-1.5 px-3 py-1.5 min-h-[44px] text-sm text-[var(--muted)] border border-[var(--border)] rounded-lg hover:text-[var(--foreground)] hover:border-[var(--accent)]/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]"
    >
      <Download size={14} aria-hidden="true" />
      {t("export")}
    </button>
  );
}
