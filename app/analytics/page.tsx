export const dynamic = "force-dynamic";

import { prisma } from "@/lib/prisma";
import { formatCurrency } from "@/lib/format";
import { NetWorthChart } from "@/components/net-worth-chart";
import { AssetAllocationChart, type AllocationSlice } from "@/components/asset-allocation-chart";
import Link from "next/link";
import Decimal from "decimal.js";
import {
  ExportAnalyticsButton,
  type AnalyticsExportData,
} from "@/components/export-analytics-button";
import { calcCurrentCapital, hasLoanParams } from "@/lib/loan";

const CATEGORY_COLORS: Record<string, string> = {
  Liquidités: "#6366f1",
  Épargne: "#8b5cf6",
  Investissements: "#22c55e",
  Crypto: "#f59e0b",
  Immobilier: "#3b82f6",
  Automobile: "#ec4899",
};

const TYPE_LABELS: Record<string, string> = {
  CHECKING: "Courant",
  SAVINGS: "Épargne",
  MEAL_VOUCHER: "Titre-resto",
  INVESTMENT: "Investissements",
  CRYPTO: "Crypto",
  REAL_ESTATE: "Immobilier",
  AUTOMOBILE: "Automobile",
};

// Tax rates
const TAX_RATES: Record<string, number> = { PEA: 0.172, CTO: 0.314, CRYPTO: 0.30 };

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
  annualRatePerShare: number | null; // trailingAnnualDividendRate en devise locale (affiché seulement)
};

