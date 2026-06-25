export const dynamic = "force-dynamic";

import { prisma } from "@/lib/prisma";
import { formatCurrency } from "@/lib/format";
import { AnalyticsEmptyState } from "@/components/analytics-empty-state";
import { NetWorthChart } from "@/components/net-worth-chart";
import { AssetAllocationChart, type AllocationSlice } from "@/components/asset-allocation-chart";
import Link from "next/link";
import Decimal from "decimal.js";
import {
  ExportAnalyticsButton,
  type AnalyticsExportData,
} from "@/components/export-analytics-button";
import { calcCurrentCapital, hasLoanParams } from "@/lib/loan";
import { getTranslations } from "next-intl/server";

const CATEGORY_COLORS: Record<string, string> = {
  cash: "#6366f1",
  savings: "#8b5cf6",
  investments: "#22c55e",
  crypto: "#f59e0b",
  realEstate: "#3b82f6",
  auto: "#ec4899",
};


// Approximate tech exposure per ticker (0–1)
const TECH_WEIGHTS: Record<string, number> = {
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
const DIVIDEND_YIELDS: Record<string, number> = {
  FR0000120073: 0.020, // Air Liquide ~2%
  NL0011585146: 0.005, // Ferrari ~0.5%
  US0378331005: 0.005, // Apple ~0.5%
  US30303M1027: 0.004, // Meta ~0.4%
  US5801351017: 0.025, // McDonald's ~2.5%
  US5949181045: 0.008, // Microsoft ~0.8%
};

// Yahoo Finance ticker symbols for dividend-paying holdings
const ISIN_TO_YF_SYMBOL: Record<string, string> = {
  FR0000120073: "AI.PA",
  NL0011585146: "RACE",
  US0378331005: "AAPL",
  US30303M1027: "META",
  US5801351017: "MCD",
  US5949181045: "MSFT",
};

type YFDividendInfo = {
  exDividendDate: Date | null;
  annualYield: number | null;       // trailingAnnualDividendYield (ex: 0.025 = 2.5%) — currency-agnostic
  annualRatePerShare: number | null; // trailingAnnualDividendRate in local currency (display only)
};

// Uses the unauthenticated chart endpoint to fetch dividend history.
// Estimates the next ex-div date by extrapolating historical frequency.
async function fetchYFDividendForSymbol(symbol: string): Promise<YFDividendInfo> {
  try {
    const res = await fetch(
      `https://query2.finance.yahoo.com/v8/finance/chart/${symbol}?interval=3mo&range=2y&events=div`,
      {
        headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" },
        next: { revalidate: 3600 },
      }
    );
    if (!res.ok) return { exDividendDate: null, annualYield: null, annualRatePerShare: null };

    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) return { exDividendDate: null, annualYield: null, annualRatePerShare: null };

    type DivEvent = { amount: number; date: number };
    const divMap = result.events?.dividends as Record<string, DivEvent> | undefined;
    if (!divMap || Object.keys(divMap).length === 0) {
      return { exDividendDate: null, annualYield: null, annualRatePerShare: null };
    }

    // Sorted ex-div timestamps (keys are Unix seconds)
    const timestamps = Object.keys(divMap).map(Number).sort((a, b) => a - b);
    const amounts = timestamps.map((t) => divMap[String(t)].amount);

    // Estimated frequency in days (monthly / quarterly / semi-annual / annual)
    let freqDays = 365;
    if (timestamps.length >= 2) {
      const gaps = timestamps.slice(1).map((t, i) => (t - timestamps[i]) / 86400);
      const median = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
      freqDays = median < 45 ? 30 : median < 120 ? 91 : median < 270 ? 182 : 365;
    }
    const perYear = Math.round(365 / freqDays);
    const annualRatePerShare = amounts.slice(-perYear).reduce((s, a) => s + a, 0);

    // Yield = annual rate / current price
    const price = result.meta?.regularMarketPrice as number | undefined;
    const annualYield = price && price > 0 ? annualRatePerShare / price : null;

    // Next ex-div = last + frequency (advanced one cycle if already past)
    const lastTs = timestamps[timestamps.length - 1];
    const nowSec = Date.now() / 1000;
    let nextTs = lastTs + freqDays * 86400;
    if (nextTs < nowSec) nextTs += freqDays * 86400;

    return {
      exDividendDate: new Date(nextTs * 1000),
      annualYield,
      annualRatePerShare,
    };
  } catch {
    return { exDividendDate: null, annualYield: null, annualRatePerShare: null };
  }
}

async function fetchYFDividends(symbols: string[]): Promise<Record<string, YFDividendInfo>> {
  if (symbols.length === 0) return {};
  const entries = await Promise.all(
    symbols.map(async (s) => [s, await fetchYFDividendForSymbol(s)] as const)
  );
  return Object.fromEntries(entries);
}

function holdingMarketValue(h: { quantity: Decimal; lastPriceCents: bigint }): bigint {
  return BigInt(
    new Decimal(h.quantity.toString())
      .mul(h.lastPriceCents.toString())
      .round()
      .toNumber()
  );
}

