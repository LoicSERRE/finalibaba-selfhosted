import Decimal from "decimal.js";
import { getAccountTaxRate } from "@/lib/domain/tax";
import { calcLoanStats, hasLoanParams, type LoanStats } from "@/lib/domain/loan";
import { getInstitutionLogoUrl } from "@/lib/domain/institutions";
import type { TaxTreatment } from "@/app/generated/prisma/enums";
import type {
  FiatAccountExport,
  HoldingExport,
  InvestAccountExport,
  RealEstateAccountExport,
  AutomobileAccountExport,
  LoanAccountExport,
} from "@/components/shared/export-accounts-button";

export function holdingValue(h: { quantity: Decimal; lastPriceCents: bigint }): bigint {
  return BigInt(new Decimal(h.quantity.toString()).mul(h.lastPriceCents.toString()).round().toNumber());
}

// ── Shared institution shape ─────────────────────────────────────────────────

interface InstitutionInput {
  name: string;
  logoUrl: string | null;
}

function institutionView(institution: InstitutionInput | null) {
  return {
    name: institution?.name ?? null,
    logoUrl: institution ? (institution.logoUrl ?? getInstitutionLogoUrl(institution.name)) : null,
  };
}

// ── Fiat (checking/savings/meal voucher) ─────────────────────────────────────

export interface FiatAccountInput {
  id: string;
  name: string;
  type: string;
  institution: InstitutionInput | null;
  history: { balanceCents: bigint }[]; // most recent first
}

export interface FiatAccountRow {
  id: string;
  name: string;
  type: string;
  institutionName: string | null;
  institutionLogoUrl: string | null;
  currentCents: bigint;
  deltaCents: bigint;
  sparkValues: number[];
}

export function computeFiatRow(account: FiatAccountInput): FiatAccountRow {
  const current = account.history[0]?.balanceCents ?? BigInt(0);
  const previous = account.history[1]?.balanceCents ?? current;
  const inst = institutionView(account.institution);
  return {
    id: account.id,
    name: account.name,
    type: account.type,
    institutionName: inst.name,
    institutionLogoUrl: inst.logoUrl,
    currentCents: current,
    deltaCents: current - previous,
    sparkValues: account.history.slice().reverse().map((h) => Number(h.balanceCents)),
  };
}

// ── Investments (INVESTMENT/CRYPTO) ──────────────────────────────────────────

export interface HoldingInput {
  id: string;
  ticker: string;
  name: string | null;
  quantity: Decimal;
  lastPriceCents: bigint;
  costBasisCents: bigint | null;
  currency: string;
  targetPct: number | null; // 0-1 ratio
}

export interface InvestAccountInput {
  id: string;
  name: string;
  type: string;
  investmentSubtype: string | null;
  taxTreatment: TaxTreatment;
  taxRatePct: number | null;
  institution: InstitutionInput | null;
  holdings: HoldingInput[];
}

export interface HoldingRow {
  id: string;
  ticker: string;
  name: string | null;
  quantityDisplay: string;
  lastPriceCents: bigint;
  valueCents: bigint;
  pct: number;
  gainCents: bigint | null;
  gainPct: number | null;
  taxCents: bigint | null; // null = no tax rate configured, 0 = rate configured but no/negative gain
  currency: string;
  targetPct: number | null; // 0-100 display ratio
}

export interface InvestAccountRow {
  id: string;
  name: string;
  type: string;
  investmentSubtype: string | null;
  institutionName: string | null;
  institutionLogoUrl: string | null;
  totalCents: bigint;
  gainCents: bigint;
  hasCostBasis: boolean;
  taxCents: bigint;
  hasTaxRate: boolean;
  holdings: HoldingRow[];
}

