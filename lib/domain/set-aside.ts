/**
 * Money set aside (v2.21): what left the current accounts to be kept rather
 * than spent - transfers to a livret, securities bought, transfers to a
 * brokerage or crypto account, and whatever the user files under a SAVINGS
 * category. Budgets left all of it out of its totals (rightly: it is not
 * spending) and showed it nowhere, so a month that put 800 EUR on a livret
 * read exactly like a month that put nothing aside. Pure; the rows come from
 * periodSetAside (lib/services/budget-period.ts).
 *
 * Only legs on a current account count. A transfer has two legs and the
 * livret's own one would count the same money twice; a movement between a
 * livret and a brokerage account, or a share bought from inside the
 * brokerage account, is money already set aside changing place.
 */

import type { AccountType } from "@/app/generated/prisma/enums";

/** Where everyday money sits: what is taken from here and kept is set aside. */
export const CURRENT_ACCOUNT_TYPES: readonly AccountType[] = ["CHECKING", "MEAL_VOUCHER"];

const SAVINGS_TYPES: ReadonlySet<string> = new Set(["SAVINGS"]);
const INVESTMENT_TYPES: ReadonlySet<string> = new Set(["INVESTMENT", "CRYPTO"]);

export type SetAsideTx = {
  /** Signed: a debit is money leaving the current account. */
  amountCents: number;
  isInternalTransfer: boolean;
  isSecuritiesMovement: boolean;
  /** The other leg's account type, when the pair is known and visible. */
  counterpartAccountType: string | null;
  /** Set when the transaction (or split line) is filed under a SAVINGS category. */
  savingsCategoryId: string | null;
};

export type SetAside = {
  /** Net to savings accounts: positive is money put aside, negative taken back. */
  savingsCents: number;
  /** Net to securities, brokerage and crypto accounts, same sign. */
  investmentCents: number;
  /** Net per SAVINGS category, same sign. */
  byCategory: Map<string, number>;
};

/**
 * The rows, already limited to current accounts. The user's own category
 * wins over what the app infers: a share purchase filed under "PEA" is that
 * category's, not the generic investing line's.
 */
export function computeSetAside(rows: readonly SetAsideTx[]): SetAside {
  const result: SetAside = { savingsCents: 0, investmentCents: 0, byCategory: new Map() };
  for (const tx of rows) {
    const kept = -tx.amountCents;
    if (tx.savingsCategoryId !== null) {
      result.byCategory.set(tx.savingsCategoryId, (result.byCategory.get(tx.savingsCategoryId) ?? 0) + kept);
    } else if (tx.isSecuritiesMovement) {
      result.investmentCents += kept;
    } else if (tx.isInternalTransfer && tx.counterpartAccountType !== null) {
      if (SAVINGS_TYPES.has(tx.counterpartAccountType)) result.savingsCents += kept;
      else if (INVESTMENT_TYPES.has(tx.counterpartAccountType)) result.investmentCents += kept;
      // Another current account, a loan, a property: nothing set aside.
    }
    // An internal transfer with no known pair: nowhere to say it went.
  }
  return result;
}

export function totalSetAside(setAside: SetAside): number {
  let total = setAside.savingsCents + setAside.investmentCents;
  for (const cents of setAside.byCategory.values()) total += cents;
  return total;
}
