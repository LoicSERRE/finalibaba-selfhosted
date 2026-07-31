import Decimal from "decimal.js";
import { getAccountTaxRate } from "@/lib/domain/tax";
import { calcCurrentCapital, hasLoanParams } from "@/lib/domain/loan";
import { holdingMarketValue } from "@/lib/domain/analytics";
import { getInstitutionLogoUrl } from "@/lib/domain/institutions";
import type { TaxTreatment } from "@/app/generated/prisma/enums";

/**
 * value - liability, floored at 0 (an underwater property/vehicle doesn't
 * turn into a negative "asset" bucket in the allocation breakdown - its
 * excess liability still counts via totalLiabilities). Shared with
 * lib/analytics.ts's identical real-estate/automobile rule so the two
 * pages' net worth figures can't silently drift apart from each other.
 */
export function clampedEquity(value: bigint, liability: bigint): bigint {
  return value - liability > BigInt(0) ? value - liability : BigInt(0);
}

// ── Input ──────────────────────────────────────────────────────────────────

export interface DashboardHolding {
  quantity: Decimal;
  lastPriceCents: bigint;
  costBasisCents: bigint | null;
}

export interface DashboardAccount {
  id: string;
  name: string;
  type: string; // AccountType
  institutionId: string | null;
  institution: { name: string; logoUrl: string | null } | null;
  taxTreatment: TaxTreatment;
  taxRatePct: number | null;
  manualValueCents: bigint | null;
  liabilityCents: bigint | null;
  loanAmountCents: bigint | null;
  loanTaeg: number | null;
  loanDurationMonths: number | null;
  loanDeferralMonths: number | null;
  loanStartDate: Date | null;
  holdings: DashboardHolding[];
  history: { balanceCents: bigint }[]; // most recent first, only history[0] is read
}

export interface DashboardBalance {
  accountId: string;
  recordedAt: Date;
  balanceCents: bigint;
}

export interface DashboardInput {
  accounts: DashboardAccount[];
  allBalances: DashboardBalance[];
  /** Locale used to format the display date strings in `history`. */
  intlLocale: string;
  /** Evaluation instant - never read internally via `new Date()`, so this stays pure/deterministic for tests. */
  now: Date;
}

// ── Output ─────────────────────────────────────────────────────────────────

export interface DashboardInstitutionGroup {
  name: string | null;
  logoUrl: string | null;
  total: bigint;
  accounts: { id: string; name: string; value: bigint; type: string }[];
}

export interface DashboardHistoryPoint {
  date: string; // pre-formatted per intlLocale
  netWorth: number;
}

export interface DashboardDelta {
  amount: number;
  percent: number | null;
}

export interface DashboardResult {
  hasAccounts: boolean;
  netWorth: bigint;
  grossAssets: bigint;
  totalPassif: bigint;
  totalLiabilities: bigint;
  totalLatentTax: bigint;
  allocationRaw: Record<string, number>;
  institutions: DashboardInstitutionGroup[];
  history: DashboardHistoryPoint[];
  delta30: DashboardDelta | null;
}