export function computeInvestRow(account: InvestAccountInput): InvestAccountRow {
  const rate = getAccountTaxRate(account);
  const accountTotal = account.holdings.reduce((s, h) => s + holdingValue(h), BigInt(0));

  let accountGain = BigInt(0);
  let hasCostBasis = false;
  for (const h of account.holdings) {
    if (h.costBasisCents != null) {
      hasCostBasis = true;
      accountGain += holdingValue(h) - h.costBasisCents;
    }
  }
  const accountTax =
    hasCostBasis && rate !== null && accountGain > BigInt(0)
      ? BigInt(Math.round(Number(accountGain) * rate))
      : BigInt(0);

  const holdings: HoldingRow[] = account.holdings.map((h) => {
    const value = holdingValue(h);
    const pct = accountTotal > BigInt(0) ? Math.round((Number(value) / Number(accountTotal)) * 100) : 0;
    const gain = h.costBasisCents != null ? value - h.costBasisCents : null;
    const gainPct =
      gain !== null && h.costBasisCents != null && h.costBasisCents > BigInt(0)
        ? (Number(gain) / Number(h.costBasisCents)) * 100
        : null;
    const tax =
      gain !== null && rate !== null
        ? gain > BigInt(0)
          ? BigInt(Math.round(Number(gain) * rate))
          : BigInt(0)
        : null;
    return {
      id: h.id,
      ticker: h.ticker,
      name: h.name,
      quantityDisplay: new Decimal(h.quantity.toString()).toSignificantDigits(6).toString(),
      lastPriceCents: h.lastPriceCents,
      valueCents: value,
      pct,
      gainCents: gain,
      gainPct,
      taxCents: tax,
      currency: h.currency,
      targetPct: h.targetPct != null ? Math.round(h.targetPct * 100) : null,
    };
  });

  const inst = institutionView(account.institution);
  return {
    id: account.id,
    name: account.name,
    type: account.type,
    investmentSubtype: account.investmentSubtype,
    institutionName: inst.name,
    institutionLogoUrl: inst.logoUrl,
    totalCents: accountTotal,
    gainCents: accountGain,
    hasCostBasis,
    taxCents: accountTax,
    hasTaxRate: rate !== null,
    holdings,
  };
}

// ── Real estate ───────────────────────────────────────────────────────────────

export interface RealEstateInput {
  id: string;
  name: string;
  institution: InstitutionInput | null;
  manualValueCents: bigint | null;
  liabilityCents: bigint | null;
}

export interface RealEstateRow {
  id: string;
  name: string;
  institutionName: string | null;
  institutionLogoUrl: string | null;
  valueCents: bigint;
  liabilityCents: bigint;
  equityCents: bigint;
  ltv: number;
}

export function computeRealEstateRow(p: RealEstateInput): RealEstateRow {
  const value = p.manualValueCents ?? BigInt(0);
  const liability = p.liabilityCents ?? BigInt(0);
  const inst = institutionView(p.institution);
  return {
    id: p.id,
    name: p.name,
    institutionName: inst.name,
    institutionLogoUrl: inst.logoUrl,
    valueCents: value,
    liabilityCents: liability,
    equityCents: value - liability,
    ltv: value > BigInt(0) ? Math.round((Number(liability) / Number(value)) * 100) : 0,
  };
}

// ── Automobiles ───────────────────────────────────────────────────────────────

export interface AutomobileInput {
  id: string;
  name: string;
  institution: InstitutionInput | null;
  manualValueCents: bigint | null;
  purchasePriceCents: bigint | null;
  liabilityCents: bigint | null;
  insuranceMonthlyCents: bigint | null;
}

export interface AutomobileRow {
  id: string;
  name: string;
  institutionName: string | null;
  institutionLogoUrl: string | null;
  valueCents: bigint;
  purchasePriceCents: bigint;
  liabilityCents: bigint;
  equityCents: bigint;
  insuranceMonthlyCents: bigint;
  depreciationCents: bigint | null;
  depreciationPct: number | null;
  financingPct: number;
}

