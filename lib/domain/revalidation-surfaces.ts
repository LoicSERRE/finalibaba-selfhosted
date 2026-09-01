/**
 * Which pages render which entity - the input to every revalidatePath call.
 *
 * **What actually makes a screen update, measured rather than assumed.** Three
 * experiments against a production build (`next start`), each one a real
 * category assignment on /transactions filtered to uncategorised rows, so the
 * server-rendered row count is the evidence and not a DOM value the browser
 * could be holding on its own:
 *
 *   1. every path revalidated, including the one on screen -> refreshes
 *   2. the path on screen deliberately REMOVED from the list -> still refreshes
 *   3. revalidatePath stubbed out entirely -> stays stale
 *
 * So the rule for this app is: **a mutating action must revalidate something,
 * and which path it names does not decide what you are looking at.** Any
 * revalidation makes the router refresh the current route.
 *
 * This is narrower than revalidatePath's own documentation suggests ("Updates
 * the UI immediately (if viewing the affected path)"), and the reason is local
 * to this codebase: every page is `force-dynamic`, so there is no Full Route
 * Cache for a path to purge, and Next's default `staleTimes.dynamic` of 0
 * means other routes refetch on navigation whether or not they were named.
 * Experiment 3 confirmed that too - with nothing revalidated at all,
 * navigating from /transactions to /budgets still showed the new figure.
 *
 * That is why this module exists and also why it stays modest. The lists below
 * are honest documentation of what shows what, and they cost one call instead
 * of five per action - but the load-bearing part is that **every mutation
 * calls one of these at all**. `__tests__/revalidation-surfaces.test.ts`
 * enforces exactly that, and checks each path is a real route so a renamed
 * page cannot leave a dead entry behind.
 *
 * Adding a page? Add it to the surfaces that render its data. That is the
 * whole maintenance burden, and it is now in one file instead of 27.
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
