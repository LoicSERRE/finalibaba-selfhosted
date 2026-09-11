/**
 * Self-contained pieces of the analytics pass.
 *
 * Split out of computeAnalytics at v2.10.4, which lizard measured at 68
 * cyclomatic complexity - the most complex function in the repository. v2.10.2
 * had already halved that FILE without touching the function, which is the
 * distinction the release audit now records: a line count and a complexity
 * score answer different questions.
 *
 * Only blocks that take their inputs and return a value live here. The
 * per-account loop stays where it is, deliberately: it accumulates a dozen
 * running totals at once, and prising those apart would mean threading shared
 * state between functions, which trades one kind of complexity for a worse one.
 */
import { computeGoalProgress } from "@/lib/domain/goals";
import { isTrCashAccount } from "@/lib/domain/sync-ids";
import { FR_PFU_TOTAL_RATE } from "@/lib/domain/tax-locale";
import {
  estimateYearEndInterestCents,
  estimateYearEndInterestSeries,
  quinzaineBoundaries,
} from "@/lib/domain/savings-projection";
import {
  computeIndexCAGR,
  dividendEffectiveTaxRate,
  holdingMarketValue,
  DIVIDEND_YIELDS,
  ISIN_TO_YF_SYMBOL,
  type PricePoint,
  type YFDividendInfo,
} from "@/lib/domain/analytics-market";
import type {
  AnalyticsAccount,
  AnalyticsBalance,
  AnalyticsGoal,
  AssetRow,
  BenchmarkCAGRs,
  DebtAccountRow,
  DividendCalendarRow,
  GoalRow,
  SavingsInterestHistoryPoint,
} from "@/lib/domain/analytics-types";

/** How the year-end estimate got where it is, fortnight by fortnight. Its own
 *  function: it re-walks every account a second time for a different purpose,
 *  and sharing a loop with the total would only tangle two answers. */
function buildInterestHistory(
  accounts: AnalyticsAccount[],
  balancesByAccount: Map<string, { recordedAt: Date; balanceCents: bigint }[]>,
  earnsInterest: (a: AnalyticsAccount) => boolean,
  now: Date,
  intlLocale: string,
): SavingsInterestHistoryPoint[] {
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
  return estimatedYearEndInterestHistory;
}

/** The year-end interest estimate, and how it got there fortnight by fortnight. */
export function computeSavingsInterestProjection(
  accounts: AnalyticsAccount[],
  allBalances: AnalyticsBalance[],
  now: Date,
  intlLocale: string,
): { estimatedYearEndSavingsInterestCents: bigint; estimatedYearEndInterestHistory: SavingsInterestHistoryPoint[] } {
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
  const estimatedYearEndInterestHistory = buildInterestHistory(
    accounts, balancesByAccount, earnsInterest, now, intlLocale,
  );
  return { estimatedYearEndSavingsInterestCents, estimatedYearEndInterestHistory };
}

/** Progress per goal. `accountId: null` tracks net worth, which is a first-class
 *  choice rather than a fallback - see "Savings goals" in CLAUDE.md. */
export function computeGoalRows(
  goals: AnalyticsGoal[],
  assetRows: AssetRow[],
  accounts: AnalyticsAccount[],
  netWorth: bigint,
): GoalRow[] {
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
  return goalRows;
}

/** Asset-backed liabilities only - a LOAN account has its own tab. */
export function computeDebtAccounts(accounts: AnalyticsAccount[]): DebtAccountRow[] {
  return accounts
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
}

/** The same lookback window investCAGR used, applied to three reference indices.
 *  A point-in-time comparison, not a curve: investment balance snapshots are
 *  event-driven, so there is no reliable daily series to chart against. */
export function computeBenchmarkCAGRs(
  history: { msciWorld: PricePoint[]; sp500: PricePoint[]; cac40: PricePoint[] },
  investCAGRWeightedYears: number | null,
  nowMs: number,
): BenchmarkCAGRs | null {
  if (investCAGRWeightedYears === null) return null;
  const start = new Date(nowMs - investCAGRWeightedYears * 365.25 * 86_400_000);
  const end = new Date(nowMs);
  return {
    msciWorld: computeIndexCAGR(history.msciWorld, start, end),
    sp500: computeIndexCAGR(history.sp500, start, end),
    cac40: computeIndexCAGR(history.cac40, start, end),
  };
}

/**
 * Everything one investment or crypto account's positions contribute: its
 * market value, its cost basis and gain where known, and the dividends it is
 * estimated to throw off.
 *
 * Extracted from computeAnalytics' per-account loop at v2.10.4, and this is
 * the one that moved the number: the loop was where lizard's CCN 68 actually
 * lived, not in the sections around it. Returning contributions rather than
 * mutating seven accumulators in place is the point - the caller folds them.
 */
/** A dividend row before the calendar dates are resolved - those need the
 *  Yahoo payload, which the caller already holds. */
export type PendingDividendRow = Omit<
  DividendCalendarRow,
  "exDividendDate" | "annualRatePerShare" | "daysLeft" | "isPast" | "isSoon"
>;

export function analyseHoldings(
  account: AnalyticsAccount,
  taxRate: number | null,
  yfData: Record<string, YFDividendInfo>,
): {
  value: bigint;
  costBasis: bigint;
  gain: bigint;
  hasBasis: boolean;
  dividendsGrossCents: bigint;
  dividendsNetCents: bigint;
  dividendRows: PendingDividendRow[];
} {
  let value = BigInt(0);
  let costBasis = BigInt(0);
  let gain = BigInt(0);
  let hasBasis = false;
  let dividendsGrossCents = BigInt(0);
  let dividendsNetCents = BigInt(0);
  const dividendRows: PendingDividendRow[] = [];

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
            dividendsGrossCents += divCents;
            dividendsNetCents += divNetCents;
            if (symbol) {
              dividendRows.push({
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
            const holdingGain = mv - h.costBasisCents;
            costBasis += h.costBasisCents;
            gain += holdingGain;
          }
        }

  return { value, costBasis, gain, hasBasis, dividendsGrossCents, dividendsNetCents, dividendRows };
}

/**
 * What one fiat account contributes: its balance, which bucket it lands in,
 * and the interest it is estimated to earn over a year.
 *
 * Extracted from the same loop as analyseHoldings. `missingRate` is the part
 * that has to be counted rather than inferred: a null rate contributes nothing,
 * which is correct, and is indistinguishable on screen from an account that
 * genuinely pays none - the pattern the release audit names in its own right.
 */
export function analyseFiatAccount(account: AnalyticsAccount): {
  value: bigint;
  bucket: "savings" | "cash";
  annualInterestCents: bigint;
  weightedRateSum: number;
  balanceWithRateCents: bigint;
  missingRate: boolean;
} {
  const value = account.history[0]?.balanceCents ?? BigInt(0);
  let annualInterestCents = BigInt(0);
  let weightedRateSum = 0;
  let balanceWithRateCents = BigInt(0);
  let missingRate = false;

        if (account.type === "SAVINGS") {
          // bucket: savings
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
            missingRate = true;
          } else {
            weightedRateSum += rate * Number(value);
            balanceWithRateCents += value;
            if (rate > 0) annualInterestCents += BigInt(Math.round(Number(value) * rate));
          }
        } else {
          // bucket: cash
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

  return {
    value,
    bucket: account.type === "SAVINGS" ? "savings" : "cash",
    annualInterestCents,
    weightedRateSum,
    balanceWithRateCents,
    missingRate,
  };
}
