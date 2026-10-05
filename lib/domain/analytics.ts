/**
 * Analytics aggregation. The single pass over every account that produces the
 * whole /analytics page.
 *
 * Split into siblings at v2.10.2, after four release audits in a row flagged
 * this file for size (1148 lines): the static market data lives in
 * analytics-market.ts, the input/result shapes in analytics-types.ts, and the
 * export payload in analytics-export.ts. Nothing moved between them but text -
 * the aggregation below is unchanged, and both are re-exported here so the
 * fifteen call sites keep importing from one module.
 */
import { getAccountTaxRate } from "@/lib/domain/tax";
import { calcCurrentCapital, hasLoanParams } from "@/lib/domain/loan";
import { ALLOCATION_CATEGORY_COLORS as CATEGORY_COLORS } from "@/lib/utils/palette";
import {
  computeSavingsInterestProjection,
  computeGoalRows,
  computeDebtAccounts,
  computeBenchmarkCAGRs,
  analyseHoldings,
  analyseFiatAccount,
  type PendingDividendRow,
} from "@/lib/domain/analytics-sections";
import type {
  AnalyticsInput,
  AnalyticsResult,
  AllocationSliceResult,
  AssetRow,
  DividendCalendarRow,
  InvestPerfRow,
  MonthlyHistoryPoint,
  PerformanceRow,
  TopAssetRow,
} from "@/lib/domain/analytics-types";

export * from "@/lib/domain/analytics-market";
export * from "@/lib/domain/analytics-types";
export * from "@/lib/domain/analytics-export";

// ── computeAnalytics ─────────────────────────────────────────────────────────
//
// One pass over the accounts, then a series of pure derivations from what that
// pass accumulated. Split at v2.11 from a single CCN-44 function into the
// steps below; __tests__/money-characterization.test.ts pins the whole result
// to the cent, with and without market data, and did not move.

type InvestPerfRowInternal = Omit<InvestPerfRow, "returnPct" | "gainNet" | "cagr">;
type Account = AnalyticsInput["accounts"][number];

/** Everything the per-account pass accumulates. */
type AccountTotals = {
  grossAssets: bigint;
  totalLiabilities: bigint;
  totalLatentTax: bigint;
  // Gain-weighted blended effective tax rate across every account with a real
  // unrealized gain, for the projection chart's tax-aware mode (see
  // lib/domain/projection.ts): Σ(taxRate * gainCents) over Σ(gainCents).
  // EXEMPT/DEFERRED accounts contribute rate 0, pulling the blend down for a
  // mostly tax-advantaged portfolio, exactly as totalLatentTax itself does.
  weightedTaxRateSum: number;
  totalPositiveGainCents: bigint;
  annualDividendsCents: bigint;    // gross
  annualDividendsNetCents: bigint; // net after tax
  annualInterestCents: bigint;     // already net (French regulated savings are income-tax-exempt)
  // Interest-bearing accounts with no rate set. A null rate contributes
  // nothing, which is correct - but indistinguishable on screen from an
  // account that genuinely pays none, and this estimate is consumed by the
  // markdown export where nobody would ever see the shortfall. Counting it
  // lets the consumer say "this figure covers 2 of your 4 savings accounts".
  accountsMissingInterestRate: number;
  // Balance-weighted average rate across SAVINGS accounts with a known rate:
  // a plain average would treat a 50€ Livret Jeune at 2.5% as equally
  // significant as a 15,000€ Livret A at 1.5%. Accounts with no rate are left
  // out of both sums rather than assumed to earn 0.
  weightedSavingsRateSum: number; // Σ(rate * balanceCents)
  savingsBalanceWithRateCents: bigint;
  allocation: Record<string, bigint>;
  assetRows: AssetRow[];
  investPerfRowsInternal: InvestPerfRowInternal[];
  dividendRowsData: PendingDividendRow[];
};

