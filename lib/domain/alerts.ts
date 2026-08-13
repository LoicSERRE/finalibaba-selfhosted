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
