import { getOccurrencesInRange, type RecurringSeries } from "@/lib/domain/recurring";

/**
 * The month ahead on the dashboard (v2.16): every expected occurrence of the
 * active recurring series in the next `days`, soonest first, with the money
 * in and out. Pure.
 *
 * Recurring series only, on purpose. A loan's instalment is almost always
 * already a recurring debit on the current account, with nothing linking the
 * two reliably, so adding loan schedules would count the same payment twice.
 * Dividends are left out because the only date available is the ex-dividend
 * date, which is not when money arrives, and fetching it would put an
 * external call on the dashboard.
 */

export const UPCOMING_DAYS = 30;

export type UpcomingSeries = RecurringSeries & {
  id: string;
  label: string;
  amountCents: bigint;
  amountVaries: boolean;
};

export type UpcomingOccurrence = {
  seriesId: string;
  date: Date;
  label: string;
  amountCents: bigint;
  amountVaries: boolean;
};

export type UpcomingSummary = {
  occurrences: UpcomingOccurrence[];
  inCents: bigint;
  outCents: bigint;
};

export function upcomingOccurrences(series: readonly UpcomingSeries[], now: Date, days = UPCOMING_DAYS): UpcomingSummary {
  const to = new Date(now);
  to.setUTCDate(to.getUTCDate() + days);
  const occurrences = series
    .flatMap((s) =>
      getOccurrencesInRange(s, now, to).map((date) => ({
        seriesId: s.id,
        date,
        label: s.label,
        amountCents: s.amountCents,
        amountVaries: s.amountVaries,
      }))
    )
    .sort((a, b) => a.date.getTime() - b.date.getTime() || a.label.localeCompare(b.label));
  let inCents = BigInt(0);
  let outCents = BigInt(0);
  for (const o of occurrences) {
    if (o.amountCents >= BigInt(0)) inCents += o.amountCents;
    else outCents += o.amountCents;
  }
  return { occurrences, inCents, outCents };
}
