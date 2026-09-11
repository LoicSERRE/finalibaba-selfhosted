/**
 * Year-end interest projection for a regulated French savings account
 * (Livret A, LDDS, LEP...), using the same "méthode des quinzaines" real
 * banks compute interest with: the year splits into 24 fortnights (the 1st
 * and the 16th of each month), and each fortnight earns interest on
 * whatever balance was in place at ITS OWN start - not a single flat
 * annual-rate-on-today's-balance guess, which either overstates a balance
 * that was much lower earlier in the year or understates one that's grown
 * since.
 *
 * Deliberately simplified relative to the real bank rule: a real bank
 * value-dates a deposit to the NEXT fortnight boundary and a withdrawal
 * immediately, which needs transaction-level direction data this function
 * does not take. Using the closest known balance snapshot instead is a
 * conscious approximation - close enough for "what will I likely earn by
 * year end", not a claim to reproduce a bank's own statement to the cent.
 */

const QUINZAINE_DAYS = [1, 16] as const;

/** The 24 fortnight start dates for a calendar year, in order, UTC midnight. */
export function quinzaineBoundaries(year: number): Date[] {
  const boundaries: Date[] = [];
  for (let month = 0; month < 12; month++) {
    for (const day of QUINZAINE_DAYS) {
      boundaries.push(new Date(Date.UTC(year, month, day)));
    }
  }
  return boundaries;
}

/**
 * The most recent balance recorded at or before `date`, or null if the
 * account has no snapshot that old - meaning it likely did not exist yet,
 * not that its balance was 0.
 */
export function balanceAtOrBefore(
  balances: readonly { recordedAt: Date; balanceCents: bigint }[],
  date: Date
): bigint | null {
  let best: { recordedAt: Date; balanceCents: bigint } | null = null;
  for (const b of balances) {
    if (b.recordedAt.getTime() <= date.getTime() && (best === null || b.recordedAt.getTime() > best.recordedAt.getTime())) {
      best = b;
    }
  }
  return best ? best.balanceCents : null;
}

/**
 * Estimated total interest for the calendar year `now` falls in: real
 * historical balances for every fortnight already started, the account's
 * current balance held flat for every fortnight still ahead (the honest
 * "if nothing else changes" assumption - this cannot know about a deposit
 * or withdrawal that hasn't happened yet).
 *
 * A fortnight before the EARLIEST known snapshot uses that earliest balance
 * held flat backward, symmetric with the forward extrapolation. Skipping those
 * fortnights instead reads an account's unsynced months as a 0 EUR balance,
 * which understates a real year badly - the common case is an old account whose
 * history in this app only starts when sync did. An account with no history at
 * all still contributes nothing.
 */
export function estimateYearEndInterestCents(
  balances: readonly { recordedAt: Date; balanceCents: bigint }[],
  currentBalanceCents: bigint,
  ratePct: number,
  now: Date,
  rateHistory: readonly RateUntil[] = []
): bigint {
  const boundaries = quinzaineBoundaries(now.getUTCFullYear());
  const earliestBalanceCents = earliestKnownBalance(balances);
  let totalCents = 0;
  for (const boundary of boundaries) {
    // The rate is resolved per fortnight, not once for the year: a regulated
    // rate moves mid-year, and one number applied to all 24 of them is wrong
    // on one side of that date by the whole spread over half a year.
    const rate = rateAtDate(ratePct, rateHistory, boundary);
    if (rate <= 0) continue;
    const balanceCents = boundary.getTime() <= now.getTime()
      ? balanceAtOrBefore(balances, boundary) ?? earliestBalanceCents
      : currentBalanceCents;
    if (balanceCents === null) continue;
    totalCents += (Number(balanceCents) * rate) / boundaries.length;
  }
  return BigInt(Math.round(totalCents));
}

/** What the account paid until `until` (exclusive) - see AccountInterestRate. */
export type RateUntil = { ratePct: number; until: Date };

/**
 * The rate in force on `at`.
 *
 * History rows say what the rate WAS until a date, so the answer is the
 * earliest row still open on that day, and today's rate when none is. Storing
 * changes the other way round ("became X on this date") would need two rows to
 * describe one change and would leave every day before the first row
 * undefined; this shape needs one row and has no undefined region.
 *
 * `until` is exclusive: a row until 2026-08-01 covers 31 July, not 1 August.
 */
export function rateAtDate(currentRatePct: number, history: readonly RateUntil[], at: Date): number {
  let best: RateUntil | null = null;
  for (const row of history) {
    if (row.until.getTime() <= at.getTime()) continue;
    if (best === null || row.until.getTime() < best.until.getTime()) best = row;
  }
  return best ? best.ratePct : currentRatePct;
}

/** The balance from the oldest snapshot in the array, or null if empty. */
function earliestKnownBalance(balances: readonly { recordedAt: Date; balanceCents: bigint }[]): bigint | null {
  let best: { recordedAt: Date; balanceCents: bigint } | null = null;
  for (const b of balances) {
    if (best === null || b.recordedAt.getTime() < best.recordedAt.getTime()) best = b;
  }
  return best ? best.balanceCents : null;
}

/**
 * The same projection re-run as of each of `evaluationDates`, so a chart can
 * show how the estimate moved through the year rather than only today's figure.
 *
 * MUST agree with estimateYearEndInterestCents on the backward extrapolation
 * above, or the curve contradicts the headline sitting on top of it - which is
 * exactly what happened when this kept the older skip-on-null rule.
 */
export function estimateYearEndInterestSeries(
  balances: readonly { recordedAt: Date; balanceCents: bigint }[],
  ratePct: number,
  evaluationDates: readonly Date[],
  rateHistory: readonly RateUntil[] = []
): { date: Date; estimatedCents: bigint }[] {
  const earliestBalanceCents = earliestKnownBalance(balances);
  if (earliestBalanceCents === null) return [];

  const points: { date: Date; estimatedCents: bigint }[] = [];
  for (const date of evaluationDates) {
    const balanceAsOfDate = balanceAtOrBefore(balances, date) ?? earliestBalanceCents;
    points.push({
      date,
      estimatedCents: estimateYearEndInterestCents(balances, balanceAsOfDate, ratePct, date, rateHistory),
    });
  }
  return points;
}
