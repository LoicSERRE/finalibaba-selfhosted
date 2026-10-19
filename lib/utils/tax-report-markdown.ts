/**
 * The tax-report markdown document. Pure: data in, one string out.
 *
 * Split out of components/shared/export-tax-report-button.tsx at v2.12.5,
 * where it could not be tested and printed every figure as fr-FR whatever
 * the UI language. The summary rounds to whole euros like the page's own
 * summary cards; every detail row keeps two decimals, as the page's tables
 * do - this is the one export meant to be declared, and a 0,46 EUR dividend
 * once rendered as "0 €" here (see __tests__/markdown-export.test.ts).
 */
import { exportFormat } from "@/lib/utils/markdown-export";
import type { TaxReportExportData } from "@/lib/domain/tax-report-export";

export type TaxReportStrings = {
  title: string;
  summary: string;
  indicator: string;
  value: string;
  realizedGains: string;
  estimatedTaxOnGains: string;
  dividendsGross: string;
  dividendsNet: string;
  interestGross: string;
  interestNet: string;
  dividendIncome: string;
  interestIncome: string;
  colDate: string;
  colTicker: string;
  colAccount: string;
  colProceeds: string;
  colCostBasis: string;
  colGain: string;
  colTax: string;
  colValue: string;
};

export function buildTaxReportMarkdown(data: TaxReportExportData, s: TaxReportStrings, intlLocale: string): string {
  const f = exportFormat(intlLocale);
  const lines: string[] = [`# ${s.title} ${data.year}`, ""];

  lines.push(`## ${s.summary}`, "");
  lines.push(`| ${s.indicator} | ${s.value} |`);
  lines.push("|---|---|");
  lines.push(`| ${s.realizedGains} | ${f.signedMoney(data.totalRealizedGainCents)} |`);
  lines.push(`| ${s.estimatedTaxOnGains} | -${f.money(data.totalGainTaxCents)} |`);
  lines.push(`| ${s.dividendsGross} | ${f.money(data.totalDividendsGrossCents)} |`);
  lines.push(`| ${s.dividendsNet} | ${f.money(data.totalDividendsNetCents)} |`);
  lines.push(`| ${s.interestGross} | ${f.money(data.totalInterestGrossCents)} |`);
  lines.push(`| ${s.interestNet} | ${f.money(data.totalInterestNetCents)} |`);
  lines.push("");

  if (data.sales.length > 0) {
    lines.push(`## ${s.realizedGains}`, "");
    lines.push(`| ${s.colDate} | ${s.colTicker} | ${s.colAccount} | ${s.colProceeds} | ${s.colCostBasis} | ${s.colGain} | ${s.colTax} |`);
    lines.push("|---|---|---|---|---|---|---|");
    for (const sale of data.sales) {
      lines.push(
        `| ${sale.date} | ${sale.ticker} | ${sale.accountName} | ${f.money(sale.proceedsCents, 2)} | ${f.money(sale.costBasisCents, 2)} | ${f.signedMoney(sale.gainCents, 2)} | -${f.money(sale.taxCents, 2)} |`
      );
    }
    lines.push("");
  }

  if (data.dividends.length > 0) {
    lines.push(`## ${s.dividendIncome}`, "");
    lines.push(`| ${s.colDate} | ${s.colTicker} | ${s.colAccount} | ${s.colValue} |`);
    lines.push("|---|---|---|---|");
    for (const e of data.dividends) {
      lines.push(`| ${e.date} | ${e.ticker ?? "-"} | ${e.accountName} | ${f.money(e.netCents, 2)} |`);
    }
    lines.push("");
  }

  if (data.interest.length > 0) {
    lines.push(`## ${s.interestIncome}`, "");
    lines.push(`| ${s.colDate} | ${s.colAccount} | ${s.colValue} |`);
    lines.push("|---|---|---|");
    for (const e of data.interest) {
      lines.push(`| ${e.date} | ${e.accountName} | ${f.money(e.netCents, 2)} |`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
