/**
 * Calculation module for recurring transactions: pattern detection over
 * transaction history, occurrence scheduling, missed-payment checks, and
 * cash-flow projection. Pure functions, no DB calls - mirrors lib/loan.ts's
 * shape (params in, computed stats out, an asOf/range argument for anything
 * date-dependent).
 */

export type RecurringFrequency = "WEEKLY" | "MONTHLY" | "YEARLY";

export type RecurringSeries = {
  frequency: RecurringFrequency;
  intervalCount: number;
  anchorDate: Date;
};

export const MIN_OCCURRENCES = 3;
export const AMOUNT_TOLERANCE_RATIO = 0.1;
export const AMOUNT_TOLERANCE_FLOOR_CENTS = 500; // 5€
export const MIN_MATCH_RATIO = 0.7;
export const DEFAULT_GRACE_DAYS = 5;
// The median day-gap band for each (frequency, intervalCount) pair, every one
// at the same ~10% tolerance scaled to its own interval. The gaps between
// bands (34-53, 67-80) are deliberately uncovered rather than guessed at, and
// WEEKLY/YEARLY stay x1-only.
const GAP_BANDS: { frequency: RecurringFrequency; intervalCount: number; min: number; max: number }[] = [
  { frequency: "WEEKLY", intervalCount: 1, min: 6, max: 8 },
  // 26-35 rather than 27-33: a monthly payment lands on a fixed day of the
  // month, and February to March is 28 days while a weekend or a bank holiday
  // pushes another one to 34 or 35. Measured on a real account, the narrow band
  // was rejecting a 100,00 EUR standing order that had never varied by a cent,
  // purely on a median gap of 34 days. Widening it added exactly that one
  // series and no noise.
  { frequency: "MONTHLY", intervalCount: 1, min: 26, max: 35 },
  { frequency: "MONTHLY", intervalCount: 2, min: 54, max: 66 },
  { frequency: "MONTHLY", intervalCount: 3, min: 81, max: 99 },
  { frequency: "YEARLY", intervalCount: 1, min: 350, max: 380 },
];

export function normalizeLabel(label: string): string {
  return label.trim().toLowerCase();
}

