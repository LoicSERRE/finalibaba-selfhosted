import {
  amountMagnitudeRanges,
  dayAfter,
  UNCATEGORIZED_SENTINEL,
  type TransactionLedgerFilters,
} from "@/lib/domain/transactions-ledger";

/**
 * The ledger's filters as a Prisma `where` (moved out of
 * app/transactions/page.tsx at v2.14 so the CSV export, which must match
 * exactly what the page lists, builds the very same one). A query shape,
 * not a query: no I/O here, but Prisma-specific, so lib/services rather
 * than lib/domain.
 */
// Kept as its own function (not inlined into the page component below) to
// stay under the sonarjs cognitive-complexity gate - same reasoning as
// lib/actions/auto-categorize.ts's resolveDefaultCategoryIds/
// matchAgainstDefaults split. Still Prisma-specific and still lives in
// app/transactions/page.tsx, not lib/domain/transactions-ledger.ts - this
// project's lib/domain-has-no-DB-calls convention, see that file's own
// header comment.
//
// Built as an explicit AND of independent conditions, not one flat object
// with spread-in fields, because the category filter and the amount filter
// each need their own top-level "OR" (a category match has to check both
// the transaction's own categoryId and any of its splits' - see CLAUDE.md's
// "Split transactions") - a plain object can only ever hold one "OR" key,
// so two would silently collide/overwrite each other.
export function buildTransactionWhere(filters: TransactionLedgerFilters) {
  const amountRanges = amountMagnitudeRanges(filters.amountMin, filters.amountMax);
  const conditions: object[] = [{ isInternalTransfer: false }];
  // The search box reads notes too (v2.14): a note is exactly where someone
  // writes the word they will later search for.
  if (filters.q) {
    conditions.push({
      OR: [
        { label: { contains: filters.q, mode: "insensitive" as const } },
        { note: { contains: filters.q, mode: "insensitive" as const } },
      ],
    });
  }
  if (filters.tag) conditions.push({ tags: { has: filters.tag } });
  if (filters.accountId) conditions.push({ accountId: filters.accountId });
  if (filters.categoryId === UNCATEGORIZED_SENTINEL) {
    // Genuinely uncategorized (no category, no splits at all) OR a split
    // transaction with at least one deliberately-uncategorized line - both
    // count as "uncategorized" the same way app/budgets/page.tsx's own
    // uncategorizedSpentCents does.
    conditions.push({ OR: [{ categoryId: null, splits: { none: {} } }, { splits: { some: { categoryId: null } } }] });
  } else if (filters.categoryId) {
    conditions.push({ OR: [{ categoryId: filters.categoryId }, { splits: { some: { categoryId: filters.categoryId } } }] });
  }
  if (filters.from || filters.to) {
    conditions.push({
      date: {
        ...(filters.from ? { gte: filters.from } : {}),
        ...(filters.to ? { lt: dayAfter(filters.to) } : {}),
      },
    });
  }
  if (amountRanges) conditions.push({ OR: amountRanges.map((range) => ({ amountCents: range })) });
  return { AND: conditions };
}
