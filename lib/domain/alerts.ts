import Decimal from "decimal.js";

// Loan is "nearly paid off" once its remaining capital drops to 5% or less
// of the original borrowed amount - a fixed constant rather than a
// per-account/per-user setting, to keep the Settings UI lean (see
// CLAUDE.md's "Alerts & webhooks" section for the reasoning).
const LOAN_NEARLY_PAID_OFF_RATIO_PCT = 5;

/**
 * wasAbove=null means never evaluated: the first check only establishes the
 * baseline and never fires. Otherwise a net worth already above a freshly-set
 * threshold "crosses" it on the very next run.
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
 * Re-arms every calendar month rather than edge-triggering: a category that
 * overran in July should alert again in August, though spend never
 * "un-overran". `period` is "YYYY-MM", passed in so this stays pure.
 */
export function evaluateBudgetOverrunAlert(
  spentCents: bigint,
  budgetCents: bigint,
  period: string,
  lastFiredPeriod: string | null
): { shouldFire: boolean } {
  return { shouldFire: spentCents > budgetCents && lastFiredPeriod !== period };
}

/** Deliberately a local copy, like accounts-page.ts's and account-detail.ts's
 *  own - each feature area's logic stays self-contained. */
export function holdingMarketValueCents(h: { quantity: Decimal; lastPriceCents: bigint }): bigint {
  return BigInt(new Decimal(h.quantity.toString()).mul(h.lastPriceCents.toString()).round().toNumber());
}

/**
 * Market value and cost basis across a set of holdings, skipping any with an
 * unknown cost basis - it cannot contribute a meaningful gain. gainPct is null
 * when nothing had a real denominator.
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
 * evaluateAccountBalanceAlert's shape over a float percentage rather than
 * cents. Kept separate rather than coercing percent into cents: a stored
 * threshold's unit must never be ambiguous.
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
 * How many points a holding has drifted from its targetPct. MUST round the
 * same way computeAccountDetail does (integer percent before subtracting, both
 * sides), or this alert disagrees with the "Rééquilibrage" section for the same
 * holding. Null when no target is set - a rule outlives one being cleared - or
 * when the account totals zero.
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

// "A new transaction exists" is not a value crossing a line, so there is no
// isAbove/wasAbove pair here. The caller has already found the rows; this is
// pure text formatting.
const MAX_TRANSACTIONS_IN_DIGEST = 5;

/**
 * `totalCount` is how many transactions the cursor is about to move past,
 * which is not the same as how many were fetched to show: the caller pages the
 * digest. Defaults to the list's own length so a caller with nothing to page
 * reads unchanged, but passing it is what keeps "+ N autre(s)" honest instead
 * of describing the page as if it were everything.
 */
export function evaluateNewTransactionAlert(
  transactions: { label: string; amountCents: bigint }[],
  totalCount: number = transactions.length
): { title: string; body: string } {
  if (totalCount === 1 && transactions.length === 1) {
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
  if (totalCount > shown.length) {
    lines.push(`+ ${totalCount - shown.length} autre(s)`);
  }

  return {
    title: `${totalCount} nouvelles transactions`,
    body: lines.join("\n"),
  };
}