export function computeAutomobileRow(a: AutomobileInput): AutomobileRow {
  const value = a.manualValueCents ?? BigInt(0);
  const purchasePrice = a.purchasePriceCents ?? BigInt(0);
  const liability = a.liabilityCents ?? BigInt(0);
  const depreciation = purchasePrice > BigInt(0) ? value - purchasePrice : null;
  const depreciationPct =
    purchasePrice > BigInt(0) ? Math.round((Number(depreciation!) / Number(purchasePrice)) * 100) : null;
  const inst = institutionView(a.institution);
  return {
    id: a.id,
    name: a.name,
    institutionName: inst.name,
    institutionLogoUrl: inst.logoUrl,
    valueCents: value,
    purchasePriceCents: purchasePrice,
    liabilityCents: liability,
    equityCents: value - liability,
    insuranceMonthlyCents: a.insuranceMonthlyCents ?? BigInt(0),
    depreciationCents: depreciation,
    depreciationPct,
    financingPct: value > BigInt(0) ? Math.round((Number(liability) / Number(value)) * 100) : 0,
  };
}

// ── Loans ─────────────────────────────────────────────────────────────────────

export interface LoanInput {
  id: string;
  name: string;
  institution: InstitutionInput | null;
  loanAmountCents: bigint | null;
  loanTaeg: number | null;
  loanDurationMonths: number | null;
  loanDeferralMonths: number | null;
  loanStartDate: Date | null;
  insuranceMonthlyCents: bigint | null;
  liabilityCents: bigint | null;
}

export type LoanRow =
  | {
      id: string;
      name: string;
      institutionName: string | null;
      institutionLogoUrl: string | null;
      hasParams: false;
    }
  | {
      id: string;
      name: string;
      institutionName: string | null;
      institutionLogoUrl: string | null;
      hasParams: true;
      taeg: number;
      durationMonths: number;
      deferralMonths: number;
      amountBorrowedCents: bigint;
      insuranceMonthlyCents: bigint;
      stats: LoanStats;
    };

export function computeLoanRow(loan: LoanInput, now: Date): LoanRow {
  const inst = institutionView(loan.institution);
  if (!hasLoanParams(loan)) {
    return { id: loan.id, name: loan.name, institutionName: inst.name, institutionLogoUrl: inst.logoUrl, hasParams: false };
  }
  const loanParams = {
    loanAmountCents: loan.loanAmountCents,
    loanTaeg: loan.loanTaeg,
    loanDurationMonths: loan.loanDurationMonths,
    loanDeferralMonths: loan.loanDeferralMonths ?? 0,
    loanStartDate: loan.loanStartDate,
  };
  const insuranceMonthlyCents = loan.insuranceMonthlyCents ?? BigInt(0);
  const stats = calcLoanStats(loanParams, insuranceMonthlyCents, now);
  return {
    id: loan.id,
    name: loan.name,
    institutionName: inst.name,
    institutionLogoUrl: inst.logoUrl,
    hasParams: true,
    taeg: loan.loanTaeg,
    durationMonths: loan.loanDurationMonths,
    deferralMonths: loan.loanDeferralMonths ?? 0,
    amountBorrowedCents: loan.loanAmountCents,
    insuranceMonthlyCents,
    stats,
  };
}

/** Sum of current remaining capital across all loans - falls back to the raw liabilityCents for loans missing full params. */
export function computeLoanTotal(loans: LoanInput[], now: Date): bigint {
  return loans.reduce((sum, loan) => {
    const row = computeLoanRow(loan, now);
    const capital = row.hasParams ? row.stats.currentCapitalCents : loan.liabilityCents ?? BigInt(0);
    return sum + capital;
  }, BigInt(0));
}

// ── Tab totals ────────────────────────────────────────────────────────────────

export type AccountsTabId = "liquidites" | "investissements" | "immobilier" | "automobiles" | "credits";

