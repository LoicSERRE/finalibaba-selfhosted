import Decimal from "decimal.js";
import { getAccountTaxRate } from "@/lib/tax";
import { calcCurrentCapital, hasLoanParams } from "@/lib/loan";
import { ALLOCATION_CATEGORY_COLORS as CATEGORY_COLORS } from "@/lib/palette";
import type { TaxTreatment } from "@/app/generated/prisma/enums";
import type { AnalyticsExportData } from "@/components/export-analytics-button";

// ── Static config ────────────────────────────────────────────────────────────

// Approximate tech exposure per ticker (0–1)
export const TECH_WEIGHTS: Record<string, number> = {
  US5949181045: 1.0,   // Microsoft
  US30303M1027: 1.0,   // Meta
  US0378331005: 1.0,   // Apple
  IE00BGV5VN51: 0.85,  // AI & Big Data ETF
  FR0011871110: 0.60,  // PEA Nasdaq 100
  IE00B5BMR087: 0.32,  // Core S&P 500
  LU1681048804: 0.32,  // S&P 500 EUR
  LU1681043599: 0.23,  // MSCI World
  IE0002XZSHO1: 0.23,  // MSCI World Swap PEA
  FR001400U5Q4: 0.23,  // Pea Monde MSCI World
  LU3176111881: 0.10,  // Private Equity
  // everything else: 0
};

// Annual dividend yields (only distributing stocks; accumulating ETFs = 0)
export const DIVIDEND_YIELDS: Record<string, number> = {
  FR0000120073: 0.020, // Air Liquide ~2%
  NL0011585146: 0.005, // Ferrari ~0.5%
  US0378331005: 0.005, // Apple ~0.5%
  US30303M1027: 0.004, // Meta ~0.4%
  US5801351017: 0.025, // McDonald's ~2.5%
  US5949181045: 0.008, // Microsoft ~0.8%
};

// Yahoo Finance ticker symbols for dividend-paying holdings
export const ISIN_TO_YF_SYMBOL: Record<string, string> = {
  FR0000120073: "AI.PA",
  NL0011585146: "RACE",
  US0378331005: "AAPL",
  US30303M1027: "META",
  US5801351017: "MCD",
  US5949181045: "MSFT",
};

// Reference indices for the benchmark comparison. URTH (iShares MSCI World
// ETF) is the standard free proxy for the MSCI World index itself - Yahoo
// has no clean "^" ticker for it, unlike S&P 500/CAC 40.
export const BENCHMARK_SYMBOLS = {
  msciWorld: "URTH",
  sp500: "^GSPC",
  cac40: "^FCHI",
} as const;

// ── Types shared with lib/yahoo-finance.ts (fetch layer) ─────────────────────

export type YFDividendInfo = {
  exDividendDate: Date | null;
  annualYield: number | null;        // trailingAnnualDividendYield (ex: 0.025 = 2.5%) - currency-agnostic
  annualRatePerShare: number | null; // trailingAnnualDividendRate in local currency (display only)
};

export type PricePoint = { date: Date; close: number };

// ── Pure helpers ──────────────────────────────────────────────────────────────

export function holdingMarketValue(h: { quantity: Decimal; lastPriceCents: bigint }): bigint {
  return BigInt(
    new Decimal(h.quantity.toString())
      .mul(h.lastPriceCents.toString())
      .round()
      .toNumber()
  );
}

// Effective dividend tax rate for a French tax resident under the flat tax (PFU) regime.
// PEA: reinvested within the wrapper - no immediate tax.
// CTO French equities: flat tax 30% (12.8% income tax + 17.2% social levies).
// CTO foreign equities (15% treaty): 15% withholding + 17.2% social levies
//   → tax credit offsets the 12.8% income tax (credit 15% > IR 12.8% → IR = 0) → effective 32.2%.
// Note: estimate under flat-tax assumption. Actual net may differ with progressive scale or 40% deduction.
export function dividendEffectiveTaxRate(isin: string, subtype: string | null): number {
  if (subtype === "PEA") return 0;
  const country = isin.slice(0, 2).toUpperCase();
  if (country === "FR") return 0.30;
  // Countries with a 15% withholding treaty with France (US, NL, IE, DE, GB, LU, BE...)
  // Effective = 15% withholding + 17.2% social levies − income tax credit (12.8% < 15% → IT = 0) = 32.2%
  const treaty15 = ["US", "NL", "IE", "DE", "GB", "LU", "BE", "CA", "JP", "CH"];
  if (treaty15.includes(country)) return 0.322;
  return 0.30; // default: flat tax, no known withholding treaty
}

