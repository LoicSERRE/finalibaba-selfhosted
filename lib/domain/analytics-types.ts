/**
 * The shapes computeAnalytics takes and returns. Declarations only, split out
 * of analytics.ts for size - a type never needs reading to follow the maths,
 * and 300 lines of them sat between the helpers and the function.
 */
import type Decimal from "decimal.js";
import type { TaxTreatment } from "@/app/generated/prisma/enums";
import type { PricePoint, YFDividendInfo } from "@/lib/domain/analytics-market";


// ── Input ──────────────────────────────────────────────────────────────────────

export interface AnalyticsHolding {
  ticker: string;
  name: string | null;
  quantity: Decimal;
  lastPriceCents: bigint;
  costBasisCents: bigint | null;
}

export interface AnalyticsAccount {
  id: string;
  name: string;
  type: string; // AccountType
  investmentSubtype: string | null;
  investmentStartDate: Date | null;
  taxTreatment: TaxTreatment;
  taxRatePct: number | null;
  /** See the field's own schema comment - skips dividendEffectiveTaxRate for
   *  this account's holdings in the dividend-calendar estimate, for a broker
   *  that already withholds everything before the dividend lands. */
  dividendsAlreadyNet: boolean;
  /** Annual savings interest, 0-1 ratio. Null = unknown, contributes nothing. */
  interestRatePct: number | null;
  /** What the rate was before it last changed - see AccountInterestRate.
   *  Optional so every caller that does not estimate savings interest (the
   *  API routes, the share view) stays unchanged. */
  interestRateHistory?: { ratePct: number; until: Date }[];
  manualValueCents: bigint | null;
  liabilityCents: bigint | null;
  syncId: string | null;
  loanAmountCents: bigint | null;
  loanTaeg: number | null;
  loanDurationMonths: number | null;
  loanDeferralMonths: number | null;
  loanStartDate: Date | null;
  institution: { name: string } | null;
  holdings: AnalyticsHolding[];
  history: { balanceCents: bigint }[]; // most recent first, only the latest entry is read
}

export interface AnalyticsBalance {
  accountId: string;
  recordedAt: Date;
  balanceCents: bigint;
}

export interface AnalyticsSettings {
  salaryNetCents: bigint;
  monthlyExpensesCents: bigint;
  monthlySavedCents: bigint;
  taxRatePea: number;
  taxRateCto: number;
}

export interface AnalyticsIncomeEvent {
  type: "DIVIDEND" | "INTEREST";
  amountCents: bigint;
  taxWithheldCents: bigint | null;
}

// v1.14 - one row per user-defined Goal. accountId: null means "track
// total net worth" (the exact math the old single global
// UserSettings.savingsGoalCents figure always did) - see the Goal model's
// own schema comment for the full accountId semantics.
export interface AnalyticsGoal {
  id: string;
  name: string;
  targetCents: bigint;
  targetDate: Date | null;
  accountId: string | null;
}

export interface AnalyticsInput {
  accounts: AnalyticsAccount[];
  allBalances: AnalyticsBalance[];
  settings: AnalyticsSettings;
  goals: AnalyticsGoal[];
  yfData: Record<string, YFDividendInfo>;
  incomeEventsYtd: AnalyticsIncomeEvent[];
  msciWorldHistory: PricePoint[];
  sp500History: PricePoint[];
  cac40History: PricePoint[];
  /** Locale used to format the display date strings below (e.g. "fr-FR", "en-US"). */
  intlLocale: string;
  /** Evaluation instant - never read internally via `new Date()`/`Date.now()`, so this function stays pure and deterministic for tests. */
  now: Date;
}

// ── Output ─────────────────────────────────────────────────────────────────────

export interface AssetRow {
  id: string;
  name: string;
  institution: string;
  type: string;
  subtype: string | null;
  value: bigint;
  costBasis: bigint | null;
  gain: bigint | null;
  tax: bigint | null;
}

export interface TopAssetRow extends AssetRow {
  pct: number; // % of grossAssets
}

// v1.14 - one row per Goal, current value already resolved (net worth, or
// the linked account's own AssetRow.value) and progress already computed
// via lib/domain/goals.ts's computeGoalProgress.
export interface GoalRow {
  id: string;
  name: string;
  targetCents: bigint;
  targetDate: Date | null;
  accountId: string | null;
  accountName: string | null; // set only when accountId is set
  currentCents: bigint;
  pct: number;
  remaining: bigint;
}

export interface InvestPerfRow {
  id: string;
  name: string;
  institution: string;
  subtype: string | null;
  value: bigint;
  costBasis: bigint;
  gain: bigint;
  tax: bigint;
  investmentStartDate: Date | null;
  returnPct: number;
  gainNet: bigint;
  cagr: number | null;
}

export interface DividendCalendarRow {
  isin: string;
  name: string;
  symbol: string;
  subtype: string | null;
  country: string;
  valueCents: bigint;
  annualEstCents: bigint;
  annualNetCents: bigint;
  taxRate: number;
  /** True when taxRate is 0 because the account's own broker already
   *  withholds everything (Account.dividendsAlreadyNet), not because the
   *  holding is genuinely tax-free (a PEA still reports 0 for that reason
   *  too - this only disambiguates the two for display). */
  alreadyNet: boolean;
  divYield: number;
  exDividendDate: Date | null;
  annualRatePerShare: number | null;
  daysLeft: number | null;
  isPast: boolean;
  isSoon: boolean;
}

