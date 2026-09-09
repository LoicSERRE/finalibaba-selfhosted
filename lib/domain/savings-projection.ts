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
 * A fortnight before the account's EARLIEST known snapshot uses that
 * earliest balance held flat backward - the same "assume it held" idealism
 * already applied forward from today, applied symmetrically. A first cut
 * of this function skipped those fortnights entirely on the reasoning that
 * the account "likely did not exist yet" - but for the far more common real
 * case (an account that existed all along, whose balance history in THIS
 * app only starts from whenever it was first synced), skipping produced the
 * same number as assuming a 0€ balance for every unsynced month, silently
 * understating a full year's worth of interest on an account that in fact
 * held its balance the whole time. Reported from a real instance: a Livret
 * showing ~250€ of known real interest for the year, and a LEP the user
 * said had not moved from 10k€ since January, summed with the rest of
 * their savings to well over the ~377€ this function was returning. Only
 * genuinely history-less accounts (an empty `balances` array) still
 * contribute nothing - there is no balance to extrapolate from at all.
 */
export function estimateYearEndInterestCents(
  balances: readonly { recordedAt: Date; balanceCents: bigint }[],
  currentBalanceCents: bigint,
  ratePct: number,
  now: Date
): bigint {
  if (ratePct <= 0) return BigInt(0);
  const boundaries = quinzaineBoundaries(now.getUTCFullYear());
  const earliestBalanceCents = earliestKnownBalance(balances);
  let totalCents = 0;
  for (const boundary of boundaries) {
    const balanceCents = boundary.getTime() <= now.getTime()
      ? balanceAtOrBefore(balances, boundary) ?? earliestBalanceCents
      : currentBalanceCents;
    if (balanceCents === null) continue;
    totalCents += (Number(balanceCents) * ratePct) / boundaries.length;
  }
  return BigInt(Math.round(totalCents));
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
 * What estimateYearEndInterestCents' own answer would have been on each of
 * `evaluationDates`, re-running the projection as if evaluated that day
 * (using only the balance known as of that day as its "current balance") -
 * lets a chart show how the estimate has actually moved through the year as
 * a livret's balance changed, rather than only ever showing today's single
 * number. Requested directly: the estimate can move a lot if money is
 * added to or taken out of a savings account, and there was no way to see
 * that it had.
 *
 * A date with no balance known yet that early is skipped (same "absent, not
 * a guessed 0" rule the projection itself follows), not plotted as if the
 * estimate were 0 on that day.
 */
export function estimateYearEndInterestSeries(
  balances: readonly { recordedAt: Date; balanceCents: bigint }[],
  ratePct: number,
  evaluationDates: readonly Date[]
): { date: Date; estimatedCents: bigint }[] {
  const points: { date: Date; estimatedCents: bigint }[] = [];
  for (const date of evaluationDates) {
    const balanceAsOfDate = balanceAtOrBefore(balances, date);
    if (balanceAsOfDate === null) continue;
    points.push({ date, estimatedCents: estimateYearEndInterestCents(balances, balanceAsOfDate, ratePct, date) });
  }
  return points;
}