function emptyTotals(): AccountTotals {
  return {
    grossAssets: BigInt(0),
    totalLiabilities: BigInt(0),
    totalLatentTax: BigInt(0),
    weightedTaxRateSum: 0,
    totalPositiveGainCents: BigInt(0),
    annualDividendsCents: BigInt(0),
    annualDividendsNetCents: BigInt(0),
    annualInterestCents: BigInt(0),
    accountsMissingInterestRate: 0,
    weightedSavingsRateSum: 0,
    savingsBalanceWithRateCents: BigInt(0),
    allocation: {
      cash: BigInt(0),
      savings: BigInt(0),
      investments: BigInt(0),
      crypto: BigInt(0),
      realEstate: BigInt(0),
      auto: BigInt(0),
    },
    assetRows: [],
    investPerfRowsInternal: [],
    dividendRowsData: [],
  };
}

/** An account's value, and its cost basis/gain/tax when those are known. */
type AccountValuation = {
  value: bigint;
  basis: { costBasis: bigint; gain: bigint; tax: bigint } | null;
};

/** Real estate and cars: a manual value, with equity counted in allocation. */
function addManualAsset(t: AccountTotals, account: Account): AccountValuation {
  const value = account.manualValueCents ?? BigInt(0);
  const liability = account.liabilityCents ?? BigInt(0);
  t.totalLiabilities += liability;
  const equity = value - liability > BigInt(0) ? value - liability : BigInt(0);
  t.allocation[account.type === "AUTOMOBILE" ? "auto" : "realEstate"] += equity;
  t.grossAssets += value;
  return { value, basis: null };
}

/** Latent tax on a gain, accumulated into the blended-rate sums. */
function addLatentTax(t: AccountTotals, gain: bigint, taxRate: number): bigint {
  const tax = gain > BigInt(0) ? BigInt(Math.round(Number(gain) * taxRate)) : BigInt(0);
  t.totalLatentTax += tax;
  if (gain > BigInt(0)) {
    t.weightedTaxRateSum += taxRate * Number(gain);
    t.totalPositiveGainCents += gain;
  }
  return tax;
}

function addInvestmentAccount(t: AccountTotals, account: Account, yfData: AnalyticsInput["yfData"]): AccountValuation {
  const taxRate = getAccountTaxRate(account);
  const contrib = analyseHoldings(account, taxRate, yfData);
  t.annualDividendsCents += contrib.dividendsGrossCents;
  t.annualDividendsNetCents += contrib.dividendsNetCents;
  t.dividendRowsData.push(...contrib.dividendRows);

  const tax = contrib.hasBasis && taxRate !== null ? addLatentTax(t, contrib.gain, taxRate) : BigInt(0);
  if (contrib.hasBasis && account.type === "INVESTMENT") {
    t.investPerfRowsInternal.push({
      id: account.id,
      name: account.name,
      institution: account.institution?.name ?? "",
      subtype: account.investmentSubtype ?? null,
      value: contrib.value,
      costBasis: contrib.costBasis,
      gain: contrib.gain,
      tax,
      investmentStartDate: account.investmentStartDate ?? null,
    });
  }
  t.allocation[account.type === "CRYPTO" ? "crypto" : "investments"] += contrib.value;
  t.grossAssets += contrib.value;
  return {
    value: contrib.value,
    basis: contrib.hasBasis ? { costBasis: contrib.costBasis, gain: contrib.gain, tax } : null,
  };
}

/** A loan is a pure liability: it reduces net worth and has no asset row. */
function loanOutstanding(account: Account, now: Date): bigint {
  if (!hasLoanParams(account)) return account.liabilityCents ?? BigInt(0);
  return calcCurrentCapital(
    {
      loanAmountCents: account.loanAmountCents,
      loanTaeg: account.loanTaeg,
      loanDurationMonths: account.loanDurationMonths,
      loanDeferralMonths: account.loanDeferralMonths ?? 0,
      loanStartDate: account.loanStartDate,
    },
    now
  );
}

function addFiatAccount(t: AccountTotals, account: Account): AccountValuation {
  const fiat = analyseFiatAccount(account);
  t.allocation[fiat.bucket] += fiat.value;
  t.annualInterestCents += fiat.annualInterestCents;
  t.weightedSavingsRateSum += fiat.weightedRateSum;
  t.savingsBalanceWithRateCents += fiat.balanceWithRateCents;
  if (fiat.missingRate) t.accountsMissingInterestRate += 1;
  t.grossAssets += fiat.value;
  return { value: fiat.value, basis: null };
}