export function computeTabTotals(input: {
  fiatRows: FiatAccountRow[];
  investRows: InvestAccountRow[];
  realEstateRows: RealEstateRow[];
  automobileRows: AutomobileRow[];
  loanTotalCents: bigint;
}): Record<AccountsTabId, bigint> {
  return {
    liquidites: input.fiatRows.reduce((s, a) => s + a.currentCents, BigInt(0)),
    investissements: input.investRows.reduce((s, a) => s + a.totalCents, BigInt(0)),
    immobilier: input.realEstateRows.reduce((s, p) => s + p.equityCents, BigInt(0)),
    automobiles: input.automobileRows.reduce((s, a) => s + a.equityCents, BigInt(0)),
    credits: input.loanTotalCents,
  };
}

// ── Export mapping (BigInt → number, no other logic) ─────────────────────────
// Reuses the same rows the tab components render, so the export can never
// silently drift from what's on screen - it's the exact same computation.

export function toFiatExport(row: FiatAccountRow): FiatAccountExport {
  return {
    id: row.id,
    name: row.name,
    institutionName: row.institutionName ?? "",
    type: row.type,
    balanceCents: Number(row.currentCents),
    deltaCents: Number(row.deltaCents),
  };
}

function toHoldingExport(h: HoldingRow): HoldingExport {
  return {
    ticker: h.ticker,
    name: h.name,
    quantity: h.quantityDisplay,
    lastPriceCents: Number(h.lastPriceCents),
    valueCents: Number(h.valueCents),
    pct: h.pct,
    costBasisCents: null, // not shown on the page either - see export-completeness.test.ts
    gainCents: h.gainCents != null ? Number(h.gainCents) : null,
    gainPct: h.gainPct,
    taxCents: h.taxCents != null ? Number(h.taxCents) : null,
    currency: h.currency,
    targetPct: h.targetPct,
  };
}

export function toInvestExport(row: InvestAccountRow): InvestAccountExport {
  return {
    id: row.id,
    name: row.name,
    institutionName: row.institutionName ?? "",
    type: row.type,
    investmentSubtype: row.investmentSubtype,
    totalCents: Number(row.totalCents),
    gainCents: row.hasCostBasis ? Number(row.gainCents) : null,
    taxCents: row.hasCostBasis ? Number(row.taxCents) : null,
    holdings: row.holdings.map(toHoldingExport),
  };
}

export function toRealEstateExport(row: RealEstateRow): RealEstateAccountExport {
  return {
    id: row.id,
    name: row.name,
    institutionName: row.institutionName ?? "",
    valueCents: Number(row.valueCents),
    liabilityCents: Number(row.liabilityCents),
    equityCents: Number(row.equityCents),
    ltv: row.ltv,
  };
}

export function toAutomobileExport(row: AutomobileRow): AutomobileAccountExport {
  return {
    id: row.id,
    name: row.name,
    institutionName: row.institutionName ?? "",
    valueCents: Number(row.valueCents),
    purchasePriceCents: Number(row.purchasePriceCents),
    liabilityCents: Number(row.liabilityCents),
    equityCents: Number(row.equityCents),
    depreciationCents: row.depreciationCents != null ? Number(row.depreciationCents) : null,
    depreciationPct: row.depreciationPct,
  };
}

/** `intlLocale` drives the pre-formatted `projectedEnd` string, same as the on-page date display. */
export function toLoanExport(row: LoanRow, intlLocale: string): LoanAccountExport | null {
  if (!row.hasParams) return null;
  return {
    id: row.id,
    name: row.name,
    institutionName: row.institutionName ?? "",
    amountBorrowedCents: Number(row.amountBorrowedCents),
    remainingCapitalCents: Number(row.stats.currentCapitalCents),
    taeg: row.taeg,
    durationMonths: row.durationMonths,
    currentPaymentCents: Number(row.stats.currentMonthlyTotalCents),
    totalCostCents: Number(row.stats.totalCostCents),
    progressPct: row.stats.progressPct,
    projectedEnd: new Intl.DateTimeFormat(intlLocale, { month: "short", year: "numeric" }).format(row.stats.endDate),
  };
}
