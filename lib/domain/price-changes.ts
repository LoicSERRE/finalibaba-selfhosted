/**
 * Price increases on recurring expenses (v2.20): the subscription that went
 * from 13,49 to 14,99, the insurance renewed 6% dearer. Pure - the page feeds
 * it the transactions it already loads, lib/services/recurring-price-changes.ts
 * loads them for the alert and the "update the amount" action.
 */

import {
  DEFAULT_GRACE_DAYS,
  getMostRecentExpectedOccurrence,
  isSameCommitment,
  normalizeLabel,
  type RecurringFrequency,
  type RecurringSeries,
} from "@/lib/domain/recurring";

/**
 * Below these, a difference is noise rather than a new price: a subscription
 * billed in another currency moves by a few cents with the exchange rate.
 */
export const MIN_INCREASE_RATIO = 0.02;
export const MIN_INCREASE_CENTS = 30;

export type PriceSeries = RecurringSeries & {
  accountId: string;
  label: string;
  /** Negative: an expense. */
  amountCents: bigint;
  amountVaries: boolean;
};

type Tx = { accountId: string; label: string; amountCents: bigint; date: Date };

export type PriceIncrease = {
  /** What the template says - negative, an expense. */
  fromCents: bigint;
  /** What the bank actually took on the latest occurrence. */
  toCents: bigint;
  date: Date;
  /** The extra a year, positive. */
  yearlyExtraCents: bigint;
};

export function occurrencesPerYear(frequency: RecurringFrequency, intervalCount: number): number {
  const perYear = { WEEKLY: 52, MONTHLY: 12, YEARLY: 1 }[frequency];
  return perYear / Math.max(1, intervalCount);
}

/** The charge closest to the expected date, under the same label on the same account. */
function latestCharge(series: PriceSeries, transactions: readonly Tx[], expected: Date): Tx | null {
  const graceMs = DEFAULT_GRACE_DAYS * 24 * 60 * 60 * 1000;
  const label = normalizeLabel(series.label);
  let best: Tx | null = null;
  for (const tx of transactions) {
    if (tx.accountId !== series.accountId || normalizeLabel(tx.label) !== label) continue;
    const distance = Math.abs(tx.date.getTime() - expected.getTime());
    if (distance > graceMs) continue;
    if (!best || distance < Math.abs(best.date.getTime() - expected.getTime())) best = tx;
  }
  return best;
}

/**
 * The latest expected charge of a fixed-amount expense, when it came in
 * dearer than the template - or null. A varying series (amountVaries) has no
 * price to compare against.
 */
export function detectPriceIncrease(series: PriceSeries, transactions: readonly Tx[], asOf: Date): PriceIncrease | null {
  if (series.amountCents >= BigInt(0) || series.amountVaries) return null;
  const expected = getMostRecentExpectedOccurrence(series, asOf);
  if (!expected) return null;
  const charge = latestCharge(series, transactions, expected);
  if (!charge || !isSameCommitment(series.amountCents, charge.amountCents)) return null;

  const before = -Number(series.amountCents);
  const after = -Number(charge.amountCents);
  const extra = after - before;
  if (extra < MIN_INCREASE_CENTS || extra < before * MIN_INCREASE_RATIO) return null;
  return {
    fromCents: series.amountCents,
    toCents: charge.amountCents,
    date: charge.date,
    yearlyExtraCents: BigInt(Math.round(extra * occurrencesPerYear(series.frequency, series.intervalCount))),
  };
}