function valueAccount(t: AccountTotals, account: Account, yfData: AnalyticsInput["yfData"]): AccountValuation {
  if (account.type === "REAL_ESTATE" || account.type === "AUTOMOBILE") return addManualAsset(t, account);
  if (account.type === "INVESTMENT" || account.type === "CRYPTO") return addInvestmentAccount(t, account, yfData);
  return addFiatAccount(t, account);
}

/** The single pass: each account is visited once and feeds every total. */
function aggregateAccounts(accounts: Account[], yfData: AnalyticsInput["yfData"], now: Date): AccountTotals {
  const t = emptyTotals();
  for (const account of accounts) {
    if (account.type === "LOAN") {
      t.totalLiabilities += loanOutstanding(account, now);
      continue;
    }
    const { value, basis } = valueAccount(t, account, yfData);
    t.assetRows.push({
      id: account.id,
      name: account.name,
      institution: account.institution?.name ?? "",
      type: account.type,
      subtype: account.investmentSubtype ?? null,
      value,
      costBasis: basis ? basis.costBasis : null,
      gain: basis ? basis.gain : null,
      tax: basis ? basis.tax : null,
    });
  }
  return t;
}

const YEAR_MS = 365.25 * 86_400_000;

/** CAGR(r) = (value / cost)^(1/years) − 1, as a percentage. */
function cagrPct(value: number, cost: number, years: number): number {
  return (Math.pow(value / cost, 1 / years) - 1) * 100;
}

/** Math.round(part / whole * 100), or the fallback when there is no whole. */
function roundedPct(part: bigint, whole: bigint, fallback: number): number {
  return whole > BigInt(0) ? Math.round((Number(part) / Number(whole)) * 100) : fallback;
}

function sumBy(rows: InvestPerfRowInternal[], pick: (r: InvestPerfRowInternal) => bigint): bigint {
  return rows.reduce((s, r) => s + pick(r), BigInt(0));
}

/**
 * Overall CAGR, over a duration weighted by invested capital. Only when every
 * account has a start date, and never for less than a month of history.
 */
function portfolioCAGR(rows: InvestPerfRowInternal[], totalCost: bigint, totalValue: bigint, nowMs: number) {
  const allHaveDates = rows.length > 0 && rows.every((r) => r.investmentStartDate !== null);
  if (!allHaveDates || totalCost <= BigInt(0)) return { allHaveDates, cagr: null, weightedYears: null };
  const weightedYears = rows.reduce((sum, r) => {
    const years = (nowMs - r.investmentStartDate!.getTime()) / YEAR_MS;
    return sum + years * Number(r.costBasis);
  }, 0) / Number(totalCost);
  if (weightedYears < 1 / 12) return { allHaveDates, cagr: null, weightedYears: null };
  return { allHaveDates, cagr: cagrPct(Number(totalValue), Number(totalCost), weightedYears), weightedYears };
}

/** Per-row return%, net gain and CAGR, computed once rather than in JSX. */
function withReturns(row: InvestPerfRowInternal, nowMs: number): InvestPerfRow {
  const returnPct = Number(row.costBasis) > 0 ? (Number(row.gain) / Number(row.costBasis)) * 100 : 0;
  let cagr: number | null = null;
  if (row.investmentStartDate && Number(row.costBasis) > 0) {
    const years = (nowMs - row.investmentStartDate.getTime()) / YEAR_MS;
    if (years >= 1 / 12) cagr = cagrPct(Number(row.value), Number(row.costBasis), years);
  }
  return { ...row, returnPct, gainNet: row.gain - row.tax, cagr };
}