export interface DebtAccountRow {
  id: string;
  name: string;
  institution: string;
  type: string;
  value: bigint;
  liability: bigint;
  equity: bigint;
  ltv: number;
}

export interface AllocationSliceResult {
  key: string; // translate with tAlloc(key) at render time
  value: number;
  color: string;
}

export interface HistoryPoint {
  date: string; // pre-formatted per intlLocale, matches historical behavior
  netWorth: number;
}

export interface MonthlyHistoryPoint extends HistoryPoint {
  month: string; // "YYYY-MM"
}

export interface SavingsInterestHistoryPoint {
  date: string; // pre-formatted per intlLocale, matches HistoryPoint's own convention
  isoDate: string; // "YYYY-MM-DD", for the chart's XAxis dataKey
  estimatedCents: number;
}

export interface PerformanceRow extends MonthlyHistoryPoint {
  delta: number | null;
  deltaPct: number | null;
}

export interface BenchmarkCAGRs {
  msciWorld: number | null;
  sp500: number | null;
  cac40: number | null;
}

export interface AnalyticsResult {
  hasData: boolean;

  // KPIs
  /** After latent tax - the figure every screen shows as "net worth", and
   *  the same definition lib/domain/dashboard.ts uses. */
  netWorth: bigint;
  /** Before latent tax. Only for surfaces that show the deduction itself
   *  (the KPI card's sub-line, the export breakdown, the projection's
   *  second curve) - never as a headline. */
  netWorthBeforeTax: bigint;
  grossAssets: bigint;
  totalLiabilities: bigint;
  totalLatentTax: bigint;
  investedPct: number;
  hasTaxData: boolean;
  // v1.14 - gain-weighted blended tax rate (0-1 ratio) across every taxable
  // account with a real unrealized gain, for the projection chart's
  // tax-aware mode. 0 when hasTaxData is false (nothing to weight).
  effectiveTaxRate: number;
  momDelta: number | null;

  // Savings rate
  hasSalary: boolean;
  hasDeclaredSavings: boolean;
  savingsRate: number | null;
  salaryNetCents: bigint;
  monthlySavedCents: bigint;

  // Runway
  hasExpenses: boolean;
  runwayMonths: number | null;
  monthlyExpensesCents: bigint;
  savingsCents: bigint; // allocation["savings"]

  // Goals (v1.14 - N independent goals, replacing the old single global
  // figure)
  goals: GoalRow[];

  // Real tracked passive income (IncomeEvent, YTD)
  realYtdDividendsNetCents: bigint;
  realYtdInterestNetCents: bigint;
  realYtdPassiveNetCents: bigint;

  // Estimated passive income (dividend yield model)
  annualDividendsCents: bigint;
  annualDividendsNetCents: bigint;
  annualInterestCents: bigint;
  /** Interest-bearing accounts with no rate set - see the estimate above. */
  accountsMissingInterestRate: number;
  /** Balance-weighted average rate (0-1) across SAVINGS accounts with a
   *  known rate. Null when none have one - see the field's own comment. */
  weightedSavingsRatePct: number | null;
  /** Full-calendar-year interest projection across every SAVINGS account
   *  with a known rate, via the "méthode des quinzaines" - see
   *  lib/domain/savings-projection.ts. */
  estimatedYearEndSavingsInterestCents: bigint;
  /** How that same projection would have read at each past quinzaine
   *  boundary this year, for a chart of how the estimate has moved over
   *  time - see lib/domain/savings-projection.ts's estimateYearEndInterestSeries.
   *  A boundary no SAVINGS account with a rate has any balance history for
   *  yet is simply absent, not plotted at 0. */
  estimatedYearEndInterestHistory: SavingsInterestHistoryPoint[];
  annualPassiveCents: bigint;
  monthlyPassiveCents: number;
  dividendCalendar: DividendCalendarRow[];

  // Investment performance
  investPerfRows: InvestPerfRow[];
  investTotalCostBasis: bigint;
  investTotalValue: bigint;
  investTotalGain: bigint;
  investTotalTax: bigint;
  investTotalGainNet: bigint;
  investReturnPct: number;
  investCAGR: number | null;
  investAllHaveDates: boolean;
  taxRatePea: number;
  taxRateCto: number;

  // Benchmark comparison
  benchmarkCAGRs: BenchmarkCAGRs | null;

  // Allocation radar
  garantis: bigint;
  risques: bigint;
  garantisPct: number;

  // Allocation
  allocationSlices: AllocationSliceResult[];
  totalAllocation: number;

  // History / charts
  performanceRows: PerformanceRow[];

  // Top assets
  topAssets: TopAssetRow[];
  // Every asset (not just the top 10 above) - exposed so a Goal linked to
  // an account outside the top 10 can still resolve its current value
  // without a second query, see the "Goals" computation below.
  assetRows: AssetRow[];

  // Financing / debt
  debtAccounts: DebtAccountRow[];
  debtRatio: number;
}
