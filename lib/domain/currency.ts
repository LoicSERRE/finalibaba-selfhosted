import { Decimal } from "decimal.js";

/**
 * Accounts kept in another currency (v2.18, dev-docs/currencies.md step 1).
 * Every *Cents column stays EUR, so everything that sums them is untouched;
 * the native figure and the rate it was converted with sit beside it. Pure
 * logic only - rates are fetched and cached in lib/services/exchange-rate.ts.
 */

/** What every *Cents column means. Configurable later (step 2). */
export const BASE_CURRENCY = "EUR";

/**
 * Offered when creating an account. All have a Yahoo `EUR{XXX}=X` pair; the
 * sync side stores whatever a bank reports, this list only bounds the picker.
 */
export const ACCOUNT_CURRENCIES = ["EUR", "USD", "GBP", "CHF", "CAD", "AUD", "JPY", "SEK", "NOK", "DKK", "PLN", "CZK"] as const;

/** Cash accounts only: investments convert per holding, property and loans stay EUR. */
const MULTI_CURRENCY_TYPES = new Set(["CHECKING", "SAVINGS"]);

const ISO_CODE = /^[A-Z]{3}$/;

export function isCurrencyCode(value: unknown): value is string {
  return typeof value === "string" && ISO_CODE.test(value);
}

export function isBaseCurrency(currency: string): boolean {
  return currency === BASE_CURRENCY;
}

export function currencyAllowedFor(accountType: string): boolean {
  return MULTI_CURRENCY_TYPES.has(accountType);
}

/** A form's currency field, falling back to the base for anything unexpected or a type that has none. */
export function parseAccountCurrency(raw: unknown, accountType: string): string {
  if (!currencyAllowedFor(accountType)) return BASE_CURRENCY;
  return (ACCOUNT_CURRENCIES as readonly string[]).includes(raw as string) ? (raw as string) : BASE_CURRENCY;
}

/**
 * Native cents to base cents. Cents of any currency are hundredths of its
 * unit (a JPY amount too: formatting knows it has no decimals, storage does
 * not need to), so the rate applies as is. Rounded like every other Decimal
 * figure in the app.
 */
export function toBaseCents(nativeCents: bigint, rate: number): bigint {
  return BigInt(new Decimal(nativeCents.toString()).mul(rate).round().toFixed(0));
}

/** The columns a balance row gets for a native figure: base value, native value, rate. */
export function balanceColumns(
  currency: string,
  nativeCents: bigint,
  rate: number | null,
): { balanceCents: bigint; nativeBalanceCents: bigint | null; fxRate: number | null } {
  if (isBaseCurrency(currency)) return { balanceCents: nativeCents, nativeBalanceCents: null, fxRate: null };
  if (rate === null) throw new Error(`No ${currency} rate`);
  return { balanceCents: toBaseCents(nativeCents, rate), nativeBalanceCents: nativeCents, fxRate: rate };
}

/** Same for a transaction row. */
export function amountColumns(
  currency: string,
  nativeCents: bigint,
  rate: number | null,
): { amountCents: bigint; nativeAmountCents: bigint | null; fxRate: number | null } {
  const { balanceCents, nativeBalanceCents, fxRate } = balanceColumns(currency, nativeCents, rate);
  return { amountCents: balanceCents, nativeAmountCents: nativeBalanceCents, fxRate };
}

/** A row as stored: its native figure is the base one when it carries no rate. */
export function nativeOf(row: { balanceCents: bigint; nativeBalanceCents: bigint | null }): bigint {
  return row.nativeBalanceCents ?? row.balanceCents;
}

type StoredSnapshot = { id: string; balanceCents: bigint; nativeBalanceCents: bigint | null; fxRate: number | null };

/**
 * Moves snapshots by a native amount - what a backdated manual movement does
 * to every belief from its day on. On a foreign account the shift is in the
 * native figure, and each row's base value is recomputed with that row's own
 * rate: shifting the base values by one converted amount would re-price
 * every past day at today's rate.
 */
export function shiftSnapshots(rows: readonly StoredSnapshot[], deltaNativeCents: bigint): StoredSnapshot[] {
  return rows.map((row) => {
    if (row.fxRate === null || row.nativeBalanceCents === null) {
      return { ...row, balanceCents: row.balanceCents + deltaNativeCents };
    }
    const native = row.nativeBalanceCents + deltaNativeCents;
    return { ...row, nativeBalanceCents: native, balanceCents: toBaseCents(native, row.fxRate) };
  });
}

