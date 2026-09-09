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
 * A fortnight with no balance snapshot at or before its start (the account
 * did not exist yet, or has no history that far back) contributes nothing -
 * not a guessed 0-balance quinzaine treated as real data, just absent.
 */
export function estimateYearEndInterestCents(
  balances: readonly { recordedAt: Date; balanceCents: bigint }[],
  currentBalanceCents: bigint,
  ratePct: number,
  now: Date
): bigint {
  if (ratePct <= 0) return BigInt(0);
  const boundaries = quinzaineBoundaries(now.getUTCFullYear());
  let totalCents = 0;
  for (const boundary of boundaries) {
    const balanceCents = boundary.getTime() <= now.getTime()
      ? balanceAtOrBefore(balances, boundary)
      : currentBalanceCents;
    if (balanceCents === null) continue;
    totalCents += (Number(balanceCents) * ratePct) / boundaries.length;
  }
  return BigInt(Math.round(totalCents));
}