/** Investment performance (CTO / PEA): totals, overall CAGR, per-row figures. */
function computeInvestmentPerformance(rows: InvestPerfRowInternal[], nowMs: number) {
  const investTotalCostBasis = sumBy(rows, (r) => r.costBasis);
  const investTotalValue = sumBy(rows, (r) => r.value);
  const investTotalGain = sumBy(rows, (r) => r.gain);
  const investTotalTax = sumBy(rows, (r) => r.tax);
  const investReturnPct = investTotalCostBasis > BigInt(0)
    ? (Number(investTotalGain) / Number(investTotalCostBasis)) * 100
    : 0;
  const overall = portfolioCAGR(rows, investTotalCostBasis, investTotalValue, nowMs);
  return {
    investTotalCostBasis,
    investTotalValue,
    investTotalGain,
    investTotalTax,
    investTotalGainNet: investTotalGain - investTotalTax,
    investReturnPct,
    investAllHaveDates: overall.allHaveDates,
    investCAGR: overall.cagr,
    investCAGRWeightedYears: overall.weightedYears,
    investPerfRows: rows.map((row) => withReturns(row, nowMs)),
  };
}

/**
 * Real tracked income (IncomeEvent, year to date) - what the "Passive income"
 * card displays. Distinct from the dividend/interest ESTIMATE, which the
 * dividend calendar still needs.
 */
function computeRealYtdIncome(events: AnalyticsInput["incomeEventsYtd"]) {
  const net = (type: string) =>
    events
      .filter((e) => e.type === type)
      .reduce((sum, e) => sum + (e.amountCents - (e.taxWithheldCents ?? BigInt(0))), BigInt(0));
  const realYtdDividendsNetCents = net("DIVIDEND");
  const realYtdInterestNetCents = net("INTEREST");
  return {
    realYtdDividendsNetCents,
    realYtdInterestNetCents,
    realYtdPassiveNetCents: realYtdDividendsNetCents + realYtdInterestNetCents,
  };
}

/** Known ex-dividend dates first, soonest first; unknown ones last. */
function byExDividendDate(a: { exDividendDate: Date | null }, b: { exDividendDate: Date | null }): number {
  if (!a.exDividendDate && !b.exDividendDate) return 0;
  if (!a.exDividendDate) return 1;
  if (!b.exDividendDate) return -1;
  return a.exDividendDate.getTime() - b.exDividendDate.getTime();
}

function buildDividendCalendar(
  rows: PendingDividendRow[],
  yfData: AnalyticsInput["yfData"],
  nowMs: number
): DividendCalendarRow[] {
  return rows
    .map((r) => ({ ...r, ...(yfData[r.symbol] ?? { exDividendDate: null, annualYield: null, annualRatePerShare: null }) }))
    .sort(byExDividendDate)
    .map((r) => {
      const daysLeft = r.exDividendDate ? Math.ceil((r.exDividendDate.getTime() - nowMs) / 86_400_000) : null;
      const isPast = daysLeft !== null && daysLeft < 0;
      const isSoon = daysLeft !== null && daysLeft >= 0 && daysLeft <= 30;
      return { ...r, daysLeft, isPast, isSoon };
    });
}

/**
 * Month-end net worth, carrying each account's last known balance forward
 * through months where it has no row. Liabilities count only once their
 * account has appeared.
 */
function computeMonthlyHistory(
  accounts: Account[],
  allBalances: AnalyticsInput["allBalances"],
  intlLocale: string
): MonthlyHistoryPoint[] {
  const liabMap = new Map<string, bigint>();
  for (const a of accounts) liabMap.set(a.id, a.liabilityCents ?? BigInt(0));

  const monthMap = new Map<string, Map<string, bigint>>();
  for (const b of allBalances) {
    const month = b.recordedAt.toISOString().slice(0, 7);
    if (!monthMap.has(month)) monthMap.set(month, new Map());
    monthMap.get(month)!.set(b.accountId, b.balanceCents);
  }
  const running = new Map<string, bigint>();
  // NOSONAR (typescript:S2871) - "YYYY-MM" keys (ISO 8601, from
  // toISOString().slice(0,7) above): lexicographic order already equals
  // chronological order by design, localeCompare adds nothing here.
  return [...monthMap.keys()].sort().map((month) => { // NOSONAR
    for (const [id, v] of monthMap.get(month)!) running.set(id, v);
    let gross = BigInt(0);
    for (const v of running.values()) gross += v;
    let liab = BigInt(0);
    for (const [id, v] of liabMap) { if (running.has(id)) liab += v; }
    const [y, m] = month.split("-");
    return {
      month,
      date: new Intl.DateTimeFormat(intlLocale, { month: "short", year: "2-digit" }).format(new Date(+y, +m - 1, 1)),
      netWorth: Number(gross - liab),
    };
  });
}

