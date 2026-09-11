/**
 * The net-worth and allocation series behind the dashboard charts, plus the
 * 30-day delta read off them.
 *
 * Split out of computeDashboard at v2.10.4, which lizard measured at 60
 * cyclomatic complexity. This is a genuinely separate job from the
 * current-moment totals above it: it walks every day a balance was ever
 * recorded and re-derives what net worth was on each one.
 *
 * One approximation travels with it and is deliberate: a property's liability
 * is today's figure applied to every past day, because there is no historical
 * liability series - only the asset's own balance rows. A LOAN is the
 * exception, re-amortised per day through calcCurrentCapital, which is what
 * stopped the chart subtracting the original borrowed capital from every day
 * of its life (v2.10.0).
 */
import { calcCurrentCapital, hasLoanParams } from "@/lib/domain/loan";
import { clampedEquity } from "@/lib/domain/dashboard";
import type {
  DashboardAccount,
  DashboardAllocationHistoryPoint,
  DashboardBalance,
  DashboardDelta,
  DashboardHistoryPoint,
} from "@/lib/domain/dashboard";

/**
 * One point per day a balance was ever recorded, re-deriving what net worth
 * was on each. Its own function because it is the only genuinely expensive
 * part - a running map over every account, carried forward across days that
 * report nothing - and because the formatting around it reads better without
 * three nested loops in the middle of it.
 */
/** Which bucket a day's balance for one account lands in. Its own function so
 *  the six-way type test is not a sixth level of nesting inside the day walk. */
function addToBucket(
  buckets: Record<string, bigint>,
  type: string | undefined,
  accountId: string,
  value: bigint,
  liabMap: Map<string, bigint>,
): void {
  if (type === "SAVINGS") buckets.savings += value;
  else if (type === "CHECKING" || type === "MEAL_VOUCHER") buckets.cash += value;
  else if (type === "INVESTMENT") buckets.investments += value;
  else if (type === "CRYPTO") buckets.crypto += value;
  else if (type === "REAL_ESTATE") buckets.realEstate += clampedEquity(value, liabMap.get(accountId) ?? BigInt(0));
  else if (type === "AUTOMOBILE") buckets.auto += clampedEquity(value, liabMap.get(accountId) ?? BigInt(0));
}

/** A day's liabilities: a LOAN re-amortised to that date, anything else at its
 *  stored figure. Only accounts that actually have a balance that day count. */
function liabilitiesOn(
  dayDate: Date,
  running: Map<string, bigint>,
  liabMap: Map<string, bigint>,
  loanParamsMap: Map<string, Parameters<typeof calcCurrentCapital>[0]>,
): bigint {
  let liab = BigInt(0);
  for (const [id, v] of liabMap) {
    if (!running.has(id)) continue;
    const loan = loanParamsMap.get(id);
    liab += loan ? calcCurrentCapital(loan, dayDate) : v;
  }
  return liab;
}

function walkDailyBalances(
  sortedDays: string[],
  dayMap: Map<string, Map<string, bigint>>,
  liabMap: Map<string, bigint>,
  typeMap: Map<string, string>,
  loanParamsMap: Map<string, Parameters<typeof calcCurrentCapital>[0]>,
): { historyRaw: { day: string; netWorth: number }[]; allocationHistoryRaw: { day: string; buckets: Record<string, bigint> }[] } {
  const running = new Map<string, bigint>();
  const historyRaw: { day: string; netWorth: number }[] = [];
  const allocationHistoryRaw: { day: string; buckets: Record<string, bigint> }[] = [];

  for (const day of sortedDays) {
    for (const [id, v] of dayMap.get(day)!) running.set(id, v);
    let gross = BigInt(0);
    // Same 6 buckets as allocationRaw below - REAL_ESTATE/AUTOMOBILE go
    // through clampedEquity against today's liabilityCents (liabMap), the
    // same static-liability simplification the netWorth figure above
    // already applies uniformly across every past day (there's no
    // historical liability series, only the asset's own HistoricalBalance
    // rows) - not a new approximation introduced here, just extended to
    // this new per-category breakdown. LOAN accounts are skipped entirely,
    // matching allocationRaw's own exclusion (pure liability, no asset
    // counterpart).
    const buckets: Record<string, bigint> = {
      cash: BigInt(0), savings: BigInt(0), investments: BigInt(0),
      crypto: BigInt(0), realEstate: BigInt(0), auto: BigInt(0),
    };
    for (const [id, v] of running) {
      gross += v;
      addToBucket(buckets, typeMap.get(id), id, v, liabMap);
    }
    const [dy, dm, dd] = day.split("-");
    const dayDate = new Date(Date.UTC(+dy, +dm - 1, +dd));
    const liab = liabilitiesOn(dayDate, running, liabMap, loanParamsMap);
    historyRaw.push({ day, netWorth: Number(gross - liab) });
    allocationHistoryRaw.push({ day, buckets });
  }
  return { historyRaw, allocationHistoryRaw };
}

