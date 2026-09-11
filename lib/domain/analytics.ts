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
import { isTrCashAccount } from "@/lib/domain/sync-ids";
import { FR_PFU_TOTAL_RATE } from "@/lib/domain/tax-locale";
import { calcCurrentCapital, hasLoanParams } from "@/lib/domain/loan";
import { computeGoalProgress } from "@/lib/domain/goals";
import { estimateYearEndInterestCents, estimateYearEndInterestSeries, quinzaineBoundaries } from "@/lib/domain/savings-projection";
import { ALLOCATION_CATEGORY_COLORS as CATEGORY_COLORS } from "@/lib/utils/palette";
import {
  DIVIDEND_YIELDS,
  ISIN_TO_YF_SYMBOL,
  holdingMarketValue,
  dividendEffectiveTaxRate,
  computeIndexCAGR,
} from "@/lib/domain/analytics-market";
import type {
  AnalyticsAccount,
  AnalyticsInput,
  AnalyticsResult,
  AllocationSliceResult,
  AssetRow,
  BenchmarkCAGRs,
  DebtAccountRow,
  DividendCalendarRow,
  GoalRow,
  InvestPerfRow,
  MonthlyHistoryPoint,
  PerformanceRow,
  SavingsInterestHistoryPoint,
  TopAssetRow,
} from "@/lib/domain/analytics-types";

export * from "@/lib/domain/analytics-market";
export * from "@/lib/domain/analytics-types";
export * from "@/lib/domain/analytics-export";

// ── computeAnalytics ─────────────────────────────────────────────────────────

