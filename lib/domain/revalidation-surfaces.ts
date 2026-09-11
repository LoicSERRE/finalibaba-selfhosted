/**
 * Which pages render which entity - the input to every revalidatePath call.
 *
 * Measured, because the obvious reading is wrong here: **a mutating action must
 * revalidate something, and which path it names does not decide what you are
 * looking at.** Three experiments against a production build settled it -
 * naming the on-screen path refreshes, omitting it still refreshes, stubbing
 * revalidatePath out entirely leaves it stale. Local cause: every page is
 * `force-dynamic`, so there is no Full Route Cache to purge.
 *
 * So the load-bearing part of this module is not the lists, it is that **every
 * mutation calls one of these at all** - which
 * `__tests__/revalidation-surfaces.test.ts` enforces, along with each path
 * being a real route.
 */
/** Every route that shows account balances, values or net worth. */
const ACCOUNT_VALUE_SURFACES = ["/", "/accounts", "/analytics"] as const;

/**
 * Every route that shows transactions or anything derived from them.
 * /recurring is included because its suggestions are detected from
 * transaction history, and /income because its "Autres revenus" totals are.
 */
const TRANSACTION_SURFACES = ["/", "/accounts", "/budgets", "/income", "/transactions", "/recurring"] as const;

/** Every route that lists or groups by category. */
const CATEGORY_SURFACES = ["/accounts", "/budgets", "/income", "/transactions", "/settings"] as const;

/** Every route showing the fiscal year: realised gains and declared income. */
const TAX_SURFACES = ["/analytics", "/income", "/tax-report"] as const;

function withAccount(paths: readonly string[], accountId?: string | null): string[] {
  return accountId ? [...paths, `/accounts/${accountId}`] : [...paths];
}

/**
 * An account's existence, name or value changed.
 *
 * Includes /settings, which the old lists did not: it renders each
 * institution's account count, its migration counts, and the account pickers
 * behind alert rules and goals.
 */
export function accountSurfaces(accountId?: string | null): string[] {
  return withAccount([...ACCOUNT_VALUE_SURFACES, "/transactions", "/tax-report", "/settings"], accountId);
}

/** A holding, its price, its target weight or a balance snapshot changed. */
export function holdingSurfaces(accountId?: string | null): string[] {
  // /settings renders the holding pickers for the HOLDING_PRICE and
  // REBALANCING_DRIFT alert rules, which show holding names.
  return withAccount([...ACCOUNT_VALUE_SURFACES, "/settings"], accountId);
}

/** Transactions were created, deleted, categorised or split. */
export function transactionSurfaces(
  accountId?: string | null,
  categoryIds: readonly (string | null | undefined)[] = [],
): string[] {
  const drilldowns = categoryIds.filter((id): id is string => !!id).map((id) => `/budgets/${id}`);
  return [...withAccount(TRANSACTION_SURFACES, accountId), ...drilldowns];
}

/** A category was created, renamed, re-budgeted or deleted. */
export function categorySurfaces(categoryId?: string | null): string[] {
  return categoryId ? [...CATEGORY_SURFACES, `/budgets/${categoryId}`] : [...CATEGORY_SURFACES];
}

/** A dividend or interest payment was recorded, edited or deleted. */
export function incomeSurfaces(accountId?: string | null): string[] {
  return withAccount(TAX_SURFACES, accountId);
}

/** A disposal was recorded or deleted. */
export function saleSurfaces(accountId?: string | null): string[] {
  return withAccount([...ACCOUNT_VALUE_SURFACES, "/tax-report", "/settings"], accountId);
}
