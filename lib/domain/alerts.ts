import Decimal from "decimal.js";

// Loan is "nearly paid off" once its remaining capital drops to 5% or less
// of the original borrowed amount - a fixed constant rather than a
// per-account/per-user setting, to keep the Settings UI lean (see
// CLAUDE.md's "Alerts & webhooks" section for the reasoning).
const LOAN_NEARLY_PAID_OFF_RATIO_PCT = 5;

/**
 * wasAbove=null means this net worth threshold has never been evaluated
 * before (just set, or first run since the app started tracking it) - the
 * first check only establishes the baseline `isAbove` state, it never
 * fires. Otherwise a real net worth 20% above a freshly-set 100k€ threshold
 * would immediately "cross" it on the very next scheduled check, which
 * isn't what "notify me when it crosses" means.
 */
export function evaluateNetWorthAlert(
  current: bigint,
  threshold: bigint,
  wasAbove: boolean | null
): { shouldFire: boolean; isAbove: boolean } {
  const isAbove = current >= threshold;
  const shouldFire = wasAbove !== null && isAbove !== wasAbove;
  return { shouldFire, isAbove };
}

/**
 * Cross-multiplied (not a float division) to avoid bigint/float precision
 * mismatches at the cents scale this app otherwise never floats.
 */
export function isLoanNearlyPaidOff(remainingCents: bigint, originalCents: bigint): boolean {
  if (originalCents <= BigInt(0)) return false;
  return remainingCents * BigInt(100) <= originalCents * BigInt(LOAN_NEARLY_PAID_OFF_RATIO_PCT);
}

/**
 * Same edge-triggered "fires only when the crossing direction flips"
 * semantics as evaluateNetWorthAlert above, but kept as a separate function
 * (not a shared call) so the built-in net-worth trigger stays untouched -
 * this one backs the user-defined AlertRule mechanism instead of
 * UserSettings' fixed field. See AlertRule.balanceLastAbove.
 */
export function evaluateAccountBalanceAlert(
  current: bigint,
  thresholdCents: bigint,
  wasAbove: boolean | null
): { shouldFire: boolean; isAbove: boolean } {
  const isAbove = current >= thresholdCents;
  const shouldFire = wasAbove !== null && isAbove !== wasAbove;
  return { shouldFire, isAbove };
}

/**
 * Budget overrun re-arms every calendar month, unlike the edge-triggered
 * rule above - a category that overran its budget in July should alert
 * again in August even though spend never "un-overran" in between (it just
 * resets at the month boundary). `period` is "YYYY-MM" (UTC, computed by
 * the caller) so this stays pure/testable without mocking Date.
 * Level-triggered within a period: exceeding the budget at all during the
 * period fires once for that period.
 */
export function evaluateBudgetOverrunAlert(
  spentCents: bigint,
  budgetCents: bigint,
  period: string,
  lastFiredPeriod: string | null
): { shouldFire: boolean } {
  return { shouldFire: spentCents > budgetCents && lastFiredPeriod !== period };
}

/**
 * Same isolated-duplicate as lib/domain/accounts-page.ts's `holdingValue` /
 * lib/domain/account-detail.ts's `holdingMarketValue` - kept local to this
 * file rather than imported, matching how those two already don't share a
 * copy with each other either (each feature area's alert/page logic stays
 * self-contained, see CLAUDE.md's per-feature isolation notes elsewhere in
 * this file).
 */
export function holdingMarketValueCents(h: { quantity: Decimal; lastPriceCents: bigint }): bigint {
  return BigInt(new Decimal(h.quantity.toString()).mul(h.lastPriceCents.toString()).round().toNumber());
}

/**
 * Sums market value and cost basis across a set of holdings (one account's,
 * or every investment/crypto account's combined for the "all accounts"
 * UNREALIZED_GAIN mode), skipping any holding with unknown cost basis
 * (costBasisCents === null) - same convention accounts-page.ts's per-account
 * gain sum already uses, since an unknown-cost-basis holding can't
 * contribute a meaningful gain figure. gainPct is null when every
 * considered holding had a zero or unknown cost basis, since a percentage
 * gain isn't meaningful without a real cost-basis denominator.
 */