// Single-pass aggregation over every account, deliberately kept as one
// function so each account is only iterated once (accumulating gross
// assets, allocation, tax, dividends, top assets, debt in the same loop
// rather than N separate passes). Covered by __tests__/analytics.test.ts;
// splitting it would mean passing a lot of shared running state between
// pieces for no behavioral benefit.
// eslint-disable-next-line sonarjs/cognitive-complexity
export function computeAnalytics(input: AnalyticsInput): AnalyticsResult {
  const { accounts, allBalances, settings, goals, yfData, incomeEventsYtd, intlLocale, now } = input;
  const nowMs = now.getTime();

  // ── Compute current values ──────────────────────────────────────────────
  let grossAssets = BigInt(0);
  let totalLiabilities = BigInt(0);
  let totalLatentTax = BigInt(0);
  // v1.14 - cost-basis-weighted... no, gain-weighted blended effective tax
  // rate across every account with a real unrealized gain, for the
  // projection chart's tax-aware mode (see lib/domain/projection.ts). Same
  // "weight by the account's own contribution" pattern investCAGRWeightedYears
  // below already uses, just weighted by gain-in-cents instead of years.
  // EXEMPT/DEFERRED accounts contribute rate 0, naturally pulling the
  // blended rate down for a mostly tax-advantaged portfolio - mirrors how
  // totalLatentTax itself already behaves, just expressed as one reusable
  // rate instead of only ever an absolute cents amount.
  let weightedTaxRateSum = 0; // Σ(taxRate * gainCents)
  let totalPositiveGainCents = BigInt(0); // Σ(gainCents), gains only
  let annualDividendsCents = BigInt(0);    // gross
  let annualDividendsNetCents = BigInt(0); // net after tax
  let annualInterestCents = BigInt(0);     // already net (French regulated savings accounts are income-tax-exempt)
  // Interest-bearing accounts with no rate set. A null rate contributes
  // nothing, which is correct - but indistinguishable on screen from an
  // account that genuinely pays none, and this estimate is consumed by the
  // markdown export where nobody would ever see the shortfall. Counting it
  // lets the consumer say "this figure covers 2 of your 4 savings accounts"
  // instead of quietly under-reporting.
  let accountsMissingInterestRate = 0;
  // Balance-weighted average rate across SAVINGS accounts with a known
  // rate, for the Analytics page - a plain average of the rates themselves
  // would treat a 50€ Livret Jeune at 2.5% as equally significant as a
  // 15,000€ Livret A at 1.5%, which answers a different question than "what
  // is my money as a whole actually earning". Accounts with no rate set are
  // excluded from both sums rather than assumed to earn 0 - the same
  // "missing is not zero" reasoning accountsMissingInterestRate exists for.
  let weightedSavingsRateSum = 0; // Σ(rate * balanceCents)
  let savingsBalanceWithRateCents = BigInt(0);

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

        // Dividends - real Yahoo Finance yield, falls back to hard-coded rate
        const symbol = ISIN_TO_YF_SYMBOL[h.ticker];
        const yfInfo = symbol ? yfData[symbol] : null;
        const divYield = yfInfo?.annualYield ?? DIVIDEND_YIELDS[h.ticker] ?? 0;
        if (divYield > 0) {
          const divCents = BigInt(Math.round(Number(mv) * divYield));
          const subtype = account.investmentSubtype ?? null;
          // A broker that already withholds the full French tax before the
          // dividend lands (see Account.dividendsAlreadyNet's own comment)
          // must not have dividendEffectiveTaxRate applied on top - that
          // would double-count a deduction already taken.
          const divTaxRate = account.dividendsAlreadyNet ? 0 : dividendEffectiveTaxRate(h.ticker, subtype);
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
              alreadyNet: account.dividendsAlreadyNet,
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
        if (accountGain > BigInt(0)) {
          weightedTaxRateSum += taxRate * Number(accountGain);
          totalPositiveGainCents += accountGain;
        }
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
        // The account's own stored rate, not a guess from its name. This used
        // to match French product names ("livret a", "ldds", "lep") against
        // account.name on every render, which meant a savings account in any
        // other country contributed exactly zero to passive income - silently,
        // with nothing on screen to suggest a number was missing rather than
        // genuinely nil. It also made a rate change a code change.
        //
        // lib/domain/tax-locale.ts still SUGGESTS these same French rates when
        // a France-configured user names an account "Livret A", and the v2.4
        // migration backfilled every existing account from the old rules - so
        // an upgrading French instance sees identical figures. The difference
        // is that the number now lives on the account, where it is visible and
        // editable by anyone, anywhere.
        const rate = account.interestRatePct;
        if (rate === null) {
          accountsMissingInterestRate += 1;
        } else {
          weightedSavingsRateSum += rate * Number(value);
          savingsBalanceWithRateCents += value;
          if (rate > 0) annualInterestCents += BigInt(Math.round(Number(value) * rate));
        }
      } else {
        allocation["cash"] += value;
        // A rate the user set wins over any built-in guess - a current account
        // can pay interest anywhere, and only its holder knows what.
        //
        // The Trade Republic fallback below stays for accounts with no stored
        // rate, so nothing changes for an existing install, but note what it
        // bakes in: 2% gross nets down only under the FRENCH flat tax
        // (FR_PFU_TOTAL_RATE - see tax-locale.ts). A German or Italian Trade
        // Republic user is taxed differently on the same 2%. Setting the
        // rate on the account is how they correct it, which was not
        // possible before this field existed.
        const cashRate = account.interestRatePct;
        if (cashRate !== null && cashRate > 0) {
          annualInterestCents += BigInt(Math.round(Number(value) * cashRate));
        } else if (cashRate === null && isTrCashAccount(account.syncId)) {
          const TR_CASH_FALLBACK_GROSS_RATE = 0.02;
          annualInterestCents += BigInt(
            Math.round(Number(value) * TR_CASH_FALLBACK_GROSS_RATE * (1 - FR_PFU_TOTAL_RATE))
          );
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

  // "Net worth" means AFTER latent tax, here as in lib/domain/dashboard.ts.
  // These two files used to disagree - this one called the pre-tax figure
  // `netWorth` - and the disagreement was not academic: the KPI card knew to
  // display the after-tax one, but the goals on the same page were fed this
  // variable, so a goal could read 100% complete against a number the card
  // directly above it said you did not have.
  const netWorthBeforeTax = grossAssets - totalLiabilities;
  const netWorth = netWorthBeforeTax - totalLatentTax;
  const debtRatio = grossAssets > BigInt(0)
    ? Math.round((Number(totalLiabilities) / Number(grossAssets)) * 100)
    : 0;
  const investedPct = grossAssets > BigInt(0)
    ? Math.round(
        (Number(allocation["investments"] + allocation["crypto"]) / Number(grossAssets)) * 100
      )
    : 0;
  const hasTaxData = totalLatentTax > BigInt(0);
  const effectiveTaxRate = totalPositiveGainCents > BigInt(0) ? weightedTaxRateSum / Number(totalPositiveGainCents) : 0;
  // null (not 0) when no SAVINGS account has a known rate - same "unknown is
  // not zero" convention as accountsMissingInterestRate itself, so a
  // display can say "no data" instead of a misleading 0%.
  const weightedSavingsRatePct = savingsBalanceWithRateCents > BigInt(0)
    ? weightedSavingsRateSum / Number(savingsBalanceWithRateCents)
    : null;

  // ── Allocation metrics ───────────────────────────────────────────────────
  const garantis = allocation["cash"] + allocation["savings"];
  const risques = allocation["investments"] + allocation["crypto"];
  const garantisTotal = garantis + risques;
  const garantisPct = garantisTotal > BigInt(0)
    ? Math.round((Number(garantis) / Number(garantisTotal)) * 100)
    : 50;

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

  // ── Goal progress (v1.14 - N independent goals) ─────────────────────────
  // Built once, not per-goal inside the .map below - accountId: null
  // (net-worth-tracking) never needs a lookup, but every account-linked
  // goal does, and a fresh Map lookup per goal is cheap either way for the
  // handful of goals a personal instance realistically has.
  const assetValueById = new Map(assetRows.map((r) => [r.id, r.value]));
  const accountNameById = new Map(accounts.map((a) => [a.id, a.name]));
  const goalRows: GoalRow[] = goals.map((g) => {
    const currentCents = g.accountId !== null ? (assetValueById.get(g.accountId) ?? BigInt(0)) : netWorth;
    const { pct, remaining } = computeGoalProgress(currentCents, g.targetCents);
    return {
      id: g.id,
      name: g.name,
      targetCents: g.targetCents,
      targetDate: g.targetDate,
      accountId: g.accountId,
      accountName: g.accountId !== null ? (accountNameById.get(g.accountId) ?? null) : null,
      currentCents,
      pct,
      remaining,
    };
  });

  // ── Cash-flow metrics (require user settings) ───────────────────────────
  const hasSalary = settings.salaryNetCents > BigInt(0);
  const hasExpenses = settings.monthlyExpensesCents > BigInt(0);

  // Runway = total savings / monthly expenses
  const runwayMonths = hasExpenses
    ? Number(allocation["savings"]) / Number(settings.monthlyExpensesCents)
    : null;

  // ── Year-end savings interest projection (méthode des quinzaines) ───────
  // See lib/domain/savings-projection.ts's own header for the method and
  // why it's a deliberate simplification of the real bank rule.
  const balancesByAccount = new Map<string, { recordedAt: Date; balanceCents: bigint }[]>();
  for (const b of allBalances) {
    if (!balancesByAccount.has(b.accountId)) balancesByAccount.set(b.accountId, []);
    balancesByAccount.get(b.accountId)!.push({ recordedAt: b.recordedAt, balanceCents: b.balanceCents });
  }
  // An account earns from this estimate when it has a rate NOW or had one
  // earlier in the year - a rate that has since been set to zero still paid
  // for the fortnights it covered, and skipping the account outright would
  // silently drop them.
  const earnsInterest = (a: AnalyticsAccount) =>
    a.type === "SAVINGS" &&
    (((a.interestRatePct ?? 0) > 0) || (a.interestRateHistory ?? []).some((r) => r.ratePct > 0));

  let estimatedYearEndSavingsInterestCents = BigInt(0);
  for (const account of accounts) {
    if (!earnsInterest(account)) continue;
    const currentBalanceCents = account.history[0]?.balanceCents ?? BigInt(0);
    estimatedYearEndSavingsInterestCents += estimateYearEndInterestCents(
      balancesByAccount.get(account.id) ?? [],
      currentBalanceCents,
      account.interestRatePct ?? 0,
      now,
      account.interestRateHistory ?? []
    );
  }

  // Re-runs the same projection as of each past quinzaine boundary this
  // year, summed across every SAVINGS account with a rate, so a chart can
  // show how the estimate has moved (a deposit, a withdrawal, a rate
  // change) rather than only ever showing today's single figure.
  const interestHistoryBoundaries = quinzaineBoundaries(now.getUTCFullYear()).filter((b) => b.getTime() <= now.getTime());
  const interestHistoryTotals = new Map<number, bigint>();
  for (const account of accounts) {
    if (!earnsInterest(account)) continue;
    const series = estimateYearEndInterestSeries(
      balancesByAccount.get(account.id) ?? [],
      account.interestRatePct ?? 0,
      interestHistoryBoundaries,
      account.interestRateHistory ?? []
    );
    for (const point of series) {
      const key = point.date.getTime();
      interestHistoryTotals.set(key, (interestHistoryTotals.get(key) ?? BigInt(0)) + point.estimatedCents);
    }
  }
  const estimatedYearEndInterestHistory: SavingsInterestHistoryPoint[] = interestHistoryBoundaries
    .filter((b) => interestHistoryTotals.has(b.getTime()))
    .map((b) => ({
      date: new Intl.DateTimeFormat(intlLocale, { day: "numeric", month: "short" }).format(b),
      isoDate: b.toISOString().slice(0, 10),
      estimatedCents: Number(interestHistoryTotals.get(b.getTime())!),
    }));

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
  // NOSONAR (typescript:S2871) - "YYYY-MM" keys (ISO 8601, from
  // toISOString().slice(0,7) above): lexicographic order already equals
  // chronological order by design, localeCompare adds nothing here.
  const monthlyHistory: MonthlyHistoryPoint[] = [...monthMap.keys()].sort().map((month) => { // NOSONAR
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
      ? monthlyHistory.at(-1)!.netWorth -
        monthlyHistory.at(-2)!.netWorth
      : null;

  // Savings rate: declared monthly savings take priority (avoids MOM distortion from
  // inter-account transfers, market performance, and first-sync balance imports)
  const hasDeclaredSavings = settings.monthlySavedCents > BigInt(0);
  let savingsRate: number | null = null;
  if (hasSalary) {
    if (hasDeclaredSavings) {
      savingsRate = (Number(settings.monthlySavedCents) / Number(settings.salaryNetCents)) * 100;
    } else if (momDelta !== null) {
      savingsRate = (momDelta / Number(settings.salaryNetCents)) * 100;
    }
  }

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
    netWorthBeforeTax,
    grossAssets,
    totalLiabilities,
    totalLatentTax,
    investedPct,
    hasTaxData,
    effectiveTaxRate,
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
    goals: goalRows,
    realYtdDividendsNetCents,
    realYtdInterestNetCents,
    realYtdPassiveNetCents,
    annualDividendsCents,
    annualDividendsNetCents,
    annualInterestCents,
    accountsMissingInterestRate,
    weightedSavingsRatePct,
    estimatedYearEndSavingsInterestCents,
    estimatedYearEndInterestHistory,
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
    allocationSlices,
    totalAllocation,
    performanceRows,
    topAssets,
    assetRows,
    debtAccounts,
    debtRatio,
  };
}