// Utilise l'endpoint chart (sans auth) pour récupérer l'historique des dividendes.
// Calcule la prochaine date ex-div par extrapolation de la fréquence historique.
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

    // Timestamps ex-div triés (clés en secondes)
    const timestamps = Object.keys(divMap).map(Number).sort((a, b) => a - b);
    const amounts = timestamps.map((t) => divMap[String(t)].amount);

    // Fréquence estimée en jours (mensuel / trimestriel / semestriel / annuel)
    let freqDays = 365;
    if (timestamps.length >= 2) {
      const gaps = timestamps.slice(1).map((t, i) => (t - timestamps[i]) / 86400);
      const median = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
      freqDays = median < 45 ? 30 : median < 120 ? 91 : median < 270 ? 182 : 365;
    }
    const perYear = Math.round(365 / freqDays);
    const annualRatePerShare = amounts.slice(-perYear).reduce((s, a) => s + a, 0);

    // Yield = taux annuel / cours actuel
    const price = result.meta?.regularMarketPrice as number | undefined;
    const annualYield = price && price > 0 ? annualRatePerShare / price : null;

    // Prochaine date ex-div = dernière + fréquence (avancé d'un cycle si déjà passée)
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
    // Fetch Yahoo Finance en parallèle — dates ex-div + vrais yields (cache 1h)
    fetchYFDividends(Object.values(ISIN_TO_YF_SYMBOL)),
  ]);

  // ── Compute current values ──────────────────────────────────────────────
  let grossAssets = BigInt(0);
  let totalLiabilities = BigInt(0);
  let totalLatentTax = BigInt(0);
  let techValueCents = BigInt(0);
  let totalInvestCents = BigInt(0);
  let annualDividendsCents = BigInt(0);    // brut
  let annualDividendsNetCents = BigInt(0); // net après fiscalité
  let annualInterestCents = BigInt(0);     // déjà net (livrets exonérés)

  // Taux effectif de fiscalité sur les dividendes (PFU, résident français)
  // PEA : réinvesti dans l'enveloppe, pas de fiscalité immédiate
  // CTO actions FR : PFU 30% (12,8% IR + 17,2% PS)
  // CTO actions étrangères (traité 15%) : 15% retenue source + 17,2% PS
  //   → crédit d'impôt efface l'IR 12,8% → effectif 32,2%
  // Note : estimation sous hypothèse PFU. Le net réel peut différer
  // selon le choix barème progressif ou abattement 40%.
  function dividendEffectiveTaxRate(isin: string, subtype: string | null): number {
    if (subtype === "PEA") return 0;
    const country = isin.slice(0, 2).toUpperCase();
    if (country === "FR") return 0.30;
    // Pays avec traité 15% avec la France (US, NL, IE, DE, GB, LU, BE...)
    // Effectif = 15% retenue + 17,2% PS − crédit IR (12,8% < 15% → IR = 0) = 32,2%
    const treaty15 = ["US", "NL", "IE", "DE", "GB", "LU", "BE", "CA", "JP", "CH"];
    if (treaty15.includes(country)) return 0.322;
    return 0.30; // défaut : PFU sans retenue connue
  }

  type DividendRow = {
    isin: string; name: string; symbol: string; subtype: string | null;
    valueCents: bigint; annualEstCents: bigint; annualNetCents: bigint;
    taxRate: number; divYield: number; country: string;
  };
  const dividendRowsData: DividendRow[] = [];

  const allocation: Record<string, bigint> = {
    Liquidités: BigInt(0),
    Épargne: BigInt(0),
    Investissements: BigInt(0),
    Crypto: BigInt(0),
    Immobilier: BigInt(0),
    Automobile: BigInt(0),
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
        ? TAX_RATES.CRYPTO
        : account.type === "INVESTMENT" && account.investmentSubtype
        ? (TAX_RATES[account.investmentSubtype] ?? null)
        : null;

    if (account.type === "REAL_ESTATE" || account.type === "AUTOMOBILE") {
      value = account.manualValueCents ?? BigInt(0);
      const liability = account.liabilityCents ?? BigInt(0);
      totalLiabilities += liability;
      const equity = value - liability > BigInt(0) ? value - liability : BigInt(0);
      allocation[account.type === "AUTOMOBILE" ? "Automobile" : "Immobilier"] += equity;
      grossAssets += value;
    } else if (account.type === "INVESTMENT" || account.type === "CRYPTO") {
      for (const h of account.holdings) {
        const mv = holdingMarketValue(h);
        value += mv;

        // Tech exposure
        techValueCents += BigInt(Math.round(Number(mv) * (TECH_WEIGHTS[h.ticker] ?? 0)));
        totalInvestCents += mv;

        // Dividends — vrai yield Yahoo Finance, fallback sur taux hardcodé
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
      allocation[account.type === "CRYPTO" ? "Crypto" : "Investissements"] += value;
      grossAssets += value;
    } else if (account.type === "LOAN") {
      // Crédit : passif pur — réduit le patrimoine net, pas d'actif associé
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
      // Ne pas ajouter à assetRows (c'est un passif, pas un actif)
      continue;
    } else {
      value = account.history[0]?.balanceCents ?? BigInt(0);
      if (account.type === "SAVINGS") {
        allocation["Épargne"] += value;
        // Taux réglementés au 1er juin 2026 (à mettre à jour si changement de taux)
        const name = account.name.toLowerCase();
        let rate = 0;
        if (name.includes("lep")) rate = 0.025;           // LEP : 2,5%
        else if (name.includes("livret a")) rate = 0.015; // Livret A : 1,5%
        else if (name.includes("ldds")) rate = 0.015;     // LDDS = Livret A : 1,5%
        else if (name.includes("livret jeune") || name.includes("jeune")) rate = 0.025; // Livret Jeune : 2,5%
        else if (name.includes("livret")) rate = 0.015;   // autres livrets réglementés : 1,5%
        if (rate > 0) annualInterestCents += BigInt(Math.round(Number(value) * rate));
      } else {
        allocation["Liquidités"] += value;
        // Compte courant Trade Republic : 2% brut → 1,372% net (PFU 31,4% : IR 12,8% prélevé à la source + PS 17,2% + 0,2% contrib. due à la déclaration)
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
  // CAGR global — pondéré par le capital investi si les dates de début sont connues
  // CAGR(r) = (valeur / coût)^(1/années) − 1
  const nowMs = Date.now();
  const investAllHaveDates = investPerfRows.length > 0 && investPerfRows.every((r) => r.investmentStartDate !== null);
  let investCAGR: number | null = null;
  if (investAllHaveDates && investTotalCostBasis > BigInt(0)) {
    // Durée en années pour chaque compte, pondérée par le coût d'acquisition
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
        (Number(allocation["Investissements"] + allocation["Crypto"]) / Number(grossAssets)) * 100
      )
    : 0;
  const hasTaxData = totalLatentTax > BigInt(0);

  // ── Allocation metrics ───────────────────────────────────────────────────
  const garantis = allocation["Liquidités"] + allocation["Épargne"];
  const risques = allocation["Investissements"] + allocation["Crypto"];
  const garantisTotal = garantis + risques;
  const garantisPct = garantisTotal > BigInt(0)
    ? Math.round((Number(garantis) / Number(garantisTotal)) * 100)
    : 50;

  const techPct = totalInvestCents > BigInt(0)
    ? Math.round((Number(techValueCents) / Number(totalInvestCents)) * 100)
    : 0;

  // ── Passive income (net après fiscalité) ────────────────────────────────
  // Dividendes : net après PFU/PS selon l'enveloppe
  // Intérêts livrets : déjà nets (Livret A, LDDS, LEP sont exonérés d'IR en France)
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
    ? Number(allocation["Épargne"]) / Number(settings.monthlyExpensesCents)
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
    .map(([name, value]) => ({
      name,
      value: Number(value),
      color: CATEGORY_COLORS[name] ?? "#6b7280",
    }))
    .sort((a, b) => b.value - a.value);

  const totalAllocation = allocationSlices.reduce((s, d) => s + d.value, 0);

  // ── Debt accounts ────────────────────────────────────────────────────────
  // Crédits adossés à un actif (immobilier, auto) uniquement — les LOAN ont leur propre onglet
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
          <h1 className="text-2xl font-semibold text-[var(--foreground)]">Analytique</h1>
          <p className="text-sm text-[var(--muted)] mt-1">Analyse détaillée de votre patrimoine</p>
        </div>
        <ExportAnalyticsButton data={analyticsExport} />
      </div>

      {/* ── KPIs ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
          <p className="text-xs text-[var(--muted)] uppercase tracking-wider mb-2">Patrimoine Net</p>
          <p className="text-2xl font-semibold tabular-nums text-[var(--accent)]">
            {formatCurrency(hasTaxData ? netWorthAfterTax : netWorth, 0)}
          </p>
          {momDelta !== null && (
            <p
              className={`text-xs tabular-nums mt-1 ${
                momDelta >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"
              }`}
            >
              {momDelta >= 0 ? "+" : ""}
              {formatCurrency(momDelta, 0)} ce mois
            </p>
          )}
          {hasTaxData && (
            <p className="text-xs text-[var(--muted)] mt-1">
              ~{formatCurrency(netWorth, 0)} avant impôts
            </p>
          )}
        </div>
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
          <p className="text-xs text-[var(--muted)] uppercase tracking-wider mb-2">Patrimoine Brut</p>
          <p className="text-2xl font-semibold tabular-nums text-[var(--foreground)]">
            {formatCurrency(grossAssets, 0)}
          </p>
        </div>
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
          <p className="text-xs text-[var(--muted)] uppercase tracking-wider mb-2">Passif total</p>
          <p className="text-2xl font-semibold tabular-nums text-[var(--negative)]">
            {formatCurrency(totalLiabilities + totalLatentTax, 0)}
          </p>
          {grossAssets > BigInt(0) && (
            <div className="mt-1 space-y-0.5">
              <p className="text-xs text-[var(--muted)]">
                Dettes : {formatCurrency(totalLiabilities, 0)}
              </p>
              {hasTaxData && (
                <p className="text-xs text-[var(--muted)]">
                  Impôts latents : {formatCurrency(totalLatentTax, 0)}
                </p>
              )}
            </div>
          )}
        </div>
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
          <p className="text-xs text-[var(--muted)] uppercase tracking-wider mb-2">Taux investi</p>
          <p className="text-2xl font-semibold tabular-nums text-[var(--foreground)]">
            {investedPct}%
          </p>
          <p className="text-xs text-[var(--muted)] mt-1">du patrimoine brut</p>
        </div>
      </div>

      {hasData && (
        <>
          {/* ── Cash-Flow & Survie ── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Taux d'épargne */}
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
              <p className="text-xs text-[var(--muted)] uppercase tracking-wider mb-3">Taux d&apos;épargne</p>
              {!hasSalary ? (
                <div>
                  <p className="text-2xl font-semibold text-[var(--muted)]">—</p>
                  <Link href="/settings" className="text-xs text-[var(--accent)] mt-1 inline-flex items-center min-h-[44px] hover:underline">
                    Configurez votre salaire →
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
                        Élite
                      </span>
                    )}
                    {savingsRate >= 20 && savingsRate < 40 && (
                      <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-[var(--accent)]/15 text-[var(--accent)]">
                        Bon
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[var(--muted)] mt-1">
                    {hasDeclaredSavings
                      ? <>{formatCurrency(settings.monthlySavedCents, 0)} déclarés / {formatCurrency(settings.salaryNetCents, 0)} salaire</>
                      : <>{formatCurrency(momDelta!, 0)} MOM / {formatCurrency(settings.salaryNetCents, 0)} salaire</>
                    }
                  </p>
                  <p className="text-xs text-[var(--muted)] mt-0.5 opacity-70">
                    {hasDeclaredSavings
                      ? "Montant déclaré — hors virements inter-comptes et perf marché"
                      : "Variation patrimoine MOM — peut inclure transferts et marchés"
                    }
                  </p>
                </div>
              )}
            </div>

            {/* Runway */}
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
              <p className="text-xs text-[var(--muted)] uppercase tracking-wider mb-3">Runway · Mois de survie</p>
              {!hasExpenses ? (
                <div>
                  <p className="text-2xl font-semibold text-[var(--muted)]">—</p>
                  <Link href="/settings" className="text-xs text-[var(--accent)] mt-1 inline-flex items-center min-h-[44px] hover:underline">
                    Configurez vos dépenses →
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
                    {Math.floor(runwayMonths)} mois
                  </p>
                  <p className="text-xs text-[var(--muted)] mt-1">
                    {formatCurrency(allocation["Épargne"], 0)} épargne / {formatCurrency(settings.monthlyExpensesCents, 0)} / mois
                  </p>
                  <p className="text-xs text-[var(--muted)] mt-0.5 opacity-70">
                    {runwayMonths >= 12
                      ? "Sécurité solide"
                      : runwayMonths >= 6
                      ? "Tampon acceptable"
                      : "Attention — renforcer l'épargne de précaution"}
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
                  Cap des {formatCurrency(goalCents, 0)}
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
                      · encore {formatCurrency(goalRemaining, 0)}
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
                aria-label={`Objectif : ${goalPct}%`}
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
                  Revenus passifs estimés
                </p>
                <div className="grid grid-cols-3 gap-2 sm:gap-4">
                  <div>
                    <p className="text-xs text-[var(--muted)] mb-1">Par an</p>
                    <p className="text-lg font-semibold tabular-nums text-[var(--positive)]">
                      {formatCurrency(annualPassiveCents, 0)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-[var(--muted)] mb-1">Par mois</p>
                    <p className="text-lg font-semibold tabular-nums text-[var(--positive)]">
                      {formatCurrency(monthlyPassiveCents, 0)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-[var(--muted)] mb-1">Par jour</p>
                    <p className="text-lg font-semibold tabular-nums text-[var(--positive)]">
                      {formatCurrency(dailyPassiveCents, 2)}
                    </p>
                    <p className="text-xs text-[var(--muted)] mt-0.5">même quand tu dors</p>
                  </div>
                </div>
                {annualDividendsCents > BigInt(0) && (
                  <div className="mt-3 space-y-0.5">
                    <p className="text-xs text-[var(--muted)] opacity-70">
                      Dividendes (net) {formatCurrency(annualDividendsNetCents, 0)}
                      <span className="ml-1 opacity-60">· brut {formatCurrency(annualDividendsCents, 0)} − PFU 30%</span>
                    </p>
                    {annualInterestCents > BigInt(0) && (
                      <p className="text-xs text-[var(--muted)] opacity-70">
                        Intérêts livrets {formatCurrency(annualInterestCents, 0)} (exonérés d&apos;IR)
                      </p>
                    )}
                  </div>
                )}
                <p className="text-xs text-[var(--muted)] mt-1 opacity-70">
                  Montants nets · Livrets (LEP 2,5 % · Livret Jeune 2,5 % · Livret A 1,5 % · LDDS 1,5 %) + TR cash 1,372 % net (2 % brut − PFU 31,4 %) + dividendes actions — ETFs capitalisants exclus
                </p>
              </div>
            )}
          </div>

          {/* ── Charts ── */}
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div className="md:col-span-3 bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6">
              <h2 className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider mb-4">
                Évolution du patrimoine
              </h2>
              <NetWorthChart data={dailyHistory} />
            </div>
            <div className="md:col-span-2 bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6">
              <h2 className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider mb-4">
                Répartition
              </h2>
              <AssetAllocationChart data={allocationSlices} />
            </div>
          </div>

          {/* ── Calendrier des dividendes ── */}
          {dividendCalendar.length > 0 && (
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 sm:p-6">
              <div className="flex items-baseline justify-between mb-1">
                <h2 className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
                  Dividendes
                </h2>
                <div className="text-right">
                  <span className="text-sm font-semibold tabular-nums text-[var(--positive)]">
                    ~{formatCurrency(annualDividendsNetCents, 0)} net / an
                  </span>
                  <span className="text-xs text-[var(--muted)] ml-2">
                    brut {formatCurrency(annualDividendsCents, 0)}
                  </span>
                </div>
              </div>
              <p className="text-xs text-[var(--muted)] mb-4 opacity-70">
                Estimation nette · CTO FR: −30% PFU · CTO US/NL: −32,2% (retenue 15% + PS 17,2%) · PEA: exonéré
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
                              ? `Ex-div le ${row.exDividendDate.toLocaleDateString("fr-FR")}`
                              : daysLeft === 0
                              ? "Ex-div aujourd'hui"
                              : `Ex-div dans ${daysLeft}j · ${row.exDividendDate.toLocaleDateString("fr-FR")}`
                            }
                          </p>
                        ) : (
                          <p className="text-xs text-[var(--muted)] mt-0.5">Date inconnue</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-[var(--muted)] mt-3 opacity-70">
                Brut = yield TTM × valeur de position (Yahoo Finance) · Net = estimation sous PFU, résident français — non contractuel
              </p>
            </div>
          )}

          {/* ── Performance portefeuille CTO / PEA ── */}
          {investPerfRows.length > 0 && investTotalCostBasis > BigInt(0) && (
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 sm:p-6">
              <h2 className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider mb-4">
                Performance portefeuille · CTO / PEA
              </h2>

              {/* Résumé global */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-5">
                <div>
                  <p className="text-xs text-[var(--muted)] mb-1">Investi</p>
                  <p className="text-lg font-semibold tabular-nums text-[var(--foreground)]">
                    {formatCurrency(investTotalCostBasis, 0)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[var(--muted)] mb-1">Valeur actuelle</p>
                  <p className="text-lg font-semibold tabular-nums text-[var(--foreground)]">
                    {formatCurrency(investTotalValue, 0)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[var(--muted)] mb-1">Plus-value brute</p>
                  <p className={`text-lg font-semibold tabular-nums ${investTotalGain >= BigInt(0) ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>
                    {investTotalGain >= BigInt(0) ? "+" : ""}{formatCurrency(investTotalGain, 0)}
                  </p>
                  <p className="text-xs text-[var(--muted)] mt-0.5 opacity-70">
                    {investReturnPct >= 0 ? "+" : ""}{investReturnPct.toFixed(1)}% sur coût d&apos;achat
                    {investCAGR !== null && (
                      <> · <span className={investCAGR >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}>
                        {investCAGR >= 0 ? "+" : ""}{investCAGR.toFixed(1)}% / an (CAGR)
                      </span></>
                    )}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[var(--muted)] mb-1">Plus-value nette</p>
                  <p className={`text-lg font-semibold tabular-nums ${investTotalGainNet >= BigInt(0) ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>
                    {investTotalGainNet >= BigInt(0) ? "+" : ""}{formatCurrency(investTotalGainNet, 0)}
                  </p>
                  {investTotalTax > BigInt(0) && (
                    <p className="text-xs text-[var(--muted)] mt-0.5 opacity-70">
                      impôts latents −{formatCurrency(investTotalTax, 0)}
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
                        <th className="pb-2 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider">Compte</th>
                        <th className="pb-2 text-right text-xs font-medium text-[var(--muted)] uppercase tracking-wider">Investi</th>
                        <th className="pb-2 text-right text-xs font-medium text-[var(--muted)] uppercase tracking-wider">Valeur</th>
                        <th className="pb-2 text-right text-xs font-medium text-[var(--muted)] uppercase tracking-wider">Plus-value brute</th>
                        <th className="hidden sm:table-cell pb-2 text-right text-xs font-medium text-[var(--muted)] uppercase tracking-wider">Plus-value nette</th>
                        <th className="hidden sm:table-cell pb-2 text-right text-xs font-medium text-[var(--muted)] uppercase tracking-wider">CAGR</th>
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
                                  <> · depuis {row.investmentStartDate.toLocaleDateString("fr-FR", { month: "short", year: "numeric" })}</>
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
                                  {cagr >= 0 ? "+" : ""}{cagr.toFixed(1)}% / an
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
                CAGR = rendement annuel composé depuis la date de début · Net = brut après impôts latents (PEA {(TAX_RATES.PEA * 100).toFixed(1)}% · CTO {(TAX_RATES.CTO * 100).toFixed(1)}%) — non encore réalisés.
                {!investAllHaveDates && investPerfRows.length > 0 && (
                  <> · Renseigne la date de début dans chaque page de compte pour activer le CAGR.</>
                )}
              </p>
            </div>
          )}

          {/* ── Radar d'allocation ── */}
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 sm:p-6 space-y-6">
            <h2 className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
              Radar d&apos;allocation
            </h2>

            {/* Garantis vs Risqués */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-[var(--foreground)]">Garantis vs Risqués</span>
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
                <span>Livrets · {formatCurrency(garantis, 0)}</span>
                <span>Bourse · {formatCurrency(risques, 0)}</span>
              </div>
            </div>

            {/* Pure Tech exposure */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-[var(--foreground)]">Exposition Tech</span>
                  {techPct > 60 && (
                    <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-[var(--negative)]/15 text-[var(--negative)]">
                      Concentration élevée
                    </span>
                  )}
                  {techPct > 40 && techPct <= 60 && (
                    <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-[var(--accent)]/15 text-[var(--accent)]">
                      À surveiller
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
                Inclut l&apos;exposition indirecte via ETF Nasdaq, S&amp;P 500, MSCI World — poids théoriques approximatifs
              </p>
            </div>
          </div>

          {/* ── Allocation détaillée ── */}
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-[var(--border)]">
              <h2 className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
                Répartition détaillée
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
                    <div className="flex-1 h-1.5 bg-[var(--surface-elevated)] rounded-full overflow-hidden">
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
                  Performance mensuelle
                </h2>
              </div>
              <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)]">
                    <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider">Mois</th>
                    <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider">Patrimoine</th>
                    <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider">Variation</th>
                    <th className="hidden sm:table-cell px-6 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider">%</th>
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
                  Mes actifs
                </h2>
              </div>
              <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)]">
                    <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider">Actif</th>
                    <th className="hidden sm:table-cell px-6 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider">Catégorie</th>
                    <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider">Valeur</th>
                    <th className="hidden sm:table-cell px-6 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider">Plus-value</th>
                    <th className="hidden sm:table-cell px-6 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider">Impôt latent</th>
                    <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider">% Brut</th>
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
                            {TYPE_LABELS[asset.type] ?? asset.type}
                            {asset.subtype && ` · ${asset.subtype}`}
                          </p>
                          <p className="hidden sm:block text-xs text-[var(--muted)]">{asset.institution}</p>
                        </td>
                        <td className="hidden sm:table-cell px-6 py-3 text-[var(--muted)]">
                          {TYPE_LABELS[asset.type] ?? asset.type}
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
                            <div className="w-10 sm:w-16 h-1.5 bg-[var(--surface-elevated)] rounded-full overflow-hidden">
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
                  Analyse du financement
                </h2>
              </div>
              <div className="px-4 sm:px-6 py-4 border-b border-[var(--border)] flex flex-wrap items-center gap-4 sm:gap-8 text-sm">
                <div>
                  <p className="text-xs text-[var(--muted)] mb-1">Passif total</p>
                  <p className="tabular-nums font-semibold text-[var(--negative)]">
                    {formatCurrency(totalLiabilities, 0)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[var(--muted)] mb-1">Ratio dette / brut</p>
                  <p className="tabular-nums font-semibold text-[var(--foreground)]">
                    {debtRatio}%
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[var(--muted)] mb-1">Fonds propres</p>
                  <p className="tabular-nums font-semibold text-[var(--positive)]">
                    {formatCurrency(grossAssets - totalLiabilities, 0)}
                  </p>
                </div>
              </div>
              <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)]">
                    <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider">Bien</th>
                    <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider">Valeur</th>
                    <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider">Crédit</th>
                    <th className="hidden sm:table-cell px-6 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider">Fonds propres</th>
                    <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider">LTV</th>
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
                            <div className="w-10 sm:w-16 h-1.5 bg-[var(--surface-elevated)] rounded-full overflow-hidden">
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

      {!hasData && (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-10 text-center">
          <p className="text-sm text-[var(--muted)]">
            Aucune donnée — ajoutez des comptes dans{" "}
            <Link href="/accounts" className="text-[var(--accent)] underline underline-offset-2">
              Comptes
            </Link>
            .
          </p>
        </div>
      )}
    </div>
  );
}
