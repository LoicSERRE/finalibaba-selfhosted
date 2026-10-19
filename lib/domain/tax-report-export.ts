/**
 * The serialized (no BigInt) payload the tax-report export is built from.
 *
 * Moved out of components/shared/export-tax-report-button.tsx at v2.12.5
 * together with its builder (lib/utils/tax-report-markdown.ts), the same
 * split accounts-export.ts and analytics-export.ts went through at v2.10.x -
 * a builder in lib/ cannot import its input type back out of a component.
 */
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