/** Closest data point to `target`, or null if the series is empty. */
export function priceAt(series: PricePoint[], target: Date): PricePoint | null {
  if (series.length === 0) return null;
  let closest = series[0];
  let minDiffMs = Math.abs(series[0].date.getTime() - target.getTime());
  for (const p of series) {
    const diffMs = Math.abs(p.date.getTime() - target.getTime());
    if (diffMs < minDiffMs) {
      minDiffMs = diffMs;
      closest = p;
    }
  }
  return closest;
}

/**
 * Same CAGR(r) = (end/start)^(1/years) − 1 formula used for investCAGR.
 * Years is derived from the *actual* matched start point, not the requested
 * startDate - if the fetched series doesn't reach back that far (shouldn't
 * happen with range=max, but degrades safely if Yahoo returns less), this
 * keeps the exponent consistent with the prices actually being compared
 * instead of silently understating the CAGR.
 */
export function computeIndexCAGR(series: PricePoint[], startDate: Date, now: Date): number | null {
  const startPoint = priceAt(series, startDate);
  const endPoint = priceAt(series, now);
  if (startPoint === null || endPoint === null || startPoint.close <= 0) return null;

  const years = (endPoint.date.getTime() - startPoint.date.getTime()) / (365.25 * 86_400_000);
  if (years < 1 / 12) return null;

  return (Math.pow(endPoint.close / startPoint.close, 1 / years) - 1) * 100;
}

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
  savingsGoalCents: bigint;
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

export interface AnalyticsInput {
  accounts: AnalyticsAccount[];
  allBalances: AnalyticsBalance[];
  settings: AnalyticsSettings;
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
  netWorth: bigint;
  netWorthAfterTax: bigint;
  grossAssets: bigint;
  totalLiabilities: bigint;
  totalLatentTax: bigint;
  investedPct: number;
  hasTaxData: boolean;
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

  // Goal
  goalCents: bigint;
  goalPct: number;
  goalRemaining: bigint;

  // Real tracked passive income (IncomeEvent, YTD)
  realYtdDividendsNetCents: bigint;
  realYtdInterestNetCents: bigint;
  realYtdPassiveNetCents: bigint;

  // Estimated passive income (dividend yield model)
  annualDividendsCents: bigint;
  annualDividendsNetCents: bigint;
  annualInterestCents: bigint;
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
  techPct: number;

  // Allocation
  allocationSlices: AllocationSliceResult[];
  totalAllocation: number;

  // History / charts
  dailyHistory: HistoryPoint[];
  performanceRows: PerformanceRow[];

  // Top assets
  topAssets: TopAssetRow[];

  // Financing / debt
  debtAccounts: DebtAccountRow[];
  debtRatio: number;
}

// ── computeAnalytics ─────────────────────────────────────────────────────────