function median(nums: number[]): number {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function amountTolerance(medianAbsCents: number): number {
  return Math.max(Math.round(medianAbsCents * AMOUNT_TOLERANCE_RATIO), AMOUNT_TOLERANCE_FLOOR_CENTS);
}

/** Adds `months` to `date`, clamping the day when the target month is shorter. */
function addMonthsClamped(date: Date, months: number): Date {
  const day = date.getUTCDate();
  const base = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const daysInMonth = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
  base.setUTCDate(Math.min(day, daysInMonth));
  base.setUTCHours(12, 0, 0, 0); // keep the noon-UTC convention transaction dates use
  return base;
}

function stepDate(date: Date, frequency: RecurringFrequency, steps: number, intervalCount: number): Date {
  if (frequency === "WEEKLY") {
    const d = new Date(date);
    d.setUTCDate(d.getUTCDate() + 7 * intervalCount * steps);
    return d;
  }
  const months = frequency === "YEARLY" ? intervalCount * 12 : intervalCount;
  return addMonthsClamped(date, months * steps);
}

/**
 * Expected occurrence dates for a series between `from` and `to` (inclusive),
 * stepping forward and backward from `anchorDate` - used both for future
 * projection and for walking back to find the most recent past occurrence.
 */
export function getOccurrencesInRange(series: RecurringSeries, from: Date, to: Date): Date[] {
  const { frequency, intervalCount, anchorDate } = series;
  const occurrences: Date[] = [];

  // Walk backward from the anchor to cover `from`, then forward to cover `to`.
  let steps = 0;
  while (stepDate(anchorDate, frequency, steps, intervalCount) > from) steps--;
  let d = stepDate(anchorDate, frequency, steps, intervalCount);
  while (d <= to) {
    if (d >= from) occurrences.push(d);
    steps++;
    d = stepDate(anchorDate, frequency, steps, intervalCount);
  }
  return occurrences;
}

/** The single most recent expected occurrence on or before `asOf`. */
export function getMostRecentExpectedOccurrence(series: RecurringSeries, asOf: Date): Date | null {
  const farPast = new Date(series.anchorDate);
  farPast.setUTCFullYear(farPast.getUTCFullYear() - 10);
  const occurrences = getOccurrencesInRange(series, farPast, asOf);
  return occurrences.length > 0 ? occurrences.at(-1)! : null;
}

type TxLike = { accountId: string; label: string; amountCents: bigint; date: Date; categoryId?: string | null };

/** Most common non-null value in `values`, or null if none/tied for first place with no majority. */
function mode(values: (string | null | undefined)[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) {
    if (!v) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [v, count] of counts) {
    if (count > bestCount) {
      best = v;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Whether the most recent expected occurrence has a matching real transaction
 * within ± graceDays and the same amount tolerance used for detection.
 */
export function isMissed(
  series: RecurringSeries & { accountId: string; label: string; amountCents: bigint; amountVaries?: boolean },
  transactions: TxLike[],
  asOf: Date,
  graceDays: number = DEFAULT_GRACE_DAYS
): boolean {
  const expected = getMostRecentExpectedOccurrence(series, asOf);
  if (!expected) return false;

  const graceMs = graceDays * 24 * 60 * 60 * 1000;
  const tolerance = amountTolerance(Math.abs(Number(series.amountCents)));
  const normalized = normalizeLabel(series.label);

  const matched = transactions.some((tx) => {
    if (tx.accountId !== series.accountId) return false;
    if (normalizeLabel(tx.label) !== normalized) return false;
    // Skipped for a varying series: the stored figure is a median, not a
    // promise, and a salary paid at 1 715 EUR against a median of 900 would
    // otherwise read as MISSED on the month it actually arrived.
    if (!series.amountVaries && Math.abs(Number(tx.amountCents) - Number(series.amountCents)) > tolerance) return false;
    return Math.abs(tx.date.getTime() - expected.getTime()) <= graceMs;
  });

  return !matched;
}

export type Candidate = {
  accountId: string;
  label: string;
  amountCents: number;
  frequency: RecurringFrequency;
  // Which GAP_BANDS entry matched - 1 for every WEEKLY/YEARLY candidate and
  // plain monthly, 2 or 3 for a detected bimonthly/quarterly MONTHLY
  // pattern. Confirming the suggestion (components/recurring/suggestion-card.tsx)
  // must carry this through rather than assuming 1, or a correctly-detected
  // quarterly bill would be miscreated as a monthly one on confirm.
  intervalCount: number;
  anchorDate: Date;
  // True when the cadence is regular but the amount is not - a salary, a
  // benefit, a dividend. Carried through to the stored row because isMissed
  // must then stop checking the amount: a salary of 1 715 EUR arriving against
  // a stored median of 900 would otherwise be reported as MISSED on the very
  // month it was paid.
  amountVaries: boolean;
  // Most common category already assigned among the matched transactions, if
  // any - lets the confirm dialog start pre-filled instead of forcing the
  // user to re-pick a category they've already chosen for this label before.
  categoryId: string | null;
};


/**
 * How many days one cycle of a pattern spans. 30.44 rather than 30 so a
 * monthly gap measured across February is not systematically short.
 */
const CYCLE_DAYS: Record<RecurringFrequency, number> = {
  WEEKLY: 7,
  MONTHLY: 30.44,
  YEARLY: 365,
};

export function intervalDays(frequency: RecurringFrequency, intervalCount: number): number {
  return CYCLE_DAYS[frequency] * Math.max(1, intervalCount);
}

/**
 * A dismissed pattern, and the evidence the user was looking at when they
 * dismissed it: the most recent occurrence at that moment, and the cadence.
 */
export type DismissedPattern = {
  /** `${accountId}|${normalizeLabel(label)}` */
  key: string;
  anchorDate: Date;
  frequency: RecurringFrequency;
  intervalCount: number;
};

/**
 * A dismissal covers the occurrences the user saw, not the rest of time -
 * "stop suggesting Netflix" is unreasonable to be held to when you resubscribe
 * eight months later.
 *
 * The signal is a GAP, never new occurrences on their own: a subscription that
 * never stopped also keeps producing those, and re-suggesting them is exactly
 * the nagging a dismissal exists to end.
 */
const REAPPEARANCE_GAP_CYCLES = 3;

export function hasResumedAfterDismissal(dismissal: DismissedPattern, occurrenceDates: Date[]): boolean {
  const cycle = intervalDays(dismissal.frequency, dismissal.intervalCount);
  const anchorMs = dismissal.anchorDate.getTime();

  // The first occurrence after the moment of dismissal. Anything at or before
  // the anchor is evidence the user already weighed.
  const next = occurrenceDates
    .filter((d) => d.getTime() > anchorMs)
    .sort((a, b) => a.getTime() - b.getTime())[0];
  if (!next) return false;

  const gapDays = (next.getTime() - anchorMs) / (24 * 60 * 60 * 1000);
  // 3 cycles, not 2: skipping a single month is a missed payment, which this
  // app already surfaces separately, and treating it as a cancellation would
  // resurrect the suggestion for a subscription that plainly never stopped.
  return gapDays > cycle * REAPPEARANCE_GAP_CYCLES;
}

/**
 * Whether a group of same-label transactions is a regular series, and on what
 * cadence. Null for too few occurrences, amounts too scattered, or spacing
 * matching no GAP_BANDS entry.
 */
function analyseSeries(
  group: TxLike[],
  allowVaryingAmount = false,
): { sorted: TxLike[]; medianAmount: number; band: (typeof GAP_BANDS)[number]; amountVaries: boolean } | null {
  if (group.length < MIN_OCCURRENCES) return null;

  const sorted = [...group].sort((a, b) => a.date.getTime() - b.date.getTime());
  const amounts = sorted.map((tx) => Number(tx.amountCents));
  const medianAmount = median(amounts);
  const tolerance = amountTolerance(Math.abs(medianAmount));
  const matchCount = amounts.filter((a) => Math.abs(a - medianAmount) <= tolerance).length;
  // A regular cadence whose amount is never the same is a real thing on the
  // income side - a salary with bonuses, a benefit recalculated each quarter,
  // a dividend - and the amount test was rejecting all of it. Measured on a
  // real account: relaxing it for CREDITS ONLY added three series, every one
  // of them genuine (a salary, a family benefit, a reimbursement), and nothing
  // else. Relaxing it for debits too added four more, every one of them a
  // shopping habit rather than a commitment: a supermarket, a petrol station,
  // a restaurant, a computer shop. So the asymmetry is the finding, not a
  // hedge: money arriving on a rhythm is a pattern, money leaving on a rhythm
  // in wildly different amounts is just how someone shops.
  const amountVaries = matchCount / amounts.length < MIN_MATCH_RATIO;
  if (amountVaries && !(allowVaryingAmount && amounts.every((a) => a > 0))) return null;

  const gapsDays: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    gapsDays.push((sorted[i].date.getTime() - sorted[i - 1].date.getTime()) / (24 * 60 * 60 * 1000));
  }
  const medianGap = median(gapsDays);
  const band = GAP_BANDS.find((b) => medianGap >= b.min && medianGap <= b.max);
  if (!band) return null;

  return { sorted, medianAmount, band, amountVaries };
}

/**
 * Splits a group into runs of similar amounts, each measured against the
 * FIRST member rather than the previous one - comparing neighbours lets a
 * cluster drift arbitrarily far from where it started, one tolerance at a
 * time.
 */
function amountClusters(group: TxLike[]): TxLike[][] {
  const byAmount = [...group].sort((a, b) => Number(a.amountCents) - Number(b.amountCents));
  const clusters: TxLike[][] = [];
  let current: TxLike[] = [];
  for (const tx of byAmount) {
    if (current.length === 0) {
      current = [tx];
      continue;
    }
    const reference = Number(current[0].amountCents);
    if (Math.abs(Number(tx.amountCents) - reference) <= amountTolerance(Math.abs(reference))) {
      current.push(tx);
    } else {
      clusters.push(current);
      current = [tx];
    }
  }
  if (current.length > 0) clusters.push(current);
  return clusters;
}

/**
 * The regular series hiding inside a label whose amounts are too scattered as a
 * whole - one merchant that is both a subscription and a shop, where the
 * purchases drag the median around until the band fails.
 *
 * Only consulted AFTER the whole group fails, so a consistent label is judged
 * exactly as before. A cluster is then held to a STRICTER standard: EVERY
 * amount in the band, not 70%. A whole group earns its slack from being a
 * label's complete history; a subset picked for being similar has no such
 * excuse, and the looser rule turns any three similar purchases into a
 * subscription.
 */
function analyseAmountCluster(
  group: TxLike[],
): { sorted: TxLike[]; medianAmount: number; band: (typeof GAP_BANDS)[number]; amountVaries: boolean } | null {
  if (group.length < MIN_OCCURRENCES) return null;

  const clusters = amountClusters(group)
    .filter((c) => c.length >= MIN_OCCURRENCES && c.length < group.length)
    .sort((a, b) => b.length - a.length);

  for (const cluster of clusters) {
    const series = analyseSeries(cluster);
    if (!series) continue;
    const tolerance = amountTolerance(Math.abs(series.medianAmount));
    const unanimous = cluster.every((tx) => Math.abs(Number(tx.amountCents) - series.medianAmount) <= tolerance);
    if (unanimous) return series;
  }
  return null;
}

/**
 * Groups by (accountId, normalized label) and flags the groups regular enough
 * to be a subscription or regular income. Infers intervalCount 2 or 3 for a
 * MONTHLY pattern only; an arbitrary "every N" cadence from noisy gaps is out
 * of scope and the manual form covers it.
 *
 * `existingKeys` excludes patterns that already have a live row. `dismissed` is
 * separate rather than folded in, because a dismissal expires and therefore
 * needs its evidence - see hasResumedAfterDismissal.
 */
export function detectCandidates(
  transactions: TxLike[],
  existingKeys: Set<string>,
  dismissed: DismissedPattern[] = [],
): Candidate[] {
  const dismissedByKey = new Map(dismissed.map((d) => [d.key, d]));
  const groups = new Map<string, TxLike[]>();
  for (const tx of transactions) {
    const key = `${tx.accountId}|${normalizeLabel(tx.label)}`;
    if (existingKeys.has(key)) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(tx);
  }

  const candidates: Candidate[] = [];

  for (const [key, group] of groups) {
    // The whole label first; only if that fails, the regular series that may
    // be hiding inside it - see analyseAmountCluster.
    const series = analyseSeries(group, true) ?? analyseAmountCluster(group);
    if (!series) continue;

    const { sorted, medianAmount, band } = series;

    // A dismissed pattern stays suppressed unless it went quiet for longer
    // than its own cycle and then resumed - see hasResumedAfterDismissal for
    // why a gap, and not merely new occurrences, is the signal.
    const dismissal = dismissedByKey.get(key);
    if (dismissal && !hasResumedAfterDismissal(dismissal, sorted.map((tx) => tx.date))) continue;

    const latest = sorted.at(-1)!;
    candidates.push({
      accountId: latest.accountId,
      label: latest.label,
      amountCents: Math.round(medianAmount),
      frequency: band.frequency,
      intervalCount: band.intervalCount,
      anchorDate: latest.date,
      amountVaries: series.amountVaries,
      categoryId: mode(sorted.map((tx) => tx.categoryId)),
    });
  }

  return candidates;
}

/**
 * "Mensuel"/"Hebdomadaire"/"Annuel", or "Tous les {n} mois" for the one
 * multi-interval case detection can produce. WEEKLY/YEARLY above 1 fall back to
 * the plain label: "semaines" needs "Toutes les", and guessing that agreement
 * without a real case to test is not worth it.
 *
 * Takes a plain translator function so both getTranslations and
 * useTranslations can call it.
 */
export function formatFrequencyLabel(
  frequency: RecurringFrequency,
  intervalCount: number,
  t: (key: string) => string
): string {
  if (frequency === "MONTHLY" && intervalCount > 1) {
    return `${t("every")} ${intervalCount} ${t("months")}`;
  }
  return t(frequency.toLowerCase());
}

/**
 * Day-by-day cumulative projected net change from active recurring series
 * over [from, to] - a relative running total starting at 0, not tied to
 * actual account balances. One point per calendar day so a step chart
 * renders the "flat, then jump on occurrence day" shape correctly.
 */
export function projectDailyCumulative(
  series: (RecurringSeries & { amountCents: bigint })[],
  from: Date,
  to: Date
): { date: Date; cumulativeCents: number }[] {
  const byDay = new Map<string, number>();
  for (const s of series) {
    for (const occurrence of getOccurrencesInRange(s, from, to)) {
      const key = occurrence.toISOString().slice(0, 10);
      byDay.set(key, (byDay.get(key) ?? 0) + Number(s.amountCents));
    }
  }

  const points: { date: Date; cumulativeCents: number }[] = [];
  let cumulative = 0;
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
  while (cursor <= end) {
    const key = cursor.toISOString().slice(0, 10);
    cumulative += byDay.get(key) ?? 0;
    points.push({ date: new Date(cursor), cumulativeCents: cumulative });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return points;
}
