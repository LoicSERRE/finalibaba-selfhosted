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