export default async function AnalyticsPage() {
  const [t, ta, tAlloc] = await Promise.all([
    getTranslations("analytics"),
    getTranslations("accountTypes"),
    getTranslations("allocation"),
  ]);

  const [accounts, allBalances, settings, yfData] = await Promise.all([
    prisma.account.findMany({
      include: {
        institution: true,
        holdings: true,
        history: { orderBy: { recordedAt: "desc" }, take: 1 },
      },
    }),
    prisma.historicalBalance.findMany({ orderBy: { recordedAt: "asc" } }),
    prisma.userSettings.upsert({ where: { id: "singleton" }, create: {}, update: {} }),
    // Fetch Yahoo Finance in parallel — ex-div dates + real yields (1h cache)
    fetchYFDividends(Object.values(ISIN_TO_YF_SYMBOL)),
  ]);

  // ── Compute current values ──────────────────────────────────────────────
  let grossAssets = BigInt(0);
  let totalLiabilities = BigInt(0);
  let totalLatentTax = BigInt(0);
  let techValueCents = BigInt(0);
  let totalInvestCents = BigInt(0);
  let annualDividendsCents = BigInt(0);    // gross
  let annualDividendsNetCents = BigInt(0); // net after tax
  let annualInterestCents = BigInt(0);     // already net (French regulated savings accounts are income-tax-exempt)

  // Effective dividend tax rate for a French tax resident under the flat tax (PFU) regime.
  // PEA: reinvested within the wrapper — no immediate tax.
  // CTO French equities: flat tax 30% (12.8% income tax + 17.2% social levies).
  // CTO foreign equities (15% treaty): 15% withholding + 17.2% social levies
  //   → tax credit offsets the 12.8% income tax (credit 15% > IR 12.8% → IR = 0) → effective 32.2%.
  // Note: estimate under flat-tax assumption. Actual net may differ with progressive scale or 40% deduction.
  function dividendEffectiveTaxRate(isin: string, subtype: string | null): number {
    if (subtype === "PEA") return 0;
    const country = isin.slice(0, 2).toUpperCase();
    if (country === "FR") return 0.30;
    // Countries with a 15% withholding treaty with France (US, NL, IE, DE, GB, LU, BE...)
    // Effective = 15% withholding + 17.2% social levies − income tax credit (12.8% < 15% → IT = 0) = 32.2%
    const treaty15 = ["US", "NL", "IE", "DE", "GB", "LU", "BE", "CA", "JP", "CH"];
    if (treaty15.includes(country)) return 0.322;
    return 0.30; // default: flat tax, no known withholding treaty
  }

  type DividendRow = {
    isin: string; name: string; symbol: string; subtype: string | null;
    valueCents: bigint; annualEstCents: bigint; annualNetCents: bigint;
    taxRate: number; divYield: number; country: string;
  };
  const dividendRowsData: DividendRow[] = [];

  const allocation: Record<string, bigint> = {
    cash: BigInt(0),
    savings: BigInt(0),
    investments: BigInt(0),
    crypto: BigInt(0),
    realEstate: BigInt(0),
    auto: BigInt(0),
  };

  const now = new Date();

  type AssetRow = {
    id: string;
    name: string;
    institution: string;
    type: string;
    subtype: string | null;
    value: bigint;
    costBasis: bigint | null;
    gain: bigint | null;
    tax: bigint | null;
  };

  const assetRows: AssetRow[] = [];

  type InvestPerfRow = {
    id: string;
    name: string;
    institution: string;
    subtype: string | null;
    value: bigint;
    costBasis: bigint;
    gain: bigint;
    tax: bigint;
    investmentStartDate: Date | null;
  };
  const investPerfRows: InvestPerfRow[] = [];

  for (const account of accounts) {
    let value = BigInt(0);
    let accountCostBasis = BigInt(0);
    let accountGain = BigInt(0);
    let accountTax = BigInt(0);
    let hasBasis = false;

    const taxRate =
      account.type === "CRYPTO"
        ? settings.taxRateCrypto
        : account.type === "INVESTMENT" && account.investmentSubtype === "PEA"
        ? settings.taxRatePea
        : account.type === "INVESTMENT" && account.investmentSubtype === "CTO"
        ? settings.taxRateCto
        : null;

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

        // Dividends — real Yahoo Finance yield, falls back to hard-coded rate
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
        investPerfRows.push({
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
      // Loan: pure liability — reduces net worth, no asset counterpart
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
      // Skip assetRows — this is a liability, not an asset
      continue;
    } else {
      value = account.history[0]?.balanceCents ?? BigInt(0);
      if (account.type === "SAVINGS") {
        allocation["savings"] += value;
        // French regulated savings rates as of 2026-06-01 — update when rates change
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
  const investTotalCostBasis = investPerfRows.reduce((s, r) => s + r.costBasis, BigInt(0));
  const investTotalValue = investPerfRows.reduce((s, r) => s + r.value, BigInt(0));
  const investTotalGain = investPerfRows.reduce((s, r) => s + r.gain, BigInt(0));
  const investTotalTax = investPerfRows.reduce((s, r) => s + r.tax, BigInt(0));
  const investTotalGainNet = investTotalGain - investTotalTax;
  const investReturnPct = investTotalCostBasis > BigInt(0)
    ? (Number(investTotalGain) / Number(investTotalCostBasis)) * 100
    : 0;
  // Overall CAGR — weighted by invested capital when start dates are known
  // CAGR(r) = (value / cost)^(1/years) − 1
  const nowMs = Date.now();
  const investAllHaveDates = investPerfRows.length > 0 && investPerfRows.every((r) => r.investmentStartDate !== null);
  let investCAGR: number | null = null;
  if (investAllHaveDates && investTotalCostBasis > BigInt(0)) {
    // Duration in years per account, weighted by cost basis
    const weightedYears = investPerfRows.reduce((sum, r) => {
      const years = (nowMs - r.investmentStartDate!.getTime()) / (365.25 * 86_400_000);
      return sum + years * Number(r.costBasis);
    }, 0) / Number(investTotalCostBasis);
    if (weightedYears >= 1 / 12) {
      const totalReturn = Number(investTotalValue) / Number(investTotalCostBasis);
      investCAGR = (Math.pow(totalReturn, 1 / weightedYears) - 1) * 100;
    }
  }

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
  const dailyPassiveCents = Number(annualPassiveCents) / 365;
  const monthlyPassiveCents = Number(annualPassiveCents) / 12;

  // ── Dividend calendar ────────────────────────────────────────────────────
  const dividendCalendar = dividendRowsData
    .map((r) => ({ ...r, ...(yfData[r.symbol] ?? { exDividendDate: null, annualYield: null, annualRatePerShare: null }) }))
    .sort((a, b) => {
      if (!a.exDividendDate && !b.exDividendDate) return 0;
      if (!a.exDividendDate) return 1;
      if (!b.exDividendDate) return -1;
      return a.exDividendDate.getTime() - b.exDividendDate.getTime();
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

  // Monthly aggregation — for performance table & MOM delta
  const monthMap = new Map<string, Map<string, bigint>>();
  for (const b of allBalances) {
    const month = b.recordedAt.toISOString().slice(0, 7);
    if (!monthMap.has(month)) monthMap.set(month, new Map());
    monthMap.get(month)!.set(b.accountId, b.balanceCents);
  }
  const runningM = new Map<string, bigint>();
  const monthlyHistory = [...monthMap.keys()].sort().map((month) => {
    for (const [id, v] of monthMap.get(month)!) runningM.set(id, v);
    let gross = BigInt(0);
    for (const v of runningM.values()) gross += v;
    let liab = BigInt(0);
    for (const [id, v] of liabMap) { if (runningM.has(id)) liab += v; }
    const [y, m] = month.split("-");
    return {
      month,
      date: new Intl.DateTimeFormat("fr-FR", { month: "short", year: "2-digit" }).format(new Date(+y, +m - 1, 1)),
      netWorth: Number(gross - liab),
    };
  });

  // Daily aggregation — for the chart
  const dayMap = new Map<string, Map<string, bigint>>();
  for (const b of allBalances) {
    const day = b.recordedAt.toISOString().slice(0, 10);
    if (!dayMap.has(day)) dayMap.set(day, new Map());
    dayMap.get(day)!.set(b.accountId, b.balanceCents);
  }
  const runningD = new Map<string, bigint>();
  const dailyHistory = [...dayMap.keys()].sort().map((day) => {
    for (const [id, v] of dayMap.get(day)!) runningD.set(id, v);
    let gross = BigInt(0);
    for (const v of runningD.values()) gross += v;
    let liab = BigInt(0);
    for (const [id, v] of liabMap) { if (runningD.has(id)) liab += v; }
    const [y, m, d] = day.split("-");
    return {
      date: new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" }).format(new Date(+y, +m - 1, +d)),
      netWorth: Number(gross - liab),
    };
  });

  // ── MOM performance ─────────────────────────────────────────────────────
  const last6Months = monthlyHistory.slice(-6);
  const performanceRows = last6Months.map((row, i) => {
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
  const topAssets = [...assetRows]
    .sort((a, b) => Number(b.value - a.value))
    .slice(0, 10);

  // ── Allocation slices ───────────────────────────────────────────────────
  const allocationSlices: AllocationSlice[] = Object.entries(allocation)
    .filter(([, v]) => v > BigInt(0))
    .map(([key, value]) => ({
      name: tAlloc(key as Parameters<typeof tAlloc>[0]),
      value: Number(value),
      color: CATEGORY_COLORS[key] ?? "#6b7280",
    }))
    .sort((a, b) => b.value - a.value);

  const totalAllocation = allocationSlices.reduce((s, d) => s + d.value, 0);

  // ── Debt accounts ────────────────────────────────────────────────────────
  // Asset-backed liabilities (real estate, auto) only — LOAN accounts have their own tab
  const debtAccounts = accounts
    .filter((a) => a.type !== "LOAN" && (a.liabilityCents ?? BigInt(0)) > BigInt(0))
    .map((a) => ({
      id: a.id,
      name: a.name,
      institution: a.institution?.name ?? "",
      type: a.type,
      value: a.manualValueCents ?? BigInt(0),
      liability: a.liabilityCents ?? BigInt(0),
    }));

  const hasData = grossAssets > BigInt(0);

  // ── Serialized data for export (BigInt → number) ──────────────────────────
  const analyticsExport: AnalyticsExportData = {
    netWorth: Number(netWorth),
    netWorthAfterTax: Number(netWorthAfterTax),
    grossAssets: Number(grossAssets),
    totalLiabilities: Number(totalLiabilities),
    totalLatentTax: Number(totalLatentTax),
    investedPct,
    hasTaxData,
    savingsRate: savingsRate ?? null,
    runwayMonths: runwayMonths ?? null,
    goalCents: Number(goalCents),
    goalPct,
    allocationSlices: allocationSlices.map((s) => ({
      name: s.name,
      valueCents: s.value,
      pct: totalAllocation > 0 ? Math.round((s.value / totalAllocation) * 100) : 0,
    })),
    investPerfRows: investPerfRows.map((r) => ({
      name: r.name,
      institution: r.institution,
      subtype: r.subtype,
      valueCents: Number(r.value),
      costBasisCents: Number(r.costBasis),
      gainCents: Number(r.gain),
      taxCents: Number(r.tax),
      returnPct:
        Number(r.costBasis) > 0 ? (Number(r.gain) / Number(r.costBasis)) * 100 : 0,
    })),
    investTotalValueCents: Number(investTotalValue),
    investTotalCostBasisCents: Number(investTotalCostBasis),
    investTotalGainCents: Number(investTotalGain),
    investTotalTaxCents: Number(investTotalTax),
    investReturnPct,
    investCAGR: investCAGR ?? null,
    dividendRows: dividendCalendar.map((r) => ({
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
    annualDividendsCents: Number(annualDividendsCents),
    annualDividendsNetCents: Number(annualDividendsNetCents),
    annualInterestCents: Number(annualInterestCents),
    annualPassiveCents: Number(annualPassiveCents),
    monthlyPassiveCents,
    performanceRows: performanceRows.map((r) => ({
      date: r.date,
      netWorth: r.netWorth,
      delta: r.delta ?? null,
      deltaPct: r.deltaPct ?? null,
    })),
  };

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--foreground)]">{t("title")}</h1>
          <p className="text-sm text-[var(--muted)] mt-1">{t("subtitle")}</p>
        </div>
        <div className="shrink-0"><ExportAnalyticsButton data={analyticsExport} /></div>
      </div>

      {/* ── KPIs ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
          <p className="text-xs text-[var(--muted)] uppercase tracking-wider mb-2">{t("kpis.netWorth")}</p>
          <p className="text-xl sm:text-2xl font-semibold tabular-nums text-[var(--accent)]">
            {formatCurrency(hasTaxData ? netWorthAfterTax : netWorth, 0)}
          </p>
          {momDelta !== null && (
            <p
              className={`text-xs tabular-nums mt-1 ${
                momDelta >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"
              }`}
            >
              {momDelta >= 0 ? "+" : ""}
              {formatCurrency(momDelta, 0)} {t("kpis.thisMonth")}
            </p>
          )}
          {hasTaxData && (
            <p className="text-xs text-[var(--muted)] mt-1">
              ~{formatCurrency(netWorth, 0)} {t("kpis.beforeTax")}
            </p>
          )}
        </div>
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
          <p className="text-xs text-[var(--muted)] uppercase tracking-wider mb-2">{t("kpis.grossWorth")}</p>
          <p className="text-xl sm:text-2xl font-semibold tabular-nums text-[var(--foreground)]">
            {formatCurrency(grossAssets, 0)}
          </p>
        </div>
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
          <p className="text-xs text-[var(--muted)] uppercase tracking-wider mb-2">{t("kpis.totalLiabilities")}</p>
          <p className="text-xl sm:text-2xl font-semibold tabular-nums text-[var(--negative)]">
            {formatCurrency(totalLiabilities + totalLatentTax, 0)}
          </p>
          {grossAssets > BigInt(0) && (
            <div className="mt-1 space-y-0.5">
              <p className="text-xs text-[var(--muted)]">
                {t("kpis.debts")} {formatCurrency(totalLiabilities, 0)}
              </p>
              {hasTaxData && (
                <p className="text-xs text-[var(--muted)]">
                  {t("kpis.latentTax")} {formatCurrency(totalLatentTax, 0)}
                </p>
              )}
            </div>
          )}
        </div>
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
          <p className="text-xs text-[var(--muted)] uppercase tracking-wider mb-2">{t("kpis.investedRate")}</p>
          <p className="text-xl sm:text-2xl font-semibold tabular-nums text-[var(--foreground)]">
            {investedPct}%
          </p>
          <p className="text-xs text-[var(--muted)] mt-1">{t("kpis.ofGross")}</p>
        </div>
      </div>

      {hasData && (
        <>
          {/* ── Cash-Flow & Survie ── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Taux d'épargne */}
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
              <p className="text-xs text-[var(--muted)] uppercase tracking-wider mb-3">{t("savingsRate.title")}</p>
              {!hasSalary ? (
                <div>
                  <p className="text-2xl font-semibold text-[var(--muted)]">—</p>
                  <Link href="/settings" className="text-xs text-[var(--accent)] mt-1 inline-flex items-center min-h-[44px] hover:underline">
                    {t("savingsRate.configureSalary")}
                  </Link>
                </div>
              ) : savingsRate === null ? (
                <p className="text-2xl font-semibold text-[var(--muted)]">—</p>
              ) : (
                <div>
                  <div className="flex items-baseline gap-2">
                    <p
                      className={`text-2xl font-semibold tabular-nums ${
                        savingsRate >= 40
                          ? "text-[var(--positive)]"
                          : savingsRate >= 20
                          ? "text-[var(--accent)]"
                          : savingsRate < 0
                          ? "text-[var(--negative)]"
                          : "text-[var(--foreground)]"
                      }`}
                    >
                      {savingsRate >= 0 ? "+" : ""}{savingsRate.toFixed(1)}%
                    </p>
                    {savingsRate >= 40 && (
                      <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-[var(--positive)]/15 text-[var(--positive)]">
                        {t("savingsRate.elite")}
                      </span>
                    )}
                    {savingsRate >= 20 && savingsRate < 40 && (
                      <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-[var(--accent)]/15 text-[var(--accent)]">
                        {t("savingsRate.good")}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[var(--muted)] mt-1">
                    {hasDeclaredSavings
                      ? t("savingsRate.declaredSavings", { saved: formatCurrency(settings.monthlySavedCents, 0), salary: formatCurrency(settings.salaryNetCents, 0) })
                      : t("savingsRate.momSavings", { mom: formatCurrency(momDelta!, 0), salary: formatCurrency(settings.salaryNetCents, 0) })
                    }
                  </p>
                  <p className="text-xs text-[var(--muted)] mt-0.5 opacity-70">
                    {hasDeclaredSavings
                      ? t("savingsRate.hintDeclared")
                      : t("savingsRate.hintMom")
                    }
                  </p>
                </div>
              )}
            </div>

            {/* Runway */}
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
              <p className="text-xs text-[var(--muted)] uppercase tracking-wider mb-3">{t("runway.title")}</p>
              {!hasExpenses ? (
                <div>
                  <p className="text-2xl font-semibold text-[var(--muted)]">—</p>
                  <Link href="/settings" className="text-xs text-[var(--accent)] mt-1 inline-flex items-center min-h-[44px] hover:underline">
                    {t("runway.configureExpenses")}
                  </Link>
                </div>
              ) : runwayMonths === null ? (
                <p className="text-2xl font-semibold text-[var(--muted)]">—</p>
              ) : (
                <div>
                  <p
                    className={`text-2xl font-semibold tabular-nums ${
                      runwayMonths >= 12
                        ? "text-[var(--positive)]"
                        : runwayMonths >= 6
                        ? "text-[var(--accent)]"
                        : "text-[var(--negative)]"
                    }`}
                  >
                    {t("runway.months", { count: Math.floor(runwayMonths) })}
                  </p>
                  <p className="text-xs text-[var(--muted)] mt-1">
                    {t("runway.detail", { savings: formatCurrency(allocation["savings"], 0), expenses: formatCurrency(settings.monthlyExpensesCents, 0) })}
                  </p>
                  <p className="text-xs text-[var(--muted)] mt-0.5 opacity-70">
                    {runwayMonths >= 12
                      ? t("runway.safe")
                      : runwayMonths >= 6
                      ? t("runway.ok")
                      : t("runway.warning")}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* ── Objectif & Revenus passifs ── */}
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 sm:p-6 space-y-5">
            {/* Goal bar */}
            <div>
              <div className="flex flex-wrap items-center justify-between gap-y-1 mb-2">
                <p className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
                  {t("goal.title", { amount: formatCurrency(goalCents, 0) })}
                </p>
                <div className="flex items-center gap-2">
                  <span
                    className={`text-sm font-semibold tabular-nums ${
                      goalPct >= 100 ? "text-[var(--positive)]" : "text-[var(--accent)]"
                    }`}
                  >
                    {goalPct}%
                  </span>
                  {goalRemaining > BigInt(0) && (
                    <span className="text-xs text-[var(--muted)] hidden sm:inline">
                      · {t("goal.remaining", { amount: formatCurrency(goalRemaining, 0) })}
                    </span>
                  )}
                </div>
              </div>
              <div
                className="h-3 bg-[var(--surface-elevated)] rounded-full overflow-hidden"
                role="progressbar"
                aria-valuenow={goalPct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={t("goal.aria", { pct: goalPct })}
              >
                <div
                  className={`h-full rounded-full transition-all ${
                    goalPct >= 100 ? "bg-[var(--positive)]" : "bg-[var(--accent)]"
                  }`}
                  style={{ width: `${goalPct}%` }}
                />
              </div>
              <div className="flex justify-between text-xs text-[var(--muted)] mt-1.5">
                <span>{formatCurrency(netWorth, 0)}</span>
                <span>{formatCurrency(goalCents, 0)}</span>
              </div>
            </div>

            {/* Passive income */}
            {annualPassiveCents > BigInt(0) && (
              <div className="pt-4 border-t border-[var(--border)]">
                <p className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider mb-3">
                  {t("passive.title")}
                </p>
                <div className="grid grid-cols-3 gap-2 sm:gap-4">
                  <div>
                    <p className="text-xs text-[var(--muted)] mb-1">{t("passive.perYear")}</p>
                    <p className="text-lg font-semibold tabular-nums text-[var(--positive)]">
                      {formatCurrency(annualPassiveCents, 0)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-[var(--muted)] mb-1">{t("passive.perMonth")}</p>
                    <p className="text-lg font-semibold tabular-nums text-[var(--positive)]">
                      {formatCurrency(monthlyPassiveCents, 0)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-[var(--muted)] mb-1">{t("passive.perDay")}</p>
                    <p className="text-lg font-semibold tabular-nums text-[var(--positive)]">
                      {formatCurrency(dailyPassiveCents, 2)}
                    </p>
                    <p className="text-xs text-[var(--muted)] mt-0.5">{t("passive.tagline")}</p>
                  </div>
                </div>
                {annualDividendsCents > BigInt(0) && (
                  <div className="mt-3 space-y-0.5">
                    <p className="text-xs text-[var(--muted)] opacity-70">
                      {t("passive.dividendsNet", { amount: formatCurrency(annualDividendsNetCents, 0) })}
                      <span className="ml-1 opacity-60">{t("passive.dividendsGross", { gross: formatCurrency(annualDividendsCents, 0) })}</span>
                    </p>
                    {annualInterestCents > BigInt(0) && (
                      <p className="text-xs text-[var(--muted)] opacity-70">
                        {t("passive.interest", { amount: formatCurrency(annualInterestCents, 0) })}
                      </p>
                    )}
                  </div>
                )}
                <p className="text-xs text-[var(--muted)] mt-1 opacity-70">
                  {t("passive.footnote")}
                </p>
              </div>
            )}
          </div>

          {/* ── Charts ── */}
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div className="md:col-span-3 bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6">
              <h2 className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider mb-4">
                {t("charts.netWorthEvolution")}
              </h2>
              <NetWorthChart data={dailyHistory} />
            </div>
            <div className="md:col-span-2 bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6">
              <h2 className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider mb-4">
                {t("charts.allocation")}
              </h2>
              <AssetAllocationChart data={allocationSlices} />
            </div>
          </div>

          {/* ── Calendrier des dividendes ── */}
          {dividendCalendar.length > 0 && (
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 sm:p-6">
              <div className="flex items-baseline justify-between mb-1">
                <h2 className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
                  {t("dividends.title")}
                </h2>
                <div className="text-right">
                  <span className="text-sm font-semibold tabular-nums text-[var(--positive)]">
                    ~{formatCurrency(annualDividendsNetCents, 0)} {t("dividends.netPerYear")}
                  </span>
                  <span className="text-xs text-[var(--muted)] ml-2">
                    brut {formatCurrency(annualDividendsCents, 0)}
                  </span>
                </div>
              </div>
              <p className="text-xs text-[var(--muted)] mb-4 opacity-70">
                {t("dividends.footnote")}
              </p>
              <div className="divide-y divide-[var(--border)]">
                {dividendCalendar.map((row) => {
                  const daysLeft = row.exDividendDate
                    ? Math.ceil((row.exDividendDate.getTime() - Date.now()) / 86_400_000)
                    : null;
                  const isPast = daysLeft !== null && daysLeft < 0;
                  const isSoon = daysLeft !== null && daysLeft >= 0 && daysLeft <= 30;
                  return (
                    <div key={row.isin} className="py-3 flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-[var(--foreground)] truncate">{row.name}</p>
                        <p className="text-xs text-[var(--muted)]">
                          {row.symbol} · yield {(row.divYield * 100).toFixed(1)}%
                          {row.annualRatePerShare != null && (
                            <> · {row.annualRatePerShare.toFixed(2)} $/action</>
                          )}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-semibold tabular-nums text-[var(--positive)]">
                          ~{formatCurrency(row.annualNetCents, 0)} net
                        </p>
                        <p className="text-xs text-[var(--muted)]">
                          brut {formatCurrency(row.annualEstCents, 0)}
                          {row.taxRate > 0 && (
                            <> · −{(row.taxRate * 100).toFixed(1)}%
                            {row.country !== "FR" && row.subtype !== "PEA" && (
                              <span title="Retenue à la source 15% + PS 17,2% (crédit IR)"> ({row.country})</span>
                            )}</>
                          )}
                        </p>
                        {row.exDividendDate ? (
                          <p className={`text-xs tabular-nums mt-0.5 ${
                            isPast ? "text-[var(--muted)]" : isSoon ? "text-amber-400" : "text-[var(--foreground)]"
                          }`}>
                            {isPast
                              ? t("dividends.exDivPast", { date: row.exDividendDate.toLocaleDateString("fr-FR") })
                              : daysLeft === 0
                              ? t("dividends.exDivToday")
                              : t("dividends.exDivSoon", { days: daysLeft!, date: row.exDividendDate.toLocaleDateString("fr-FR") })
                            }
                          </p>
                        ) : (
                          <p className="text-xs text-[var(--muted)] mt-0.5">{t("dividends.exDivUnknown")}</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-[var(--muted)] mt-3 opacity-70">
                {t("dividends.withholding")}
              </p>
            </div>
          )}

          {/* ── Performance portefeuille CTO / PEA ── */}
          {investPerfRows.length > 0 && investTotalCostBasis > BigInt(0) && (
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 sm:p-6">
              <h2 className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider mb-4">
                {t("performance.title")}
              </h2>

              {/* Résumé global */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-5">
                <div>
                  <p className="text-xs text-[var(--muted)] mb-1">{t("performance.invested")}</p>
                  <p className="text-lg font-semibold tabular-nums text-[var(--foreground)]">
                    {formatCurrency(investTotalCostBasis, 0)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[var(--muted)] mb-1">{t("performance.currentValue")}</p>
                  <p className="text-lg font-semibold tabular-nums text-[var(--foreground)]">
                    {formatCurrency(investTotalValue, 0)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[var(--muted)] mb-1">{t("performance.grossGain")}</p>
                  <p className={`text-lg font-semibold tabular-nums ${investTotalGain >= BigInt(0) ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>
                    {investTotalGain >= BigInt(0) ? "+" : ""}{formatCurrency(investTotalGain, 0)}
                  </p>
                  <p className="text-xs text-[var(--muted)] mt-0.5 opacity-70">
                    {investReturnPct >= 0 ? "+" : ""}{investReturnPct.toFixed(1)}% {t("performance.onCost")}
                    {investCAGR !== null && (
                      <> · <span className={investCAGR >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}>
                        {investCAGR >= 0 ? "+" : ""}{investCAGR.toFixed(1)}% {t("performance.perYear")}
                      </span></>
                    )}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[var(--muted)] mb-1">{t("performance.netGain")}</p>
                  <p className={`text-lg font-semibold tabular-nums ${investTotalGainNet >= BigInt(0) ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>
                    {investTotalGainNet >= BigInt(0) ? "+" : ""}{formatCurrency(investTotalGainNet, 0)}
                  </p>
                  {investTotalTax > BigInt(0) && (
                    <p className="text-xs text-[var(--muted)] mt-0.5 opacity-70">
                      {t("performance.latentTax")} −{formatCurrency(investTotalTax, 0)}
                    </p>
                  )}
                </div>
              </div>

              {/* Détail par compte */}
              {investPerfRows.length > 1 && (
                <div className="overflow-x-auto border-t border-[var(--border)] pt-4">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[var(--border)]">
                        <th scope="col" className="pb-2 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider">{t("performance.colAccount")}</th>
                        <th scope="col" className="pb-2 text-right text-xs font-medium text-[var(--muted)] uppercase tracking-wider">{t("performance.colInvested")}</th>
                        <th scope="col" className="pb-2 text-right text-xs font-medium text-[var(--muted)] uppercase tracking-wider">{t("performance.colValue")}</th>
                        <th scope="col" className="pb-2 text-right text-xs font-medium text-[var(--muted)] uppercase tracking-wider">{t("performance.colGrossGain")}</th>
                        <th scope="col" className="hidden sm:table-cell pb-2 text-right text-xs font-medium text-[var(--muted)] uppercase tracking-wider">{t("performance.colNetGain")}</th>
                        <th scope="col" className="hidden sm:table-cell pb-2 text-right text-xs font-medium text-[var(--muted)] uppercase tracking-wider">{t("performance.colCagr")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {investPerfRows.map((row, i) => {
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
                        return (
                          <tr
                            key={row.id}
                            className={`${i < investPerfRows.length - 1 ? "border-b border-[var(--border)]" : ""} hover:bg-[var(--surface-elevated)] transition-colors`}
                          >
                            <td className="py-3 pr-4">
                              <p className="font-medium text-[var(--foreground)]">{row.name}</p>
                              <p className="text-xs text-[var(--muted)]">
                                {row.institution}{row.subtype && ` · ${row.subtype}`}
                                {row.investmentStartDate && (
                                  <> · {t("performance.since", { date: row.investmentStartDate.toLocaleDateString("fr-FR", { month: "short", year: "numeric" }) })}</>
                                )}
                              </p>
                            </td>
                            <td className="py-3 px-2 text-right tabular-nums text-[var(--muted)]">
                              {formatCurrency(row.costBasis, 0)}
                            </td>
                            <td className="py-3 px-2 text-right tabular-nums font-medium text-[var(--foreground)]">
                              {formatCurrency(row.value, 0)}
                            </td>
                            <td className="py-3 px-2 text-right tabular-nums">
                              <span className={row.gain >= BigInt(0) ? "text-[var(--positive)]" : "text-[var(--negative)]"}>
                                {row.gain >= BigInt(0) ? "+" : ""}{formatCurrency(row.gain, 0)}
                              </span>
                              <span className="block text-xs text-[var(--muted)] opacity-70">
                                {returnPct >= 0 ? "+" : ""}{returnPct.toFixed(1)}%
                              </span>
                            </td>
                            <td className="hidden sm:table-cell py-3 px-2 text-right tabular-nums">
                              <span className={gainNet >= BigInt(0) ? "text-[var(--positive)]" : "text-[var(--negative)]"}>
                                {gainNet >= BigInt(0) ? "+" : ""}{formatCurrency(gainNet, 0)}
                              </span>
                            </td>
                            <td className="hidden sm:table-cell py-3 pl-2 text-right tabular-nums">
                              {cagr !== null ? (
                                <span className={cagr >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}>
                                  {cagr >= 0 ? "+" : ""}{cagr.toFixed(1)}% {t("performance.perYear")}
                                </span>
                              ) : (
                                <span className="text-[var(--muted)] text-xs">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="text-xs text-[var(--muted)] mt-3 opacity-70">
                {t("performance.cagr", { pea: (settings.taxRatePea * 100).toFixed(1), cto: (settings.taxRateCto * 100).toFixed(1) })}
                {!investAllHaveDates && investPerfRows.length > 0 && (
                  <> · {t("performance.addDateHint")}</>
                )}
              </p>
            </div>
          )}

          {/* ── Radar d'allocation ── */}
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 sm:p-6 space-y-6">
            <h2 className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
              {t("radar.title")}
            </h2>

            {/* Garantis vs Risqués */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-[var(--foreground)]">{t("radar.safeVsRisky")}</span>
                <span className="text-xs text-[var(--muted)] tabular-nums">
                  {garantisPct}% / {100 - garantisPct}%
                </span>
              </div>
              <div className="flex h-3 rounded-full overflow-hidden gap-0.5">
                <div
                  className="bg-[#8b5cf6] rounded-l-full transition-all"
                  style={{ width: `${garantisPct}%` }}
                />
                <div
                  className="bg-[#22c55e] flex-1 rounded-r-full transition-all"
                />
              </div>
              <div className="flex justify-between text-xs text-[var(--muted)] mt-1.5">
                <span>{t("radar.safe", { amount: formatCurrency(garantis, 0) })}</span>
                <span>{t("radar.risky", { amount: formatCurrency(risques, 0) })}</span>
              </div>
            </div>

            {/* Pure Tech exposure */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-[var(--foreground)]">{t("radar.techExposure")}</span>
                  {techPct > 60 && (
                    <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-[var(--negative)]/15 text-[var(--negative)]">
                      {t("radar.highConcentration")}
                    </span>
                  )}
                  {techPct > 40 && techPct <= 60 && (
                    <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-[var(--accent)]/15 text-[var(--accent)]">
                      {t("radar.monitor")}
                    </span>
                  )}
                </div>
                <span className="text-xs tabular-nums font-medium text-[var(--foreground)]">{techPct}%</span>
              </div>
              <div
                className="h-3 bg-[var(--surface-elevated)] rounded-full overflow-hidden"
                role="progressbar"
                aria-valuenow={techPct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`Exposition Tech : ${techPct}%`}
              >
                <div
                  className={`h-full rounded-full transition-all ${
                    techPct > 60
                      ? "bg-[var(--negative)]"
                      : techPct > 40
                      ? "bg-[var(--accent)]"
                      : "bg-[var(--positive)]"
                  }`}
                  style={{ width: `${techPct}%` }}
                />
              </div>
              <p className="text-xs text-[var(--muted)] mt-1.5 opacity-70">
                {t("radar.techFootnote")}
              </p>
            </div>
          </div>

          {/* ── Allocation détaillée ── */}
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-[var(--border)]">
              <h2 className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
                {t("detailedAllocation.title")}
              </h2>
            </div>
            <div className="divide-y divide-[var(--border)]">
              {allocationSlices.map((slice) => {
                const pct = totalAllocation > 0
                  ? Math.round((slice.value / totalAllocation) * 100)
                  : 0;
                return (
                  <div key={slice.name} className="px-4 sm:px-6 py-3 sm:py-4 flex items-center gap-2 sm:gap-4">
                    <div
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ background: slice.color }}
                    />
                    <span className="text-sm text-[var(--foreground)] w-20 sm:w-32 shrink-0">
                      {slice.name}
                    </span>
                    <div className="flex-1 h-1.5 bg-[var(--surface-elevated)] rounded-full overflow-hidden" aria-hidden="true">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${pct}%`, background: slice.color }}
                      />
                    </div>
                    <span className="text-xs sm:text-sm tabular-nums text-[var(--muted)] w-8 sm:w-10 text-right shrink-0">
                      {pct}%
                    </span>
                    <span className="text-xs sm:text-sm tabular-nums font-medium text-[var(--foreground)] w-16 sm:w-28 text-right shrink-0">
                      {formatCurrency(slice.value, 0)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Performance mensuelle ── */}
          {performanceRows.length > 1 && (
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-[var(--border)]">
                <h2 className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
                  {t("monthlyPerf.title")}
                </h2>
              </div>
              <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)]">
                    <th scope="col" className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider">{t("monthlyPerf.colMonth")}</th>
                    <th scope="col" className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider">{t("monthlyPerf.colNetWorth")}</th>
                    <th scope="col" className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider">{t("monthlyPerf.colChange")}</th>
                    <th scope="col" className="hidden sm:table-cell px-6 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider">{t("monthlyPerf.colPct")}</th>
                  </tr>
                </thead>
                <tbody>
                  {[...performanceRows].reverse().map((row, i) => (
                    <tr
                      key={row.month}
                      className={`${
                        i < performanceRows.length - 1 ? "border-b border-[var(--border)]" : ""
                      } hover:bg-[var(--surface-elevated)] transition-colors`}
                    >
                      <td className="px-4 sm:px-6 py-3 text-[var(--muted)] capitalize">{row.date}</td>
                      <td className="px-4 sm:px-6 py-3 tabular-nums font-medium text-[var(--foreground)]">
                        {formatCurrency(row.netWorth, 0)}
                      </td>
                      <td className="px-4 sm:px-6 py-3 tabular-nums">
                        {row.delta === null ? (
                          <span className="text-[var(--muted)]">—</span>
                        ) : (
                          <span className={row.delta >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}>
                            {row.delta >= 0 ? "+" : ""}{formatCurrency(row.delta, 0)}
                          </span>
                        )}
                      </td>
                      <td className="hidden sm:table-cell px-6 py-3 tabular-nums">
                        {row.deltaPct === null ? (
                          <span className="text-[var(--muted)]">—</span>
                        ) : (
                          <span className={row.deltaPct >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}>
                            {row.deltaPct >= 0 ? "+" : ""}{row.deltaPct.toFixed(1)}%
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          )}

          {/* ── Mes actifs ── */}
          {topAssets.length > 0 && (
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-[var(--border)]">
                <h2 className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
                  {t("assets.title")}
                </h2>
              </div>
              <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)]">
                    <th scope="col" className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider">{t("assets.colAsset")}</th>
                    <th scope="col" className="hidden sm:table-cell px-6 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider">{t("assets.colCategory")}</th>
                    <th scope="col" className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider">{t("assets.colValue")}</th>
                    <th scope="col" className="hidden sm:table-cell px-6 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider">{t("assets.colGain")}</th>
                    <th scope="col" className="hidden sm:table-cell px-6 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider">{t("assets.colTax")}</th>
                    <th scope="col" className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider">{t("assets.colPct")}</th>
                  </tr>
                </thead>
                <tbody>
                  {topAssets.map((asset, i) => {
                    const pct =
                      grossAssets > BigInt(0)
                        ? Math.round((Number(asset.value) / Number(grossAssets)) * 100)
                        : 0;
                    return (
                      <tr
                        key={asset.id}
                        className={`${
                          i < topAssets.length - 1 ? "border-b border-[var(--border)]" : ""
                        } hover:bg-[var(--surface-elevated)] transition-colors`}
                      >
                        <td className="px-4 sm:px-6 py-3">
                          <p className="font-medium text-[var(--foreground)]">{asset.name}</p>
                          <p className="text-xs text-[var(--muted)] sm:hidden">
                            {ta(asset.type as Parameters<typeof ta>[0])}
                            {asset.subtype && ` · ${asset.subtype}`}
                          </p>
                          <p className="hidden sm:block text-xs text-[var(--muted)]">{asset.institution}</p>
                        </td>
                        <td className="hidden sm:table-cell px-6 py-3 text-[var(--muted)]">
                          {ta(asset.type as Parameters<typeof ta>[0])}
                          {asset.subtype && <span className="ml-1 text-xs">· {asset.subtype}</span>}
                        </td>
                        <td className="px-4 sm:px-6 py-3 tabular-nums font-medium text-[var(--foreground)]">
                          {formatCurrency(asset.value, 0)}
                        </td>
                        <td className="hidden sm:table-cell px-6 py-3 tabular-nums">
                          {asset.gain === null ? (
                            <span className="text-[var(--muted)] text-xs">—</span>
                          ) : (
                            <span className={asset.gain >= BigInt(0) ? "text-[var(--positive)]" : "text-[var(--negative)]"}>
                              {asset.gain >= BigInt(0) ? "+" : ""}{formatCurrency(asset.gain, 0)}
                            </span>
                          )}
                        </td>
                        <td className="hidden sm:table-cell px-6 py-3 tabular-nums">
                          {asset.tax === null ? (
                            <span className="text-[var(--muted)] text-xs">—</span>
                          ) : asset.tax === BigInt(0) ? (
                            <span className="text-[var(--muted)] text-xs">0 €</span>
                          ) : (
                            <span className="text-[var(--negative)]">-{formatCurrency(asset.tax, 0)}</span>
                          )}
                        </td>
                        <td className="px-4 sm:px-6 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-10 sm:w-16 h-1.5 bg-[var(--surface-elevated)] rounded-full overflow-hidden" aria-hidden="true">
                              <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${pct}%` }} />
                            </div>
                            <span className="text-xs text-[var(--muted)] tabular-nums">{pct}%</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            </div>
          )}

          {/* ── Analyse du financement ── */}
          {debtAccounts.length > 0 && (
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-[var(--border)]">
                <h2 className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
                  {t("financing.title")}
                </h2>
              </div>
              <div className="px-4 sm:px-6 py-4 border-b border-[var(--border)] flex flex-wrap items-center gap-4 sm:gap-8 text-sm">
                <div>
                  <p className="text-xs text-[var(--muted)] mb-1">{t("financing.totalLiabilities")}</p>
                  <p className="tabular-nums font-semibold text-[var(--negative)]">
                    {formatCurrency(totalLiabilities, 0)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[var(--muted)] mb-1">{t("financing.debtRatio")}</p>
                  <p className="tabular-nums font-semibold text-[var(--foreground)]">
                    {debtRatio}%
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[var(--muted)] mb-1">{t("financing.equity")}</p>
                  <p className="tabular-nums font-semibold text-[var(--positive)]">
                    {formatCurrency(grossAssets - totalLiabilities, 0)}
                  </p>
                </div>
              </div>
              <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)]">
                    <th scope="col" className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider">{t("financing.colAsset")}</th>
                    <th scope="col" className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider">{t("financing.colValue")}</th>
                    <th scope="col" className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider">{t("financing.colLoan")}</th>
                    <th scope="col" className="hidden sm:table-cell px-6 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider">{t("financing.colEquity")}</th>
                    <th scope="col" className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider">{t("financing.colLtv")}</th>
                  </tr>
                </thead>
                <tbody>
                  {debtAccounts.map((a, i) => {
                    const equity = a.value - a.liability;
                    const ltv =
                      a.value > BigInt(0)
                        ? Math.round((Number(a.liability) / Number(a.value)) * 100)
                        : 0;
                    return (
                      <tr
                        key={a.id}
                        className={`${
                          i < debtAccounts.length - 1 ? "border-b border-[var(--border)]" : ""
                        } hover:bg-[var(--surface-elevated)] transition-colors`}
                      >
                        <td className="px-4 sm:px-6 py-3">
                          <p className="font-medium text-[var(--foreground)]">{a.name}</p>
                          <p className="text-xs text-[var(--muted)]">{a.institution}</p>
                        </td>
                        <td className="px-4 sm:px-6 py-3 tabular-nums text-[var(--foreground)]">
                          {formatCurrency(a.value, 0)}
                        </td>
                        <td className="px-4 sm:px-6 py-3 tabular-nums text-[var(--negative)]">
                          {formatCurrency(a.liability, 0)}
                        </td>
                        <td className="hidden sm:table-cell px-6 py-3 tabular-nums text-[var(--positive)]">
                          {formatCurrency(equity, 0)}
                        </td>
                        <td className="px-4 sm:px-6 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-10 sm:w-16 h-1.5 bg-[var(--surface-elevated)] rounded-full overflow-hidden" aria-hidden="true">
                              <div
                                className={`h-full rounded-full ${
                                  ltv > 80
                                    ? "bg-[var(--negative)]"
                                    : ltv > 60
                                    ? "bg-[var(--accent)]"
                                    : "bg-[var(--positive)]"
                                }`}
                                style={{ width: `${Math.min(ltv, 100)}%` }}
                              />
                            </div>
                            <span className="text-xs text-[var(--muted)] tabular-nums">
                              {ltv}%
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            </div>
          )}
        </>
      )}

      {!hasData && <AnalyticsEmptyState />}
    </div>
  );
}
