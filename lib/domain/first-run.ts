/**
 * The first-run checklist (v2.17): the steps that make the app useful, each
 * ticked off by real data rather than by a "done" button, so it can never
 * claim something that is not true. Pure.
 */

export type FirstRunFacts = {
  accounts: number;
  /** Accounts a sync keeps up to date (Woob, Trade Republic, GoCardless). */
  syncedAccounts: number;
  /** A tax country chosen or an income entered in the financial profile. */
  profileSet: boolean;
  categories: number;
  goals: number;
};

export type FirstRunStepId = "account" | "bank" | "profile" | "categories" | "goal";

export type FirstRunStep = { id: FirstRunStepId; done: boolean; optional: boolean; href: string };

/** Hides the checklist on this device; the steps stay ticked by data either way. */
export const FIRST_RUN_COOKIE = "FIRST_RUN_HIDDEN";

export function firstRunSteps(facts: FirstRunFacts): FirstRunStep[] {
  return [
    { id: "account", done: facts.accounts > 0, optional: false, href: "/accounts" },
    // Optional: the app is fully usable with manual accounts and CSV imports.
    { id: "bank", done: facts.syncedAccounts > 0, optional: true, href: "/settings?tab=accounts" },
    { id: "profile", done: facts.profileSet, optional: false, href: "/settings?tab=profile" },
    { id: "categories", done: facts.categories > 0, optional: false, href: "/budgets" },
    { id: "goal", done: facts.goals > 0, optional: false, href: "/settings?tab=profile" },
  ];
}

/** Every required step done - optional ones never hold the checklist open. */
export function firstRunComplete(steps: readonly FirstRunStep[]): boolean {
  return steps.every((step) => step.done || step.optional);
}

/**
 * Where the checklist goes, if anywhere: "full" in place of the empty
 * dashboard when there is no account yet (hiding does not apply - it is the
 * only thing on the page), "compact" above a dashboard with data until the
 * required steps are done or it is hidden, never both. Null steps mean the
 * viewer is looking at someone else's portfolio.
 */
export function checklistVariant(steps: readonly FirstRunStep[] | null, hasAccounts: boolean, hidden: boolean): "full" | "compact" | null {
  if (steps === null) return null;
  if (!hasAccounts) return "full";
  return firstRunComplete(steps) || hidden ? null : "compact";
}
