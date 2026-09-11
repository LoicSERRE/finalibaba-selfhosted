/**
 * The serialized (no BigInt) shapes the accounts export is built from.
 *
 * Split out of components/shared/export-accounts-button.tsx at v2.10.4: they
 * described a payload lib/domain/accounts-page.ts produces, while living in a
 * client component, so lib/ imported them back out of components/ - the wrong
 * way round, and the second instance of that inversion in this repo. The
 * release audit's layering check only ever looked for the opposite direction.
 */
// ── Serialized types (no BigInt) ──────────────────────────────────────────────

export type FiatAccountExport = {
  id: string;
  name: string;
  institutionName: string;
  type: string;
  balanceCents: number;
  deltaCents: number;
};

export type HoldingExport = {
  ticker: string;
  name: string | null;
  quantity: string;
  lastPriceCents: number;
  valueCents: number;
  pct: number;
  costBasisCents: number | null;
  gainCents: number | null;
  gainPct: number | null;
  taxCents: number | null;
  currency: string; // "EUR" | "USD" | "GBP" | "CHF"
  targetPct: number | null; // 0-100, rebalancing target
};

export type InvestAccountExport = {
  id: string;
  name: string;
  institutionName: string;
  type: string;
  investmentSubtype: string | null;
  totalCents: number;
  gainCents: number | null;
  taxCents: number | null;
  holdings: HoldingExport[];
};

export type RealEstateAccountExport = {
  id: string;
  name: string;
  institutionName: string;
  valueCents: number;
  liabilityCents: number;
  equityCents: number;
  ltv: number;
};

export type AutomobileAccountExport = {
  id: string;
  name: string;
  institutionName: string;
  valueCents: number;
  purchasePriceCents: number;
  liabilityCents: number;
  equityCents: number;
  depreciationCents: number | null;
  depreciationPct: number | null;
};

export type LoanAccountExport = {
  id: string;
  name: string;
  institutionName: string;
  amountBorrowedCents: number;
  remainingCapitalCents: number;
  taeg: number;
  durationMonths: number;
  currentPaymentCents: number;
  totalCostCents: number;
  progressPct: number;
  projectedEnd: string; // pre-formatted per locale
};