export function computeUnrealizedGain(
  holdings: { quantity: Decimal; lastPriceCents: bigint; costBasisCents: bigint | null }[]
): { gainCents: bigint; gainPct: number | null } {
  let totalCostBasis = BigInt(0);
  let gainCents = BigInt(0);
  for (const h of holdings) {
    if (h.costBasisCents === null) continue;
    gainCents += holdingMarketValueCents(h) - h.costBasisCents;
    totalCostBasis += h.costBasisCents;
  }
  const gainPct = totalCostBasis > BigInt(0) ? (Number(gainCents) / Number(totalCostBasis)) * 100 : null;
  return { gainCents, gainPct };
}

/**
 * Same edge-triggered shape as evaluateAccountBalanceAlert, but over a plain
 * float percentage instead of bigint cents - UNREALIZED_GAIN's gainUnit =
 * PERCENT case, and REBALANCING_DRIFT (fed |driftPts| - see
 * computeHoldingDriftPts below). Kept separate rather than coercing percent
 * into cents, since a stored threshold's unit must never be ambiguous (see
 * AlertRule.gainThresholdPct in schema.prisma).
 */
export function evaluatePercentAlert(
  currentPct: number,
  thresholdPct: number,
  wasAbove: boolean | null
): { shouldFire: boolean; isAbove: boolean } {
  const isAbove = currentPct >= thresholdPct;
  const shouldFire = wasAbove !== null && isAbove !== wasAbove;
  return { shouldFire, isAbove };
}

/**
 * REBALANCING_DRIFT's "current value" - how many points a holding's actual
 * weight has drifted from its Holding.targetPct. Same rounding as
 * lib/domain/account-detail.ts's computeAccountDetail (Math.round to an
 * integer percent before subtracting, both for the holding's own weight and
 * for the target) - this alert must never disagree with what the
 * account-detail page's own "Rééquilibrage" section shows for the same
 * holding. Kept as its own isolated copy in this file rather than importing
 * from account-detail.ts, same "each feature area's alert/page logic stays
 * self-contained" precedent already documented on holdingMarketValueCents
 * above. Returns null when the holding has no target set (a rule can
 * outlive the target being cleared after creation - malformed-row guard,
 * same shape as every other per-kind checker in app/api/alerts/check/route.ts)
 * or the account's total holdings value is 0 (division by zero guard - can
 * only happen if every holding in the account has a 0 price/quantity).
 */
export function computeHoldingDriftPts(
  holding: { targetPct: number | null; quantity: Decimal; lastPriceCents: bigint },
  accountHoldings: { quantity: Decimal; lastPriceCents: bigint }[]
): number | null {
  if (holding.targetPct === null) return null;
  const total = accountHoldings.reduce((sum, h) => sum + holdingMarketValueCents(h), BigInt(0));
  if (total <= BigInt(0)) return null;
  const marketValueCents = holdingMarketValueCents(holding);
  const pct = Math.round((Number(marketValueCents) / Number(total)) * 100);
  const targetPctInt = Math.round(holding.targetPct * 100);
  return pct - targetPctInt;
}

// NEW_TRANSACTION doesn't fit the threshold-crossing shape every other kind
// above does - "a new transaction exists" isn't a value crossing a line, so
// there's no isAbove/wasAbove pair here. The caller (checkNewTransactionRule
// in app/api/alerts/check/route.ts) already did the DB work of finding which
// transactions are new (createdAt after the rule's own cursor) and matching
// the rule's own account/threshold/direction filters - this function is pure
// text formatting only, same "no I/O" bar as every other evaluator in this
// file, just producing a title/body pair instead of a boolean.
const MAX_TRANSACTIONS_IN_DIGEST = 5;

export function evaluateNewTransactionAlert(
  transactions: { label: string; amountCents: bigint }[]
): { title: string; body: string } {
  if (transactions.length === 1) {
    const t = transactions[0];
    const amount = (Number(t.amountCents) / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return {
      title: "Nouvelle transaction",
      body: `${t.label} · ${t.amountCents >= BigInt(0) ? "+" : ""}${amount} €`,
    };
  }

  const shown = transactions.slice(0, MAX_TRANSACTIONS_IN_DIGEST);
  const lines = shown.map((t) => {
    const amount = (Number(t.amountCents) / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `${t.label} · ${t.amountCents >= BigInt(0) ? "+" : ""}${amount} €`;
  });
  if (transactions.length > MAX_TRANSACTIONS_IN_DIGEST) {
    lines.push(`+ ${transactions.length - MAX_TRANSACTIONS_IN_DIGEST} autre(s)`);
  }

  return {
    title: `${transactions.length} nouvelles transactions`,
    body: lines.join("\n"),
  };
}