/** The last six months, each with its change against the month before. */
function computePerformanceRows(monthlyHistory: MonthlyHistoryPoint[]): PerformanceRow[] {
  const last6Months = monthlyHistory.slice(-6);
  return last6Months.map((row, i) => {
    const prev = i > 0 ? last6Months[i - 1].netWorth : null;
    const delta = prev !== null ? row.netWorth - prev : null;
    const deltaPct = prev && prev !== 0 ? (delta! / Math.abs(prev)) * 100 : null;
    return { ...row, delta, deltaPct };
  });
}

function monthOnMonthDelta(monthlyHistory: MonthlyHistoryPoint[]): number | null {
  return monthlyHistory.length >= 2
    ? monthlyHistory.at(-1)!.netWorth - monthlyHistory.at(-2)!.netWorth
    : null;
}

/**
 * Declared monthly savings take priority over the month-on-month delta,
 * which inter-account transfers, market moves and first-sync imports distort.
 */
function computeSavingsRate(settings: AnalyticsInput["settings"], momDelta: number | null): number | null {
  if (settings.salaryNetCents <= BigInt(0)) return null;
  if (settings.monthlySavedCents > BigInt(0)) {
    return (Number(settings.monthlySavedCents) / Number(settings.salaryNetCents)) * 100;
  }
  return momDelta !== null ? (momDelta / Number(settings.salaryNetCents)) * 100 : null;
}

function buildTopAssets(assetRows: AssetRow[], grossAssets: bigint): TopAssetRow[] {
  return [...assetRows]
    .sort((a, b) => Number(b.value - a.value))
    .slice(0, 10)
    .map((asset) => ({ ...asset, pct: roundedPct(asset.value, grossAssets, 0) }));
}

function buildAllocationSlices(allocation: Record<string, bigint>): AllocationSliceResult[] {
  return Object.entries(allocation)
    .filter(([, v]) => v > BigInt(0))
    .map(([key, value]) => ({
      key,
      value: Number(value),
      color: CATEGORY_COLORS[key] ?? "#6b7280",
    }))
    .sort((a, b) => b.value - a.value);
}