// Same single-pass-over-accounts rationale as lib/analytics.ts's
// computeAnalytics - covered by __tests__/dashboard.test.ts.
// eslint-disable-next-line sonarjs/cognitive-complexity
export function computeDashboard(input: DashboardInput): DashboardResult {
  const { accounts, allBalances, intlLocale, now } = input;

  let grossAssets = BigInt(0);
  let totalLiabilities = BigInt(0);
  let totalLatentTax = BigInt(0);

  const allocation: Record<string, bigint> = {
    cash: BigInt(0),
    savings: BigInt(0),
    investments: BigInt(0),
    crypto: BigInt(0),
    realEstate: BigInt(0),
    auto: BigInt(0),
  };

  const instMap = new Map<string, DashboardInstitutionGroup>();
  // Built from the same `accounts` list already fetched for the main loop
  // below - a second `prisma.account.findMany()` just for liabilityCents
  // (which every account already carries) was a fully redundant DB round
  // trip on every dashboard load.
  const liabMap = new Map<string, bigint>();

  for (const account of accounts) {
    liabMap.set(account.id, account.liabilityCents ?? BigInt(0));

    // Every branch below assigns a real value before use - the initializer
    // itself is redundant, but removing it risks a "used before assigned"
    // TS error since the if/else-if chain isn't a type-narrowable
    // discriminated union TS can prove is exhaustive.
    // eslint-disable-next-line sonarjs/no-dead-store
    let value = BigInt(0);

    if (account.type === "REAL_ESTATE" || account.type === "AUTOMOBILE") {
      value = account.manualValueCents ?? BigInt(0);
      const liability = account.liabilityCents ?? BigInt(0);
      totalLiabilities += liability;
      allocation[account.type === "AUTOMOBILE" ? "auto" : "realEstate"] += clampedEquity(value, liability);
      grossAssets += value;
    } else if (account.type === "INVESTMENT" || account.type === "CRYPTO") {
      let accountGain = BigInt(0);
      let hasBasis = false;
      value = account.holdings.reduce((sum, h) => {
        const mv = holdingMarketValue(h);
        if (h.costBasisCents != null) {
          hasBasis = true;
          accountGain += mv - h.costBasisCents;
        }
        return sum + mv;
      }, BigInt(0));
      // Latent tax on net gain
      if (hasBasis) {
        const taxRate = getAccountTaxRate(account);
        if (taxRate !== null && accountGain > BigInt(0)) {
          totalLatentTax += BigInt(Math.round(Number(accountGain) * taxRate));
        }
      }
      allocation[account.type === "CRYPTO" ? "crypto" : "investments"] += value;
      grossAssets += value;
    } else if (account.type === "LOAN") {
      // Loan: pure liability - no asset counterpart
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
      value = -loanBalance; // displayed as negative in the account list
    } else {
      value = account.history[0]?.balanceCents ?? BigInt(0);
      if (account.type === "SAVINGS") allocation["savings"] += value;
      else allocation["cash"] += value;
      grossAssets += value;
    }

    const instId = account.institutionId ?? "__personal__";
    if (!instMap.has(instId)) {
      const instName = account.institution?.name ?? null;
      instMap.set(instId, {
        name: instName,
        logoUrl: account.institution && instName
          ? (account.institution.logoUrl ?? getInstitutionLogoUrl(instName))
          : null,
        total: BigInt(0),
        accounts: [],
      });
    }
    const inst = instMap.get(instId)!;
    inst.total += value;
    inst.accounts.push({ id: account.id, name: account.name, value, type: account.type });
  }

  const netWorth = grossAssets - totalLiabilities - totalLatentTax;
  const totalPassif = totalLiabilities + totalLatentTax;
  const institutions = [...instMap.values()].sort((a, b) => Number(b.total - a.total));

  // ── Daily history ──────────────────────────────────────────────────────
  const dayMap = new Map<string, Map<string, bigint>>();
  for (const b of allBalances) {
    const day = b.recordedAt.toISOString().slice(0, 10);
    if (!dayMap.has(day)) dayMap.set(day, new Map());
    dayMap.get(day)!.set(b.accountId, b.balanceCents);
  }

  const sortedDays = [...dayMap.keys()].sort();
  const running = new Map<string, bigint>();
  const historyRaw: { day: string; netWorth: number }[] = [];

  for (const day of sortedDays) {
    for (const [id, v] of dayMap.get(day)!) running.set(id, v);
    let gross = BigInt(0);
    for (const v of running.values()) gross += v;
    let liab = BigInt(0);
    for (const [id, v] of liabMap) {
      if (running.has(id)) liab += v;
    }
    historyRaw.push({ day, netWorth: Number(gross - liab) });
  }

  const history: DashboardHistoryPoint[] = historyRaw.map(({ day, netWorth: nw }) => {
    const [y, m, d] = day.split("-");
    return {
      date: new Intl.DateTimeFormat(intlLocale, { day: "numeric", month: "short" }).format(new Date(+y, +m - 1, +d)),
      netWorth: nw,
    };
  });

  // 30-day delta across tracked accounts (fiat + real estate/auto via HistoricalBalance)
  let delta30: DashboardDelta | null = null;
  if (historyRaw.length >= 2) {
    const last = historyRaw[historyRaw.length - 1].netWorth;
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const refIdx = Math.max(0, sortedDays.findLastIndex((d) => d <= thirtyDaysAgo));
    const ref = historyRaw[refIdx].netWorth;
    const amount = last - ref;
    const percent = ref !== 0 ? (amount / Math.abs(ref)) * 100 : null;
    delta30 = { amount, percent };
  }

  return {
    hasAccounts: accounts.length > 0,
    netWorth,
    grossAssets,
    totalPassif,
    totalLiabilities,
    totalLatentTax,
    allocationRaw: {
      cash: Number(allocation["cash"]),
      savings: Number(allocation["savings"]),
      investments: Number(allocation["investments"]),
      crypto: Number(allocation["crypto"]),
      realEstate: Number(allocation["realEstate"]),
      auto: Number(allocation["auto"]),
    },
    institutions,
    history,
    delta30,
  };
}