/** A calendar day as YYYY-MM-DD in UTC, the key ExchangeRate rows are stored under. */
export function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** How far back a missing day may borrow the previous close: a long weekend plus a holiday. */
const MAX_RATE_GAP_DAYS = 7;
const DAY_MS = 86_400_000;

/**
 * The rate for `day` from daily closes: that day's, else the latest earlier
 * one within a week (markets close at weekends, the rate does not move).
 * Null rather than a stale guess past that.
 */
export function pickRate(rows: readonly { day: string; rate: number }[], day: string): number | null {
  const target = Date.parse(`${day}T00:00:00Z`);
  let best: { at: number; rate: number } | null = null;
  for (const row of rows) {
    const at = Date.parse(`${row.day}T00:00:00Z`);
    if (at > target || target - at > MAX_RATE_GAP_DAYS * DAY_MS) continue;
    if (!best || at > best.at) best = { at, rate: row.rate };
  }
  return best?.rate ?? null;
}

type YahooChart = {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: { quote?: Array<{ close?: Array<number | null> }> };
    }>;
  };
};

/**
 * Daily rates out of a Yahoo chart response for `EUR{XXX}=X`. Yahoo quotes
 * "XXX per 1 EUR", so each close is inverted into "EUR per 1 XXX". Empty or
 * non-positive closes (a holiday Yahoo still lists) are dropped.
 */
export function parseYahooDailyRates(json: unknown): { day: string; rate: number }[] {
  const result = (json as YahooChart)?.chart?.result?.[0];
  const stamps = result?.timestamp ?? [];
  const closes = result?.indicators?.quote?.[0]?.close ?? [];
  const byDay = new Map<string, number>();
  stamps.forEach((stamp, i) => {
    const close = closes[i];
    if (typeof close !== "number" || Number.isNaN(close) || close <= 0) return;
    // Later entries for the same day (the live quote) replace earlier ones.
    byDay.set(dayKey(new Date(stamp * 1000)), 1 / close);
  });
  return [...byDay].map(([day, rate]) => ({ day, rate }));
}

/**
 * The revaluation row a foreign account needs today, or null (step 1c of
 * dev-docs/currencies.md). Nothing moved its native balance, but the rate
 * did, so its EUR value - what net worth counts - is stale.
 *
 * Dated at noon UTC like every manual write, so a correction typed later
 * today lands on the same row instead of sorting behind it. Skipped when the
 * latest row is already from today (it was converted at today's rate: rates
 * are daily) or when the EUR value would not change.
 */
export function revaluation(
  latest: { recordedAt: Date; balanceCents: bigint; nativeBalanceCents: bigint | null },
  currency: string,
  rate: number,
  todayNoon: Date,
): { recordedAt: Date; balanceCents: bigint; nativeBalanceCents: bigint; fxRate: number } | null {
  if (isBaseCurrency(currency) || latest.nativeBalanceCents === null) return null;
  if (dayKey(latest.recordedAt) >= dayKey(todayNoon)) return null;
  const balanceCents = toBaseCents(latest.nativeBalanceCents, rate);
  if (balanceCents === latest.balanceCents) return null;
  return { recordedAt: todayNoon, balanceCents, nativeBalanceCents: latest.nativeBalanceCents, fxRate: rate };
}

/**
 * What re-denominating a history stored as EUR writes (dev-docs/currencies.md,
 * step 1b): before v2.18 a synced account was EUR whatever its bank held, so
 * every stored figure is the bank's own number. Native = that number, EUR =
 * it converted at its own day's rate. Null when any day cannot be priced -
 * then nothing is rewritten and the next sync tries again.
 */
// Named types rather than an inline generic bound: that form hides the
// function from lizard (scripts/lizard-blind-spots.py).
type DatedCents = { id: string; cents: bigint; day: string };
type Redenominated = { id: string; native: bigint; base: bigint; rate: number };

export function redenominate(rows: readonly DatedCents[], rates: ReadonlyMap<string, number | null>): Redenominated[] | null {
  const out: Redenominated[] = [];
  for (const row of rows) {
    const rate = rates.get(row.day);
    if (rate === null || rate === undefined) return null;
    out.push({ id: row.id, native: row.cents, base: toBaseCents(row.cents, rate), rate });
  }
  return out;
}