// Single-pass aggregation over every account, deliberately kept as one
// function so each account is only iterated once (accumulating gross
// assets, allocation, tax, dividends, top assets, debt in the same loop
// rather than N separate passes). Covered by __tests__/analytics.test.ts;
// splitting it would mean passing a lot of shared running state between
// pieces for no behavioral benefit.
// eslint-disable-next-line sonarjs/cognitive-complexity
export function computeAnalytics(input: AnalyticsInput): AnalyticsResult {
  const { accounts, allBalances, settings, yfData, incomeEventsYtd, intlLocale, now } = input;
  const nowMs = now.getTime();

  // ── Compute current values ──────────────────────────────────────────────
  let grossAssets = BigInt(0);
  let totalLiabilities = BigInt(0);
  let totalLatentTax = BigInt(0);
  let techValueCents = BigInt(0);
  let totalInvestCents = BigInt(0);
  let annualDividendsCents = BigInt(0);    // gross
  let annualDividendsNetCents = BigInt(0); // net after tax
  let annualInterestCents = BigInt(0);     // already net (French regulated savings accounts are income-tax-exempt)

  const dividendRowsData: Omit<DividendCalendarRow, "exDividendDate" | "annualRatePerShare" | "daysLeft" | "isPast" | "isSoon">[] = [];

  const allocation: Record<string, bigint> = {
    cash: BigInt(0),
    savings: BigInt(0),
    investments: BigInt(0),
    crypto: BigInt(0),
    realEstate: BigInt(0),
    auto: BigInt(0),
  };

  const assetRows: AssetRow[] = [];

  type InvestPerfRowInternal = Omit<InvestPerfRow, "returnPct" | "gainNet" | "cagr">;
  const investPerfRowsInternal: InvestPerfRowInternal[] = [];

  for (const account of accounts) {
    let value = BigInt(0);
    let accountCostBasis = BigInt(0);
    let accountGain = BigInt(0);
    let accountTax = BigInt(0);
    let hasBasis = false;

    const taxRate = getAccountTaxRate(account);

    if (account.type === "REAL_ESTATE" || account.type === "AUTOMOBILE") {
      value = account.manualValueCents ?? BigInt(0);
      const liability = account.liabilityCents ?? BigInt(0);
      totalLiabilities += liability;
      const equity = value - liability > BigInt(0) ? value - liability : BigInt(0);
      allocation[account.type === "AUTOMOBILE" ? "auto" : "realEstate"] += equity;
      grossAssets += value;
    } else if (account.type === "INVESTMENT" || account.type === "CRYPTO") {
      for (const h of account.holdings) {
        const mv = holdingMarketValue(h);
        value += mv;

        // Tech exposure
        techValueCents += BigInt(Math.round(Number(mv) * (TECH_WEIGHTS[h.ticker] ?? 0)));
        totalInvestCents += mv;

        // Dividends - real Yahoo Finance yield, falls back to hard-coded rate
        const symbol = ISIN_TO_YF_SYMBOL[h.ticker];
        const yfInfo = symbol ? yfData[symbol] : null;
        const divYield = yfInfo?.annualYield ?? DIVIDEND_YIELDS[h.ticker] ?? 0;
        if (divYield > 0) {
          const divCents = BigInt(Math.round(Number(mv) * divYield));
          const subtype = account.investmentSubtype ?? null;
          const divTaxRate = dividendEffectiveTaxRate(h.ticker, subtype);
          const divNetCents = BigInt(Math.round(Number(divCents) * (1 - divTaxRate)));
          annualDividendsCents += divCents;
          annualDividendsNetCents += divNetCents;
          if (symbol) {
            dividendRowsData.push({
              isin: h.ticker,
              name: h.name ?? h.ticker,
              symbol,
              subtype,
              country: h.ticker.slice(0, 2).toUpperCase(),
              valueCents: mv,
              annualEstCents: divCents,
              annualNetCents: divNetCents,
              taxRate: divTaxRate,
              divYield,
            });
          }
        }

        if (h.costBasisCents != null && taxRate !== null) {
          hasBasis = true;
          const gain = mv - h.costBasisCents;
          accountCostBasis += h.costBasisCents;
          accountGain += gain;
        }
      }
      if (hasBasis && taxRate !== null) {
        accountTax = accountGain > BigInt(0)
          ? BigInt(Math.round(Number(accountGain) * taxRate))
          : BigInt(0);
        totalLatentTax += accountTax;
      }
      if (hasBasis && account.type === "INVESTMENT") {
        investPerfRowsInternal.push({
          id: account.id,
          name: account.name,
          institution: account.institution?.name ?? "",
          subtype: account.investmentSubtype ?? null,
          value,
          costBasis: accountCostBasis,
          gain: accountGain,
          tax: accountTax,
          investmentStartDate: account.investmentStartDate ?? null,
        });
      }
      allocation[account.type === "CRYPTO" ? "crypto" : "investments"] += value;
      grossAssets += value;
    } else if (account.type === "LOAN") {
      // Loan: pure liability - reduces net worth, no asset counterpart
      const loanBalance = hasLoanParams(account)
        ? calcCurrentCapital(
            {
              loanAmountCents: account.loanAmountCents,
              loanTaeg: account.loanTaeg,
              loanDurationMonths: account.loanDurationMonths,
              loanDeferralMonths: account.loanDeferralMonths ?? 0,
              loanStartDate: account.loanStartDate,
            },
            now
          )
        : (account.liabilityCents ?? BigInt(0));
      totalLiabilities += loanBalance;
      // Skip assetRows - this is a liability, not an asset
      continue;
    } else {
      value = account.history[0]?.balanceCents ?? BigInt(0);
      if (account.type === "SAVINGS") {
        allocation["savings"] += value;
        // French regulated savings rates as of 2026-06-01 - update when rates change
        const name = account.name.toLowerCase();
        let rate = 0;
        if (name.includes("lep")) rate = 0.025;           // LEP: 2.5%
        else if (name.includes("livret a")) rate = 0.015; // Livret A: 1.5%
        else if (name.includes("ldds")) rate = 0.015;     // LDDS = Livret A: 1.5%
        else if (name.includes("livret jeune") || name.includes("jeune")) rate = 0.025; // Livret Jeune: 2.5%
        else if (name.includes("livret")) rate = 0.015;   // other regulated savings: 1.5%
        if (rate > 0) annualInterestCents += BigInt(Math.round(Number(value) * rate));
      } else {
        allocation["cash"] += value;
        // Trade Republic cash account: 2% gross → 1.372% net (flat tax 31.4%: 12.8% income tax withheld at source + 17.2% social levies + 0.2% exceptional contribution)
        if (account.syncId === "tr:cash") {
          annualInterestCents += BigInt(Math.round(Number(value) * 0.01372));
        }
      }
      grossAssets += value;
    }

    assetRows.push({
      id: account.id,
      name: account.name,
      institution: account.institution?.name ?? "",
      type: account.type,
      subtype: account.investmentSubtype ?? null,
      value,
      costBasis: hasBasis ? accountCostBasis : null,
      gain: hasBasis ? accountGain : null,
      tax: hasBasis ? accountTax : null,
    });
  }

  // ── Investment performance (CTO / PEA) ──────────────────────────────────
  const investTotalCostBasis = investPerfRowsInternal.reduce((s, r) => s + r.costBasis, BigInt(0));
  const investTotalValue = investPerfRowsInternal.reduce((s, r) => s + r.value, BigInt(0));
  const investTotalGain = investPerfRowsInternal.reduce((s, r) => s + r.gain, BigInt(0));
  const investTotalTax = investPerfRowsInternal.reduce((s, r) => s + r.tax, BigInt(0));
  const investTotalGainNet = investTotalGain - investTotalTax;
  const investReturnPct = investTotalCostBasis > BigInt(0)
    ? (Number(investTotalGain) / Number(investTotalCostBasis)) * 100
    : 0;
  // Overall CAGR - weighted by invested capital when start dates are known
  // CAGR(r) = (value / cost)^(1/years) − 1
  const investAllHaveDates = investPerfRowsInternal.length > 0 && investPerfRowsInternal.every((r) => r.investmentStartDate !== null);
  let investCAGR: number | null = null;
  let investCAGRWeightedYears: number | null = null;
  if (investAllHaveDates && investTotalCostBasis > BigInt(0)) {
    // Duration in years per account, weighted by cost basis
    const weightedYears = investPerfRowsInternal.reduce((sum, r) => {
      const years = (nowMs - r.investmentStartDate!.getTime()) / (365.25 * 86_400_000);
      return sum + years * Number(r.costBasis);
    }, 0) / Number(investTotalCostBasis);
    if (weightedYears >= 1 / 12) {
      const totalReturn = Number(investTotalValue) / Number(investTotalCostBasis);
      investCAGR = (Math.pow(totalReturn, 1 / weightedYears) - 1) * 100;
      investCAGRWeightedYears = weightedYears;
    }
  }

  // Per-row return%, net gain, and CAGR - computed once here instead of inline in JSX
  const investPerfRows: InvestPerfRow[] = investPerfRowsInternal.map((row) => {
    const returnPct = Number(row.costBasis) > 0
      ? (Number(row.gain) / Number(row.costBasis)) * 100
      : 0;
    const gainNet = row.gain - row.tax;
    let cagr: number | null = null;
    if (row.investmentStartDate && Number(row.costBasis) > 0) {
      const years = (nowMs - row.investmentStartDate.getTime()) / (365.25 * 86_400_000);
      if (years >= 1 / 12) {
        cagr = (Math.pow(Number(row.value) / Number(row.costBasis), 1 / years) - 1) * 100;
      }
    }
    return { ...row, returnPct, gainNet, cagr };
  });

  // ── Benchmark comparison ─────────────────────────────────────────────────
  // Same lookback window as investCAGR, applied to 3 reference indices - a
  // point-in-time comparison (two price snapshots), not a historical chart,
  // for the same reason investCAGR itself isn't a smooth curve (investment
  // HistoricalBalance snapshots are event-driven, not scheduled, so there's
  // no reliable daily series here).
  const benchmarkNow = new Date(nowMs);
  const benchmarkCAGRs: BenchmarkCAGRs | null =
    investCAGRWeightedYears !== null
      ? {
          msciWorld: computeIndexCAGR(input.msciWorldHistory, new Date(nowMs - investCAGRWeightedYears * 365.25 * 86_400_000), benchmarkNow),
          sp500: computeIndexCAGR(input.sp500History, new Date(nowMs - investCAGRWeightedYears * 365.25 * 86_400_000), benchmarkNow),
          cac40: computeIndexCAGR(input.cac40History, new Date(nowMs - investCAGRWeightedYears * 365.25 * 86_400_000), benchmarkNow),
        }
      : null;

  const netWorth = grossAssets - totalLiabilities;
  const netWorthAfterTax = netWorth - totalLatentTax;
  const debtRatio = grossAssets > BigInt(0)
    ? Math.round((Number(totalLiabilities) / Number(grossAssets)) * 100)
    : 0;
  const investedPct = grossAssets > BigInt(0)
    ? Math.round(
        (Number(allocation["investments"] + allocation["crypto"]) / Number(grossAssets)) * 100
      )
    : 0;
  const hasTaxData = totalLatentTax > BigInt(0);

  // ── Allocation metrics ───────────────────────────────────────────────────
  const garantis = allocation["cash"] + allocation["savings"];
  const risques = allocation["investments"] + allocation["crypto"];
  const garantisTotal = garantis + risques;
  const garantisPct = garantisTotal > BigInt(0)
    ? Math.round((Number(garantis) / Number(garantisTotal)) * 100)
    : 50;

  const techPct = totalInvestCents > BigInt(0)
    ? Math.round((Number(techValueCents) / Number(totalInvestCents)) * 100)
    : 0;

  // ── Passive income (net after tax) ──────────────────────────────────────
  // Dividends: net after flat tax / social levies depending on account type
  // Savings interest: already net (Livret A, LDDS, LEP are income-tax-exempt in France)
  const annualPassiveCents = annualDividendsNetCents + annualInterestCents;
  const monthlyPassiveCents = Number(annualPassiveCents) / 12;

  // ── Real tracked income (IncomeEvent, year-to-date) ─────────────────────
  // This is what the "Passive income" card displays - real, user-entered
  // events, not the estimate above (annualPassiveCents/annualDividendsCents/
  // annualInterestCents survive untouched - the dividend calendar below still
  // needs them).
  const netIncomeCents = (e: { amountCents: bigint; taxWithheldCents: bigint | null }) =>
    e.amountCents - (e.taxWithheldCents ?? BigInt(0));
  const realYtdDividendsNetCents = incomeEventsYtd
    .filter((e) => e.type === "DIVIDEND")
    .reduce((sum, e) => sum + netIncomeCents(e), BigInt(0));
  const realYtdInterestNetCents = incomeEventsYtd
    .filter((e) => e.type === "INTEREST")
    .reduce((sum, e) => sum + netIncomeCents(e), BigInt(0));
  const realYtdPassiveNetCents = realYtdDividendsNetCents + realYtdInterestNetCents;

  // ── Dividend calendar ────────────────────────────────────────────────────
  const dividendCalendar: DividendCalendarRow[] = dividendRowsData
    .map((r) => ({ ...r, ...(yfData[r.symbol] ?? { exDividendDate: null, annualYield: null, annualRatePerShare: null }) }))
    .sort((a, b) => {
      if (!a.exDividendDate && !b.exDividendDate) return 0;
      if (!a.exDividendDate) return 1;
      if (!b.exDividendDate) return -1;
      return a.exDividendDate.getTime() - b.exDividendDate.getTime();
    })
    .map((r) => {
      const daysLeft = r.exDividendDate
        ? Math.ceil((r.exDividendDate.getTime() - nowMs) / 86_400_000)
        : null;
      const isPast = daysLeft !== null && daysLeft < 0;
      const isSoon = daysLeft !== null && daysLeft >= 0 && daysLeft <= 30;
      return { ...r, daysLeft, isPast, isSoon };
    });

  // ── Goal progress ───────────────────────────────────────────────────────
  const goalCents = settings.savingsGoalCents > BigInt(0)
    ? settings.savingsGoalCents
    : BigInt(5000000);
  const goalPct = Math.min(
    Math.round((Number(netWorth) / Number(goalCents)) * 100),
    100
  );
  const goalRemaining = goalCents - netWorth > BigInt(0) ? goalCents - netWorth : BigInt(0);

  // ── Cash-flow metrics (require user settings) ───────────────────────────
  const hasSalary = settings.salaryNetCents > BigInt(0);
  const hasExpenses = settings.monthlyExpensesCents > BigInt(0);

  // Runway = total savings / monthly expenses
  const runwayMonths = hasExpenses
    ? Number(allocation["savings"]) / Number(settings.monthlyExpensesCents)
    : null;

  // ── History ─────────────────────────────────────────────────────────────
  const liabMap = new Map<string, bigint>();
  for (const a of accounts) liabMap.set(a.id, a.liabilityCents ?? BigInt(0));

  // Monthly aggregation - for performance table & MOM delta
  const monthMap = new Map<string, Map<string, bigint>>();
  for (const b of allBalances) {
    const month = b.recordedAt.toISOString().slice(0, 7);
    if (!monthMap.has(month)) monthMap.set(month, new Map());
    monthMap.get(month)!.set(b.accountId, b.balanceCents);
  }
  const runningM = new Map<string, bigint>();
  const monthlyHistory: MonthlyHistoryPoint[] = [...monthMap.keys()].sort().map((month) => {
    for (const [id, v] of monthMap.get(month)!) runningM.set(id, v);
    let gross = BigInt(0);
    for (const v of runningM.values()) gross += v;
    let liab = BigInt(0);
    for (const [id, v] of liabMap) { if (runningM.has(id)) liab += v; }
    const [y, m] = month.split("-");
    return {
      month,
      date: new Intl.DateTimeFormat(intlLocale, { month: "short", year: "2-digit" }).format(new Date(+y, +m - 1, 1)),
      netWorth: Number(gross - liab),
    };
  });

  // Daily aggregation - for the chart
  const dayMap = new Map<string, Map<string, bigint>>();
  for (const b of allBalances) {
    const day = b.recordedAt.toISOString().slice(0, 10);
    if (!dayMap.has(day)) dayMap.set(day, new Map());
    dayMap.get(day)!.set(b.accountId, b.balanceCents);
  }
  const runningD = new Map<string, bigint>();
  const dailyHistory: HistoryPoint[] = [...dayMap.keys()].sort().map((day) => {
    for (const [id, v] of dayMap.get(day)!) runningD.set(id, v);
    let gross = BigInt(0);
    for (const v of runningD.values()) gross += v;
    let liab = BigInt(0);
    for (const [id, v] of liabMap) { if (runningD.has(id)) liab += v; }
    const [y, m, d] = day.split("-");
    return {
      date: new Intl.DateTimeFormat(intlLocale, { day: "numeric", month: "short" }).format(new Date(+y, +m - 1, +d)),
      netWorth: Number(gross - liab),
    };
  });

  // ── MOM performance ─────────────────────────────────────────────────────
  const last6Months = monthlyHistory.slice(-6);
  const performanceRows: PerformanceRow[] = last6Months.map((row, i) => {
    const prev = i > 0 ? last6Months[i - 1].netWorth : null;
    const delta = prev !== null ? row.netWorth - prev : null;
    const deltaPct = prev && prev !== 0 ? (delta! / Math.abs(prev)) * 100 : null;
    return { ...row, delta, deltaPct };
  });

  const momDelta =
    monthlyHistory.length >= 2
      ? monthlyHistory[monthlyHistory.length - 1].netWorth -
        monthlyHistory[monthlyHistory.length - 2].netWorth
      : null;

  // Savings rate: declared monthly savings take priority (avoids MOM distortion from
  // inter-account transfers, market performance, and first-sync balance imports)
  const hasDeclaredSavings = settings.monthlySavedCents > BigInt(0);
  const savingsRate = hasSalary
    ? hasDeclaredSavings
      ? (Number(settings.monthlySavedCents) / Number(settings.salaryNetCents)) * 100
      : momDelta !== null
      ? (momDelta / Number(settings.salaryNetCents)) * 100
      : null
    : null;

  // ── Top assets ──────────────────────────────────────────────────────────
  const topAssets: TopAssetRow[] = [...assetRows]
    .sort((a, b) => Number(b.value - a.value))
    .slice(0, 10)
    .map((asset) => ({
      ...asset,
      pct: grossAssets > BigInt(0) ? Math.round((Number(asset.value) / Number(grossAssets)) * 100) : 0,
    }));

  // ── Allocation slices ───────────────────────────────────────────────────
  const allocationSlices: AllocationSliceResult[] = Object.entries(allocation)
    .filter(([, v]) => v > BigInt(0))
    .map(([key, value]) => ({
      key,
      value: Number(value),
      color: CATEGORY_COLORS[key] ?? "#6b7280",
    }))
    .sort((a, b) => b.value - a.value);

  const totalAllocation = allocationSlices.reduce((s, d) => s + d.value, 0);

  // ── Debt accounts ────────────────────────────────────────────────────────
  // Asset-backed liabilities (real estate, auto) only - LOAN accounts have their own tab
  const debtAccounts: DebtAccountRow[] = accounts
    .filter((a) => a.type !== "LOAN" && (a.liabilityCents ?? BigInt(0)) > BigInt(0))
    .map((a) => {
      const value = a.manualValueCents ?? BigInt(0);
      const liability = a.liabilityCents ?? BigInt(0);
      return {
        id: a.id,
        name: a.name,
        institution: a.institution?.name ?? "",
        type: a.type,
        value,
        liability,
        equity: value - liability,
        ltv: value > BigInt(0) ? Math.round((Number(liability) / Number(value)) * 100) : 0,
      };
    });

  // Not grossAssets > 0 - a LOAN-only portfolio has real data (a mortgage,
  // real payments) but zero gross assets by design (pure liability, no
  // asset counterpart). Gating on grossAssets showed the empty state to a
  // user who'd already added an account.
  const hasData = accounts.length > 0;

  return {
    hasData,
    netWorth,
    netWorthAfterTax,
    grossAssets,
    totalLiabilities,
    totalLatentTax,
    investedPct,
    hasTaxData,
    momDelta,
    hasSalary,
    hasDeclaredSavings,
    savingsRate,
    salaryNetCents: settings.salaryNetCents,
    monthlySavedCents: settings.monthlySavedCents,
    hasExpenses,
    runwayMonths,
    monthlyExpensesCents: settings.monthlyExpensesCents,
    savingsCents: allocation["savings"],
    goalCents,
    goalPct,
    goalRemaining,
    realYtdDividendsNetCents,
    realYtdInterestNetCents,
    realYtdPassiveNetCents,
    annualDividendsCents,
    annualDividendsNetCents,
    annualInterestCents,
    annualPassiveCents,
    monthlyPassiveCents,
    dividendCalendar,
    investPerfRows,
    investTotalCostBasis,
    investTotalValue,
    investTotalGain,
    investTotalTax,
    investTotalGainNet,
    investReturnPct,
    investCAGR,
    investAllHaveDates,
    taxRatePea: settings.taxRatePea,
    taxRateCto: settings.taxRateCto,
    benchmarkCAGRs,
    garantis,
    risques,
    garantisPct,
    techPct,
    allocationSlices,
    totalAllocation,
    dailyHistory,
    performanceRows,
    topAssets,
    debtAccounts,
    debtRatio,
  };
}

