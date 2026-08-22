// Pure budget-rollover math - no I/O. Fetching the actual per-month spend
// numbers and deciding which categories are eligible stays in
// app/budgets/page.tsx, per this project's lib/domain-has-no-DB-calls
// convention (see lib/domain/transactions-ledger.ts for the same split).

export interface MonthKey {
  year: number;
  month: number; // 0-11, JS Date convention
}

// Safety cap on how many months back a rollover computation ever walks -
// same "safety cap, not a feature limit" reasoning as
// app/budgets/page.tsx's own MAX_UNCATEGORIZED_ROWS. A category enabled
// years ago and never touched since would otherwise make this computation
// (and the transaction query backing it) grow unbounded with account age.
export const MAX_ROLLOVER_MONTHS = 60;

// Every calendar month from `from` (inclusive) up to but excluding `to`,
// in chronological order, both truncated to their own month - used to
// enumerate the months a rollover carry needs to walk through, including
// months with zero transactions (a month with no spend still means the
// full budget carries forward, so it can't just be skipped).
export function monthsBetween(from: Date, to: Date): MonthKey[] {
  const months: MonthKey[] = [];
  let year = from.getUTCFullYear();
  let month = from.getUTCMonth();
  const endYear = to.getUTCFullYear();
  const endMonth = to.getUTCMonth();
  while (year < endYear || (year === endYear && month < endMonth)) {
    months.push({ year, month });
    month++;
    if (month > 11) {
      month = 0;
      year++;
    }
  }
  return months.slice(-MAX_ROLLOVER_MONTHS);
}

// Computes the rollover carry-in available for the *current* month, from a
// chronological (oldest -> newest) list of completed months' spend since
// rollover was enabled. Each month's available envelope is this category's
// budget plus whatever carried in from the month before; only a positive
// leftover carries forward - an overspent month contributes 0, it never
// creates a debt the next month has to pay down first. This is a
// deliberately simpler, safer variant of YNAB's own model (which does
// carry negative balances forward as visible debt) - matches the
// roadmap's literal wording ("unused envelope carries... instead of
// resetting to zero"), which only ever talks about surplus, not deficit.
export function computeRolloverCarryInCents(budgetCents: number, priorMonthsSpentCents: number[]): number {
  let carry = 0;
  for (const spentCents of priorMonthsSpentCents) {
    const available = budgetCents + carry;
    carry = Math.max(0, available - spentCents);
  }
  return carry;
}

// Combines a plain Transaction groupBy with a TransactionSplit groupBy for
// the same period into one categoryId -> cents map, summing overlapping
// keys - a category can have spend both from its own plain transactions
// and from split portions of other transactions in the same month. See
// CLAUDE.md's "Split transactions" for why a split transaction's amount
// never appears in the plain groupBy at all (its own categoryId is null).
export function mergeCentsMaps(a: Map<string | null, number>, b: Map<string | null, number>): Map<string | null, number> {
  const merged = new Map(a);
  for (const [key, value] of b) {
    merged.set(key, (merged.get(key) ?? 0) + value);
  }
  return merged;
}
