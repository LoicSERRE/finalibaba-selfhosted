// Pure filter-parsing for /transactions - the global cross-account ledger
// (search/filter across every account, not just per-account or the
// /budgets/[categoryId] drill-down). Kept separate from the page's own
// Prisma `where` construction (DB-specific, stays in app/transactions/
// page.tsx per this project's lib/domain-has-no-DB-calls convention) so the
// searchParams-parsing itself - defaults, invalid-input handling - is
// testable in isolation.

export const TRANSACTIONS_PAGE_SIZE = 50;

// categoryId uses this sentinel for "uncategorized only", since Prisma's
// own `categoryId: null` can't be expressed as a plain query-string value -
// mirrors the same "uncategorized" concept already used in
// TransactionCategorySelect/the budgets uncategorized-groups feature.
export const UNCATEGORIZED_SENTINEL = "uncategorized";

export interface TransactionLedgerFilters {
  q: string | null;
  accountId: string | null;
  categoryId: string | null;
  from: Date | null;
  to: Date | null;
  // Both are a non-negative magnitude in cents (|amountCents|), not a
  // signed value - a user filtering "at least 50€" means either direction
  // (a big debit or a big credit), not just credits. See amountMagnitudeRanges.
  amountMin: bigint | null;
  amountMax: bigint | null;
  page: number;
}

export interface TransactionLedgerSearchParams {
  q?: string;
  accountId?: string;
  categoryId?: string;
  from?: string;
  to?: string;
  amountMin?: string;
  amountMax?: string;
  page?: string;
}

function parseDateParam(value: string | undefined): Date | null {
  if (!value) return null;
  // Noon UTC, same convention as CSV import / recurring detection - avoids
  // a day-shift in negative-UTC-offset timezones from a bare midnight parse.
  const d = new Date(`${value}T12:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Deliberately not lib/utils/format.ts's own parseCents() - that helper
// falls back to 0 on invalid input (a leniency other callers, like the
// settings tax-rate inputs, rely on), which would be wrong here: a garbage
// amountMin would silently become "0€ or more" (i.e. no filter at all)
// instead of being dropped. Same "invalid -> no filter" shape as
// parseDateParam above. Negative input is also rejected - these are a
// magnitude, never signed.
function parseAmountParam(value: string | undefined): bigint | null {
  if (!value) return null;
  const cleaned = value.replace(",", ".").replace(/\s/g, "");
  const amount = Number.parseFloat(cleaned);
  if (Number.isNaN(amount) || amount < 0) return null;
  return BigInt(Math.round(amount * 100));
}

export function parseTransactionLedgerFilters(
  searchParams: TransactionLedgerSearchParams,
): TransactionLedgerFilters {
  const page = Math.max(1, Number.parseInt(searchParams.page ?? "1", 10) || 1);
  return {
    q: searchParams.q?.trim() || null,
    accountId: searchParams.accountId?.trim() || null,
    categoryId: searchParams.categoryId?.trim() || null,
    from: parseDateParam(searchParams.from),
    to: parseDateParam(searchParams.to),
    amountMin: parseAmountParam(searchParams.amountMin),
    amountMax: parseAmountParam(searchParams.amountMax),
    page,
  };
}

export interface AmountRange {
  gte?: bigint;
  lte?: bigint;
}

// Prisma has no abs() in a WHERE filter, so "|amountCents| is between min
// and max" has to be expressed as one or two ranges OR'd together (the
// caller wraps each entry as `{ amountCents: range }` inside a Prisma `OR`).
// Returns null when neither bound is set (no amount filter at all).
//
// A min bound carves out a gap around zero, so it always needs two disjoint
// half-lines/bands: a positive side [min, max] and a negative side
// [-max, -min]. A max-only bound has no such gap - |x| <= max is one
// contiguous interval [-max, max] - so it must be a single range, not two
// OR'd together: `(x <= max) OR (x >= -max)` is a tautology (always true
// for any x, since every number is on at least one side of zero), which
// silently disabled the filter entirely when this returned two ranges here.
export function amountMagnitudeRanges(min: bigint | null, max: bigint | null): AmountRange[] | null {
  if (min === null && max === null) return null;
  if (min === null) return [{ gte: -max!, lte: max! }];
  const positive: AmountRange = { gte: min };
  if (max !== null) positive.lte = max;
  const negative: AmountRange = { lte: -min };
  if (max !== null) negative.gte = -max;
  return [positive, negative];
}

// The `to` filter is inclusive of the whole day it names - callers pass
// this as an exclusive upper bound (Prisma `lt`) rather than trying to
// express "end of day" as a literal timestamp.
export function dayAfter(date: Date): Date {
  return new Date(date.getTime() + 24 * 60 * 60 * 1000);
}
