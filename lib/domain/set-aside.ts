/**
 * Money set aside (v2.21): what left the current accounts to be kept rather
 * than spent - transfers to a livret, securities bought, transfers to a
 * brokerage or crypto account, and whatever the user files under a SAVINGS
 * category. Budgets left all of it out of its totals (rightly: it is not
 * spending) and showed it nowhere, so a month that put 800 EUR on a livret
 * read exactly like a month that put nothing aside.
 *
 * Only legs on a current account count. A transfer has two legs and the
 * livret's own one would count the same money twice; a movement between a
 * livret and a brokerage account, or a share bought from inside the
 * brokerage account, is money already set aside changing place. The rules
 * themselves live with every other line of the period, in
 * lib/domain/period-ledger.ts (v2.21.1).
 */

import type { AccountType } from "@/app/generated/prisma/enums";

/** Where everyday money sits: what is taken from here and kept is set aside. */
export const CURRENT_ACCOUNT_TYPES: readonly AccountType[] = ["CHECKING", "MEAL_VOUCHER"];

export type SetAside = {
  /** Net to savings accounts: positive is money put aside, negative taken back. */
  savingsCents: number;
  /** Net to securities, brokerage and crypto accounts, same sign. */
  investmentCents: number;
  /** Net per SAVINGS category, same sign. */
  byCategory: Map<string, number>;
};

export function totalSetAside(setAside: SetAside): number {
  let total = setAside.savingsCents + setAside.investmentCents;
  for (const cents of setAside.byCategory.values()) total += cents;
  return total;
}
