import Decimal from "decimal.js";
import { getAccountTaxRate } from "@/lib/domain/tax";
import { calcLoanStats, hasLoanParams, type LoanStats } from "@/lib/domain/loan";
import type { TaxTreatment } from "@/app/generated/prisma/enums";

export const TYPE_TO_TAB: Record<string, string> = {
  CHECKING: "liquidites",
  SAVINGS: "liquidites",
  MEAL_VOUCHER: "liquidites",
  INVESTMENT: "investissements",
  CRYPTO: "investissements",
  REAL_ESTATE: "immobilier",
  AUTOMOBILE: "automobiles",
  LOAN: "credits",
};

// ── Input ──────────────────────────────────────────────────────────────────────

export interface AccountDetailHolding {
  id: string;
  ticker: string;
  name: string | null;
  quantity: Decimal;
  lastPriceCents: bigint;
  costBasisCents: bigint | null;
  targetPct: number | null;
  currency: string;
  nativePriceCents: bigint | null;
  nativeCostBasisCents: bigint | null;
}

export interface AccountDetailBalance {
  id: string;
  balanceCents: bigint;
  recordedAt: Date;
}

export interface AccountDetailTransaction {
  id: string;
  date: Date;
  label: string;
  amountCents: bigint;
  categoryId: string | null;
}

export interface AccountDetailAccount {
  id: string;
  name: string;
  type: string; // AccountType
  syncId: string | null;
  gocardlessAccountId: string | null;
  investmentSubtype: string | null;
  investmentStartDate: Date | null;
  taxTreatment: TaxTreatment;
  taxRatePct: number | null;
  manualValueCents: bigint | null;
  liabilityCents: bigint | null;
  purchasePriceCents: bigint | null;
  insuranceMonthlyCents: bigint | null;
  loanAmountCents: bigint | null;
  loanTaeg: number | null;
  loanDurationMonths: number | null;
  loanDeferralMonths: number | null;
  loanStartDate: Date | null;
  institution: { name: string } | null;
  holdings: AccountDetailHolding[];
  /** Most recent first (matches the page's `orderBy: { recordedAt: "desc" }`). */
  history: AccountDetailBalance[];
  /** Most recent first (matches the page's `orderBy: { date: "desc" }`). */
  transactions: AccountDetailTransaction[];
}

export interface AccountDetailInput {
  account: AccountDetailAccount;
  intlLocale: string;
  /** Evaluation instant - never read internally via `new Date()`, so this stays pure/deterministic for tests. */
  now: Date;
}

// ── Output ─────────────────────────────────────────────────────────────────────

export interface HoldingWithTax extends AccountDetailHolding {
  marketValueCents: bigint;
  gainCents: bigint | null; // null = no cost basis known
  gainPct: number | null;
  taxCents: bigint | null;
  pct: number; // % of account total
}

export interface RebalancingRow {
  id: string;
  ticker: string;
  pct: number;
  targetPctInt: number;
  driftPts: number;
  driftValueCents: bigint;
  isOverweight: boolean;
  suggestedQty: number | null;
  /** driftValueCents !== 0 && driftPts !== 0 - matches the original JSX gate for showing a suggested trade. */
  showSuggestion: boolean;
}

export interface HistoryRow extends AccountDetailBalance {
  delta: bigint | null;
}

export interface ChartPoint {
  date: string; // pre-formatted per intlLocale, matches historical behavior
  balance: number;
}

export interface AccountDetailResult {
  isFiat: boolean;
  isInvestment: boolean;
  isRealEstate: boolean;
  isAutomobile: boolean;
  isLoan: boolean;
  isSynced: boolean;
  canImportCsv: boolean;
  existingFingerprints: string[];
  existingBalanceDates: string[];

  taxRate: number | null;
  loanStats: LoanStats | null;

  currentValue: bigint;
  latestDelta: bigint | null;
  chartData: ChartPoint[];
  historyRows: HistoryRow[];

  // Real estate / automobile
  value: bigint;
  liability: bigint;
  equity: bigint;
  ltv: number;
  purchasePrice: bigint;