/**
 * Builds the serialized (no BigInt) export payload for ExportAnalyticsButton.
 * Kept separate from computeAnalytics because it needs allocation category
 * (and account type) labels already translated, which is a rendering/i18n
 * concern the pure computation above must stay free of.
 */
export function buildAnalyticsExport(
  result: AnalyticsResult,
  allocationLabels: Record<string, string>,
  typeLabels: Record<string, string>
): AnalyticsExportData {
  return {
    netWorth: Number(result.netWorth),
    netWorthAfterTax: Number(result.netWorthAfterTax),
    grossAssets: Number(result.grossAssets),
    totalLiabilities: Number(result.totalLiabilities),
    totalLatentTax: Number(result.totalLatentTax),
    investedPct: result.investedPct,
    hasTaxData: result.hasTaxData,
    savingsRate: result.savingsRate ?? null,
    salaryNetCents: Number(result.salaryNetCents),
    monthlySavedCents: Number(result.monthlySavedCents),
    momDeltaCents: result.momDelta ?? null,
    runwayMonths: result.runwayMonths ?? null,
    savingsCents: Number(result.savingsCents),
    monthlyExpensesCents: Number(result.monthlyExpensesCents),
    goalCents: Number(result.goalCents),
    goalPct: result.goalPct,
    goalRemainingCents: Number(result.goalRemaining),
    allocationSlices: result.allocationSlices.map((s) => ({
      name: allocationLabels[s.key] ?? s.key,
      valueCents: s.value,
      pct: result.totalAllocation > 0 ? Math.round((s.value / result.totalAllocation) * 100) : 0,
    })),
    investPerfRows: result.investPerfRows.map((r) => ({
      name: r.name,
      institution: r.institution,
      subtype: r.subtype,
      valueCents: Number(r.value),
      costBasisCents: Number(r.costBasis),
      gainCents: Number(r.gain),
      taxCents: Number(r.tax),
      returnPct: r.returnPct,
    })),
    investTotalValueCents: Number(result.investTotalValue),
    investTotalCostBasisCents: Number(result.investTotalCostBasis),
    investTotalGainCents: Number(result.investTotalGain),
    investTotalTaxCents: Number(result.investTotalTax),
    investReturnPct: result.investReturnPct,
    investCAGR: result.investCAGR ?? null,
    dividendRows: result.dividendCalendar.map((r) => ({
      name: r.name,
      symbol: r.symbol,
      country: r.country,
      subtype: r.subtype,
      valueCents: Number(r.valueCents),
      annualEstCents: Number(r.annualEstCents),
      annualNetCents: Number(r.annualNetCents),
      taxRate: r.taxRate,
      divYield: r.divYield,
      exDividendDate: r.exDividendDate ? r.exDividendDate.toISOString() : null,
    })),
    annualDividendsCents: Number(result.annualDividendsCents),
    annualDividendsNetCents: Number(result.annualDividendsNetCents),
    annualInterestCents: Number(result.annualInterestCents),
    annualPassiveCents: Number(result.annualPassiveCents),
    monthlyPassiveCents: result.monthlyPassiveCents,
    performanceRows: result.performanceRows.map((r) => ({
      date: r.date,
      netWorth: r.netWorth,
      delta: r.delta ?? null,
      deltaPct: r.deltaPct ?? null,
    })),
    realYtdDividendsNetCents: Number(result.realYtdDividendsNetCents),
    realYtdInterestNetCents: Number(result.realYtdInterestNetCents),
    realYtdPassiveNetCents: Number(result.realYtdPassiveNetCents),
    benchmark:
      result.investCAGR !== null && result.benchmarkCAGRs !== null
        ? {
            investCAGR: result.investCAGR,
            msciWorld: result.benchmarkCAGRs.msciWorld,
            sp500: result.benchmarkCAGRs.sp500,
            cac40: result.benchmarkCAGRs.cac40,
          }
        : null,
    garantisCents: Number(result.garantis),
    risquesCents: Number(result.risques),
    garantisPct: result.garantisPct,
    techPct: result.techPct,
    topAssets: result.topAssets.map((a) => ({
      name: a.name,
      institution: a.institution,
      typeLabel: typeLabels[a.type] ?? a.type,
      subtype: a.subtype,
      valueCents: Number(a.value),
      gainCents: a.gain !== null ? Number(a.gain) : null,
      taxCents: a.tax !== null ? Number(a.tax) : null,
      pct: a.pct,
    })),
    debtAccounts: result.debtAccounts.map((a) => ({
      name: a.name,
      institution: a.institution,
      typeLabel: typeLabels[a.type] ?? a.type,
      valueCents: Number(a.value),
      liabilityCents: Number(a.liability),
      equityCents: Number(a.equity),
      ltv: a.ltv,
    })),
    debtRatio: result.debtRatio,
  };
}