export function computeAnalytics(input: AnalyticsInput): AnalyticsResult {
  const { accounts, allBalances, settings, goals, yfData, incomeEventsYtd, intlLocale, now } = input;
  const nowMs = now.getTime();

  const t = aggregateAccounts(accounts, yfData, now);
  const { grossAssets, totalLiabilities, totalLatentTax, allocation, assetRows } = t;

  const perf = computeInvestmentPerformance(t.investPerfRowsInternal, nowMs);
  const benchmarkCAGRs = computeBenchmarkCAGRs(
    { msciWorld: input.msciWorldHistory, sp500: input.sp500History, cac40: input.cac40History },
    perf.investCAGRWeightedYears,
    nowMs,
  );

  // "Net worth" means AFTER latent tax, here as in lib/domain/dashboard.ts.
  // These two files used to disagree - this one called the pre-tax figure
  // `netWorth` - and the disagreement was not academic: the KPI card knew to
  // display the after-tax one, but the goals on the same page were fed this
  // variable, so a goal could read 100% complete against a number the card
  // directly above it said you did not have.
  const netWorthBeforeTax = grossAssets - totalLiabilities;
  const netWorth = netWorthBeforeTax - totalLatentTax;

  // Allocation metrics: "garantis" (cash + savings) against "risqués".
  const garantis = allocation["cash"] + allocation["savings"];
  const risques = allocation["investments"] + allocation["crypto"];

  // Passive income ESTIMATE, net after tax. Dividends: net of flat tax /
  // social levies by account type. Savings interest: already net.
  const annualPassiveCents = t.annualDividendsNetCents + t.annualInterestCents;

  const hasExpenses = settings.monthlyExpensesCents > BigInt(0);
  // Year-end savings interest projection (méthode des quinzaines).
  const { estimatedYearEndSavingsInterestCents, estimatedYearEndInterestHistory } =
    computeSavingsInterestProjection(accounts, allBalances, now, intlLocale);

  const monthlyHistory = computeMonthlyHistory(accounts, allBalances, intlLocale);
  const momDelta = monthOnMonthDelta(monthlyHistory);
  const allocationSlices = buildAllocationSlices(allocation);

  return {
    // Not grossAssets > 0 - a LOAN-only portfolio has real data (a mortgage,
    // real payments) but zero gross assets by design. Gating on grossAssets
    // showed the empty state to a user who had already added an account.
    hasData: accounts.length > 0,
    netWorth,
    netWorthBeforeTax,
    grossAssets,
    totalLiabilities,
    totalLatentTax,
    investedPct: roundedPct(allocation["investments"] + allocation["crypto"], grossAssets, 0),
    hasTaxData: totalLatentTax > BigInt(0),
    effectiveTaxRate: t.totalPositiveGainCents > BigInt(0) ? t.weightedTaxRateSum / Number(t.totalPositiveGainCents) : 0,
    momDelta,
    hasSalary: settings.salaryNetCents > BigInt(0),
    hasDeclaredSavings: settings.monthlySavedCents > BigInt(0),
    savingsRate: computeSavingsRate(settings, momDelta),
    salaryNetCents: settings.salaryNetCents,
    monthlySavedCents: settings.monthlySavedCents,
    hasExpenses,
    // Runway = total savings / monthly expenses.
    runwayMonths: hasExpenses ? Number(allocation["savings"]) / Number(settings.monthlyExpensesCents) : null,
    monthlyExpensesCents: settings.monthlyExpensesCents,
    savingsCents: allocation["savings"],
    goals: computeGoalRows(goals, assetRows, accounts, netWorth),
    ...computeRealYtdIncome(incomeEventsYtd),
    annualDividendsCents: t.annualDividendsCents,
    annualDividendsNetCents: t.annualDividendsNetCents,
    annualInterestCents: t.annualInterestCents,
    accountsMissingInterestRate: t.accountsMissingInterestRate,
    // null (not 0) when no SAVINGS account has a known rate, so a display can
    // say "no data" instead of a misleading 0%.
    weightedSavingsRatePct: t.savingsBalanceWithRateCents > BigInt(0)
      ? t.weightedSavingsRateSum / Number(t.savingsBalanceWithRateCents)
      : null,
    estimatedYearEndSavingsInterestCents,
    estimatedYearEndInterestHistory,
    annualPassiveCents,
    monthlyPassiveCents: Number(annualPassiveCents) / 12,
    dividendCalendar: buildDividendCalendar(t.dividendRowsData, yfData, nowMs),
    investPerfRows: perf.investPerfRows,
    investTotalCostBasis: perf.investTotalCostBasis,
    investTotalValue: perf.investTotalValue,
    investTotalGain: perf.investTotalGain,
    investTotalTax: perf.investTotalTax,
    investTotalGainNet: perf.investTotalGainNet,
    investReturnPct: perf.investReturnPct,
    investCAGR: perf.investCAGR,
    investAllHaveDates: perf.investAllHaveDates,
    taxRatePea: settings.taxRatePea,
    taxRateCto: settings.taxRateCto,
    benchmarkCAGRs,
    garantis,
    risques,
    garantisPct: roundedPct(garantis, garantis + risques, 50),
    allocationSlices,
    totalAllocation: allocationSlices.reduce((s, d) => s + d.value, 0),
    performanceRows: computePerformanceRows(monthlyHistory),
    topAssets: buildTopAssets(assetRows, grossAssets),
    assetRows,
    // Asset-backed liabilities (real estate, auto) only - LOAN accounts have their own tab.
    debtAccounts: computeDebtAccounts(accounts),
    debtRatio: roundedPct(totalLiabilities, grossAssets, 0),
  };
}