export function buildDashboardHistory(
  accounts: DashboardAccount[],
  allBalances: DashboardBalance[],
  liabMap: Map<string, bigint>,
  typeMap: Map<string, string>,
  intlLocale: string,
  now: Date,
): {
  history: DashboardHistoryPoint[];
  allocationHistory: DashboardAllocationHistoryPoint[];
  delta30: DashboardDelta | null;
} {
  const dayMap = new Map<string, Map<string, bigint>>();
  for (const b of allBalances) {
    const day = b.recordedAt.toISOString().slice(0, 10);
    if (!dayMap.has(day)) dayMap.set(day, new Map());
    dayMap.get(day)!.set(b.accountId, b.balanceCents);
  }

  // NOSONAR (typescript:S2871) - these keys are ISO 8601 "YYYY-MM-DD"
  // strings (from toISOString().slice(0,10) above), where lexicographic
  // order already equals chronological order by design - localeCompare
  // would add overhead for no behavior change.
  const sortedDays = [...dayMap.keys()].sort(); // NOSONAR
  // A loan's remaining capital on the day being drawn, not today's.
  //
  // liabMap holds Account.liabilityCents, which for a LOAN is the ORIGINAL
  // capital, written once at creation and never updated - there is no action
  // that touches it. Subtracting it from every historical point drew the
  // mortgage as a flat constant for its whole life: on a 200 000 EUR loan at
  // 3.5% over 25 years taken 12.5 years ago, the headline figure deducts the
  // real ~121 500 EUR while every point of the chart below it deducted
  // 200 000 EUR, a gap of ~78 500 EUR widening every month. It also erased
  // the shape - principal repaid is real wealth accumulating, and the chart
  // showed none of it.
  //
  // Unlike the real-estate case below, this is not a missing-data problem:
  // calcCurrentCapital is a closed form that already takes the date to
  // evaluate at, so the correct figure is derivable for every past day.
  const loanParamsMap = new Map<string, Parameters<typeof calcCurrentCapital>[0]>();
  for (const account of accounts) {
    if (account.type === "LOAN" && hasLoanParams(account)) {
      loanParamsMap.set(account.id, {
        loanAmountCents: account.loanAmountCents,
        loanTaeg: account.loanTaeg,
        loanDurationMonths: account.loanDurationMonths,
        loanDeferralMonths: account.loanDeferralMonths ?? 0,
        loanStartDate: account.loanStartDate,
      });
    }
  }

  const { historyRaw, allocationHistoryRaw } = walkDailyBalances(
    sortedDays, dayMap, liabMap, typeMap, loanParamsMap,
  );

  const history: DashboardHistoryPoint[] = historyRaw.map(({ day, netWorth: nw }) => {
    const [y, m, d] = day.split("-");
    return {
      date: new Intl.DateTimeFormat(intlLocale, { day: "numeric", month: "short" }).format(new Date(+y, +m - 1, +d)),
      isoDate: day,
      netWorth: nw,
    };
  });

  const allocationHistory: DashboardAllocationHistoryPoint[] = allocationHistoryRaw.map(({ day, buckets }) => {
    const [y, m, d] = day.split("-");
    return {
      date: new Intl.DateTimeFormat(intlLocale, { day: "numeric", month: "short" }).format(new Date(+y, +m - 1, +d)),
      isoDate: day,
      cash: Number(buckets.cash),
      savings: Number(buckets.savings),
      investments: Number(buckets.investments),
      crypto: Number(buckets.crypto),
      realEstate: Number(buckets.realEstate),
      auto: Number(buckets.auto),
    };
  });

  // 30-day delta across tracked accounts (fiat + real estate/auto via HistoricalBalance)
  let delta30: DashboardDelta | null = null;
  if (historyRaw.length >= 2) {
    const last = historyRaw.at(-1)!.netWorth;
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const refIdx = Math.max(0, sortedDays.findLastIndex((d) => d <= thirtyDaysAgo));
    const ref = historyRaw[refIdx].netWorth;
    const amount = last - ref;
    const percent = ref !== 0 ? (amount / Math.abs(ref)) * 100 : null;
    delta30 = { amount, percent };
  }

  return { history, allocationHistory, delta30 };
}
