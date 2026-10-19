import { describe, expect, it } from "vitest";
import { buildTaxReportMarkdown, type TaxReportStrings } from "@/lib/utils/tax-report-markdown";
import type { TaxReportExportData } from "@/lib/domain/tax-report-export";
import { exportFormat } from "@/lib/utils/markdown-export";

/**
 * The tax-report document, untestable until v2.12.5 moved it out of its
 * button. It is the one export meant to be declared, so what it pins is that
 * small real amounts survive (the 0,46 EUR dividend once printed as "0 €"),
 * that empty sections disappear rather than print an empty table, and that
 * an English report is English in its figures as well as its labels.
 */

const S = new Proxy({} as TaxReportStrings, { get: (_t, prop: string) => prop.toUpperCase() });

const DATA: TaxReportExportData = {
  year: 2026,
  totalRealizedGainCents: 123_456,
  totalGainTaxCents: 37_000,
  totalDividendsGrossCents: 66,
  totalDividendsNetCents: 46,
  totalInterestGrossCents: 10_000,
  totalInterestNetCents: 7_000,
  sales: [{
    ticker: "AAPL", accountName: "CTO", date: "2026-03-04",
    proceedsCents: 150_046, costBasisCents: 100_000, gainCents: -50_046, taxCents: 0,
  }],
  dividends: [{ ticker: null, accountName: "PEA", date: "2026-05-02", grossCents: 66, netCents: 46 }],
  interest: [],
};

const WITH_INTEREST: TaxReportExportData = {
  ...DATA,
  interest: [{ accountName: "Livret A", date: "2026-12-31", grossCents: 1_234, netCents: 1_234 }],
};

describe("the tax report", () => {
  const fr = buildTaxReportMarkdown(DATA, S, "fr-FR");
  const F = exportFormat("fr-FR");

  it("titles the document with its year", () => {
    expect(fr.split("\n")[0]).toBe("# TITLE 2026");
  });

  it("rounds the summary like the page's cards, and keeps cents in every detail row", () => {
    expect(fr).toContain(`| DIVIDENDSNET | ${F.money(46)} |`);
    expect(fr).toContain(`| PEA | ${F.money(46, 2)} |`);
    expect(F.money(46, 2)).not.toBe(F.money(46));
  });

  it("signs a realized gain or loss without doubling the minus", () => {
    expect(fr).toContain(`| REALIZEDGAINS | ${F.signedMoney(123_456)} |`);
    expect(fr).toContain(F.signedMoney(-50_046, 2));
    expect(fr).not.toMatch(/--\s?\d/);
  });

  it("prints a dash for a dividend with no ticker", () => {
    expect(fr).toContain("| 2026-05-02 | - | PEA |");
  });

  it("drops a section with nothing in it", () => {
    expect(fr).toContain("## DIVIDENDINCOME");
    expect(fr).not.toContain("## INTERESTINCOME");
  });

  it("lists interest with its cents when there is some", () => {
    const md = buildTaxReportMarkdown(WITH_INTEREST, S, "fr-FR");
    expect(md).toContain("## INTERESTINCOME");
    expect(md).toContain(`| 2026-12-31 | Livret A | ${F.money(1_234, 2)} |`);
  });

  it("writes an English report's figures the English way", () => {
    const en = buildTaxReportMarkdown(DATA, S, "en-US");
    expect(en).toContain("| REALIZEDGAINS | +€1,235 |");
    expect(en).toContain("| €1,500.46 | €1,000.00 | -€500.46 | -€0.00 |");
    expect(en).not.toMatch(/\d €/);
  });
});
