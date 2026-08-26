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
// Median day-gap must fall in this band to be inferred as this
// (frequency, intervalCount) pair. Every band still uses the same ~10%
// tolerance as the original MONTHLY×1 band (27-33 = 30±3) scaled to its own
// interval (54-66 = 60±6, 81-99 = 90±9) - not a looser threshold for the
// wider intervals. Bounded to MONTHLY×2/×3 specifically (bimonthly/
// quarterly) per the roadmap's own scope, not a general "any interval"
// inference - the gaps between bands (34-53, 67-80) are deliberately
// uncovered rather than guessed at, and WEEKLY/YEARLY stay ×1-only (a
// biweekly or biennial pattern falls through to no match, same as before).
const GAP_BANDS: { frequency: RecurringFrequency; intervalCount: number; min: number; max: number }[] = [
  { frequency: "WEEKLY", intervalCount: 1, min: 6, max: 8 },
  { frequency: "MONTHLY", intervalCount: 1, min: 27, max: 33 },
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
  series: RecurringSeries & { accountId: string; label: string; amountCents: bigint },
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
    if (Math.abs(Number(tx.amountCents) - Number(series.amountCents)) > tolerance) return false;
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
  // Most common category already assigned among the matched transactions, if
  // any - lets the confirm dialog start pre-filled instead of forcing the
  // user to re-pick a category they've already chosen for this label before.
  categoryId: string | null;
};

/**
 * Groups transactions by (accountId, normalized label) and flags groups whose
 * amounts and date spacing look regular enough to be a subscription or
 * regular income. Proposes intervalCount 2 or 3 for a MONTHLY pattern whose
 * spacing matches a bimonthly/quarterly GAP_BANDS entry (a semi-annual
 * insurance premium or a quarterly tax payment, for example) - beyond that,
 * inferring an arbitrary "every N months/weeks/years" cadence from noisy
 * gaps is still out of scope; the manual create/edit form covers that case.
 *
 * `existingKeys` (each `${accountId}|${normalizeLabel(label)}`) excludes
 * patterns already represented by a RecurringTransaction row - confirmed,
 * paused, or a previously dismissed suggestion - so they never resurface.
 */
export function detectCandidates(transactions: TxLike[], existingKeys: Set<string>): Candidate[] {
  const groups = new Map<string, TxLike[]>();
  for (const tx of transactions) {
    const key = `${tx.accountId}|${normalizeLabel(tx.label)}`;
    if (existingKeys.has(key)) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(tx);
  }

  const candidates: Candidate[] = [];

  for (const group of groups.values()) {
    if (group.length < MIN_OCCURRENCES) continue;

    const sorted = [...group].sort((a, b) => a.date.getTime() - b.date.getTime());
    const amounts = sorted.map((tx) => Number(tx.amountCents));
    const medianAmount = median(amounts);
    const tolerance = amountTolerance(Math.abs(medianAmount));
    const matchCount = amounts.filter((a) => Math.abs(a - medianAmount) <= tolerance).length;
    if (matchCount / amounts.length < MIN_MATCH_RATIO) continue;

    const gapsDays: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      gapsDays.push((sorted[i].date.getTime() - sorted[i - 1].date.getTime()) / (24 * 60 * 60 * 1000));
    }
    const medianGap = median(gapsDays);
    const band = GAP_BANDS.find((b) => medianGap >= b.min && medianGap <= b.max);
    if (!band) continue;

    const latest = sorted.at(-1)!;
    candidates.push({
      accountId: latest.accountId,
      label: latest.label,
      amountCents: Math.round(medianAmount),
      frequency: band.frequency,
      intervalCount: band.intervalCount,
      anchorDate: latest.date,
      categoryId: mode(sorted.map((tx) => tx.categoryId)),
    });
  }

  return candidates;
}

/**
 * "Mensuel"/"Hebdomadaire"/"Annuel" for intervalCount 1 (every existing
 * case before multi-interval detection), or "Tous les {n} mois" for a
 * detected bimonthly/quarterly MONTHLY candidate - the only multi-interval
 * case detectCandidates can produce (see its own comment). Deliberately
 * doesn't handle WEEKLY/YEARLY with intervalCount > 1 (only reachable via
 * the manual create/edit form, never detection) - "semaines" needs
 * "Toutes les", not "Tous les", and guessing at that agreement without a
 * confirmed real case to test against isn't worth the risk; those fall back
 * to the plain frequency label unchanged, same as before this feature.
 * Takes a plain (key: string) => string translator, not next-intl's own
 * richer type, so this works unmodified from both a Server Component's
 * getTranslations and a Client Component's useTranslations.
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