  backTab: string;
  subtypeLabel: string;

  // Investments
  holdingsWithTax: HoldingWithTax[];
  rebalancingRows: RebalancingRow[];
  totalCostBasis: bigint;
  totalGain: bigint;
  hasCostBasis: boolean;
  totalGainPct: number | null;
  totalTax: bigint;
  netAfterTax: bigint;
}

// ── computeAccountDetail ─────────────────────────────────────────────────────

function holdingMarketValue(h: { quantity: Decimal; lastPriceCents: bigint }): bigint {
  return BigInt(
    new Decimal(h.quantity.toString())
      .mul(h.lastPriceCents.toString())
      .round()
      .toNumber()
  );
}

// NOSONAR (typescript:S3776) - complexity 17, under this project's own
// deliberately-raised threshold of 20 (see eslint.config.mjs's
// sonarjs/cognitive-complexity rule and lib/domain/dashboard.ts's identical
// justification) - SonarQube's stricter default of 15 is not the threshold
// this codebase has standardized on.
export function computeAccountDetail(input: AccountDetailInput): AccountDetailResult { // NOSONAR
  const { account, intlLocale, now } = input;

  const isFiat = ["CHECKING", "SAVINGS", "MEAL_VOUCHER"].includes(account.type);
  const isInvestment = ["INVESTMENT", "CRYPTO"].includes(account.type);
  const isRealEstate = account.type === "REAL_ESTATE";
  const isAutomobile = account.type === "AUTOMOBILE";
  const isLoan = account.type === "LOAN";
  const isSynced = !!account.syncId;
  const canImportCsv = isFiat && !isSynced && !account.gocardlessAccountId;
  const existingFingerprints = account.transactions.map(
    (tx) => `${tx.date.toISOString().slice(0, 10)}|${tx.label.trim().toLowerCase()}|${tx.amountCents.toString()}`
  );
  const existingBalanceDates = account.history.map((h) => h.recordedAt.toISOString().slice(0, 10));

  const taxRate = getAccountTaxRate(account);

  // Loan stats (calculated once)
  const loanStats =
    isLoan && hasLoanParams(account)
      ? calcLoanStats(
          {
            loanAmountCents: account.loanAmountCents,
            loanTaeg: account.loanTaeg,
            loanDurationMonths: account.loanDurationMonths,
            loanDeferralMonths: account.loanDeferralMonths ?? 0,
            loanStartDate: account.loanStartDate,
          },
          account.insuranceMonthlyCents ?? BigInt(0),
          now
        )
      : null;

  // Current value
  let currentValue = BigInt(0);
  if (isRealEstate || isAutomobile) {
    currentValue = account.manualValueCents ?? BigInt(0);
  } else if (isLoan) {
    currentValue = loanStats?.currentCapitalCents ?? (account.liabilityCents ?? BigInt(0));
  } else if (isInvestment) {
    currentValue = account.holdings.reduce((sum, h) => sum + holdingMarketValue(h), BigInt(0));
  } else {
    currentValue = account.history[0]?.balanceCents ?? BigInt(0);
  }

  // Delta vs previous record (fiat)
  const latestDelta =
    account.history.length >= 2
      ? account.history[0].balanceCents - account.history[1].balanceCents
      : null;

  // Chart data - chronological, last 60 points
  const chartData: ChartPoint[] = [...account.history]
    .reverse()
    .slice(-60)
    .map((h) => ({
      date: new Intl.DateTimeFormat(intlLocale, {
        day: "numeric",
        month: "short",
      }).format(h.recordedAt),
      balance: Number(h.balanceCents),
    }));

  // History rows with deltas (desc order)
  const historyRows: HistoryRow[] = account.history.map((h, i) => ({
    ...h,
    delta:
      i < account.history.length - 1
        ? h.balanceCents - account.history[i + 1].balanceCents
        : null,
  }));

  // Real estate / automobile fields
  const value = account.manualValueCents ?? BigInt(0);
  const liability = account.liabilityCents ?? BigInt(0);
  const equity = value - liability;
  const ltv = value > BigInt(0) ? Math.round((Number(liability) / Number(value)) * 100) : 0;

  const purchasePrice = account.purchasePriceCents ?? BigInt(0);
  const backTab = TYPE_TO_TAB[account.type] ?? "liquidites";

  // ── Fiscal calculations (investments) ─────────────────────────────────────
  let totalCostBasis = BigInt(0);
  let totalGain = BigInt(0);
  let hasCostBasis = false;

  const holdingsWithTax: HoldingWithTax[] = account.holdings.map((h) => {
    const marketValueCents = holdingMarketValue(h);

    const pct =
      currentValue > BigInt(0)
        ? Math.round((Number(marketValueCents) / Number(currentValue)) * 100)
        : 0;

    if (h.costBasisCents == null || taxRate === null) {
      return { ...h, marketValueCents, gainCents: null, gainPct: null, taxCents: null, pct };
    }

    hasCostBasis = true;
    const gainCents = marketValueCents - h.costBasisCents;
    const gainPct =
      h.costBasisCents > BigInt(0)
        ? (Number(gainCents) / Number(h.costBasisCents)) * 100
        : null;
    // Tax only on positive gains (per-position display)
    const taxCents =
      gainCents > BigInt(0) ? BigInt(Math.round(Number(gainCents) * taxRate)) : BigInt(0);

    totalCostBasis += h.costBasisCents;
    totalGain += gainCents;

    return { ...h, marketValueCents, gainCents, gainPct, taxCents, pct };
  });

  const totalGainPct =
    hasCostBasis && totalCostBasis > BigInt(0)
      ? (Number(totalGain) / Number(totalCostBasis)) * 100
      : null;
  // Tax on NET gain (losses offset gains - matches French PFU logic for hypothetical full liquidation)
  const totalTax =
    hasCostBasis && taxRate !== null && totalGain > BigInt(0)
      ? BigInt(Math.round(Number(totalGain) * taxRate))
      : BigInt(0);
  const netAfterTax = currentValue - totalTax;

  // ── Rebalancing (per targeted holding) ──────────────────────────────────
  const rebalancingRows: RebalancingRow[] = holdingsWithTax
    .filter((h): h is HoldingWithTax & { targetPct: number } => h.targetPct != null)
    .map((h) => {
      const targetPctInt = Math.round(h.targetPct * 100);
      const driftPts = h.pct - targetPctInt;
      const targetValueCents = BigInt(Math.round(Number(currentValue) * h.targetPct));
      const driftValueCents = h.marketValueCents - targetValueCents;
      const isOverweight = driftValueCents > BigInt(0);
      const suggestedQty =
        h.lastPriceCents > BigInt(0)
          ? Math.abs(Number(driftValueCents)) / Number(h.lastPriceCents)
          : null;
      return {
        id: h.id,
        ticker: h.ticker,
        pct: h.pct,
        targetPctInt,
        driftPts,
        driftValueCents,
        isOverweight,
        suggestedQty,
        showSuggestion: driftValueCents !== BigInt(0) && driftPts !== 0,
      };
    });

  // Subtype label
  let subtypeLabel = "";
  if (account.type === "INVESTMENT" && account.investmentSubtype) {
    subtypeLabel = ` · ${account.investmentSubtype}`;
  } else if (account.type === "CRYPTO") {
    subtypeLabel = " · 31.4% flat tax";
  }

  return {
    isFiat,
    isInvestment,
    isRealEstate,
    isAutomobile,
    isLoan,
    isSynced,
    canImportCsv,
    existingFingerprints,
    existingBalanceDates,
    taxRate,
    loanStats,
    currentValue,
    latestDelta,
    chartData,
    historyRows,
    value,
    liability,
    equity,
    ltv,
    purchasePrice,
    backTab,
    subtypeLabel,
    holdingsWithTax,
    rebalancingRows,
    totalCostBasis,
    totalGain,
    hasCostBasis,
    totalGainPct,
    totalTax,
    netAfterTax,
  };
}
