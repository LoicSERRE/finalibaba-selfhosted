// Every query that sums real spend/income by category must exclude
// internal transfers - they're not real spending or income, see
// CLAUDE.md's "Internal transfer detection". This got forgotten twice in
// the v1.13 session (once in a first draft of the global ledger, caught
// before release; once as a pre-existing gap in the BUDGET_OVERRUN custom
// alert, found and fixed) purely because every call site had to remember
// a bare `isInternalTransfer: false` (or, for TransactionSplit,
// `transaction: { isInternalTransfer: false }`) by convention, with
// nothing making it hard to omit. These two helpers are the one place
// that convention now lives - any new category/spend/income query should
// start from one of these rather than writing the boolean by hand.

// `const T` (not just `T extends object`) keeps literal types - e.g.
// `category: { kind: "INCOME" }` - from widening to `string` through the
// generic, which Prisma's exact enum-typed `WhereInput` filters reject.
export function excludeInternalTransfers<const T extends object>(where: T): T & { isInternalTransfer: false } {
  return { ...where, isInternalTransfer: false };
}

// TransactionSplit has no isInternalTransfer field of its own - the flag
// lives on its parent Transaction, so this goes through the relation.
// `transactionWhere` is merged in underneath (not replaced) so a caller
// can still filter by date/etc. on the same relation in the same call.
export function excludeInternalTransfersOnSplit<const T extends object, const U extends object>(
  where: T,
  transactionWhere: U = {} as U,
): T & { transaction: U & { isInternalTransfer: false } } {
  return { ...where, transaction: { ...transactionWhere, isInternalTransfer: false } };
}
