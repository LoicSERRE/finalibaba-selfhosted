/**
 * One period of money, line by line (v2.21.1): every transaction and split
 * line the viewer can see goes into exactly one place - income, spending,
 * money set aside, or another movement of the current accounts - so that
 *
 *   change of the current accounts = income - spending - set aside + other
 *
 * holds by construction, not by hope. v2.21 derived "what is left on the
 * current accounts" as income minus spending minus set aside, and had no
 * place for money that is none of the three: a personal loan paid out, a
 * transfer in from a bank the app does not follow, a friend paying back. A
 * month that earned 1 000 EUR, spent 800 and moved 3 000 to a livret, paid
 * for by a 2 500 EUR loan, read "2 800 EUR taken from your current accounts"
 * when they had moved by -300 EUR.
 *
 * Pure; the lines come from loadPeriodLedger (lib/services/budget-period.ts).
 *
 * The rules, in order, for a line on a current account (CHECKING,
 * MEAL_VOUCHER - a broker's cash account is one too):
 *   1. a SAVINGS category: set aside, under that category;
 *   2. a securities movement: set aside, investing;
 *   3. an internal transfer: by where its other leg is - a livret (set aside,
 *      savings), a brokerage or crypto account (set aside, investing), another
 *      current account (between them, nets to zero), a loan account (loan), or
 *      nowhere the viewer can see (another account);
 *   4. anything else: income or spending, by its category - netted per
 *      category, so a refund comes off its category's spending instead of
 *      counting as income. Uncategorized lines go by their sign.
 * A line on a livret, brokerage or crypto account that is counted as income
 * or spending (interest, a fee) stays there: it is set aside too, so the
 * identity above holds. On a loan, property or vehicle account it is counted
 * where it is and bridged in "elsewhere". Transfers and securities movements
 * that never touch a current account are money already set aside changing
 * place: nothing.
 */

import type { SetAside } from "@/lib/domain/set-aside";
import { CURRENT_ACCOUNT_TYPES } from "@/lib/domain/set-aside";

export type CategoryKindName = "EXPENSE" | "INCOME" | "SAVINGS";

export type LedgerLine = {
  /** The transaction's id - a split line carries its parent's. */
  transactionId: string;
  date: Date;
  label: string;
  accountName: string;
  accountType: string;
  /** Signed: a debit is negative. */
  amountCents: number;
  categoryId: string | null;
  isInternalTransfer: boolean;
  isSecuritiesMovement: boolean;
  /** The other leg's account type, when that leg is on an account the viewer can see. */
  counterpartAccountType: string | null;
};

/**
 * Movements of the current accounts that are neither income, spending nor
 * set aside, signed from their side: positive came in.
 */
export type OtherMovements = {
  /** Paid out by, or repaid to, one of the viewer's loan accounts. */
  loanInCents: number;
  loanOutCents: number;
  /** Marked internal, with no other leg the viewer can see: another bank, a relative. */
  untrackedInCents: number;
  untrackedOutCents: number;
  /** Between two current accounts: zero unless a transfer straddles the period's edge. */
  betweenCents: number;
  /** Income and spending booked on a loan, property or vehicle account, which never reached a current account. */
  elsewhereCents: number;
};

export type PeriodLedger = {
  /** Spending per category, net of refunds; null = uncategorized debits. */
  spendMap: Map<string | null, number>;
  /** Income per category, net; null = uncategorized credits. */
  incomeMap: Map<string | null, number>;
  setAside: SetAside;
  other: OtherMovements;
  /** The lines behind `other` (between-current transfers aside: they cancel out), newest first. */
  otherLines: LedgerLine[];
  /** Every current-account line added up. */
  currentChangeCents: number;
  /** Income and spending per calendar month, keyed "YYYY-MM" (UTC). */
  byMonth: Map<string, { incomeCents: number; expenseCents: number }>;
};

const CURRENT: ReadonlySet<string> = new Set(CURRENT_ACCOUNT_TYPES);
const SAVINGS_TYPES: ReadonlySet<string> = new Set(["SAVINGS"]);
const INVESTMENT_TYPES: ReadonlySet<string> = new Set(["INVESTMENT", "CRYPTO"]);
const LOAN_TYPES: ReadonlySet<string> = new Set(["LOAN"]);

export const NO_OTHER: Readonly<OtherMovements> = {
  loanInCents: 0,
  loanOutCents: 0,
  untrackedInCents: 0,
  untrackedOutCents: 0,
  betweenCents: 0,
  elsewhereCents: 0,
};

export function totalOther(other: OtherMovements): number {
  return other.loanInCents + other.loanOutCents + other.untrackedInCents + other.untrackedOutCents + other.betweenCents + other.elsewhereCents;
}

const add = <K>(map: Map<K, number>, key: K, cents: number) => map.set(key, (map.get(key) ?? 0) + cents);

const monthKey = (date: Date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;

/** Where one line goes - decided apart from adding it up, so each rule reads on its own. */
type Place =
  | { to: "none" }
  | { to: "budget" }
  /** Income or spending booked off the current accounts, which stays where it was booked. */
  | { to: "budgetOff"; pocket: "savings" | "investment" | "elsewhere" }
  | { to: "setAside"; pocket: "savings" | "investment" }
  | { to: "savingsCategory" }
  | { to: "other"; key: keyof OtherMovements };

function placeOffCurrent(line: LedgerLine, kind: CategoryKindName | null): Place {
  if (line.isInternalTransfer || line.isSecuritiesMovement || kind === "SAVINGS") return { to: "none" };
  if (SAVINGS_TYPES.has(line.accountType)) return { to: "budgetOff", pocket: "savings" };
  if (INVESTMENT_TYPES.has(line.accountType)) return { to: "budgetOff", pocket: "investment" };
  return { to: "budgetOff", pocket: "elsewhere" };
}

/** An internal transfer, by its other leg's account. */
function placeTransfer(line: LedgerLine): Place {
  const there = line.counterpartAccountType ?? "";
  if (SAVINGS_TYPES.has(there)) return { to: "setAside", pocket: "savings" };
  if (INVESTMENT_TYPES.has(there)) return { to: "setAside", pocket: "investment" };
  if (CURRENT.has(there)) return { to: "other", key: "betweenCents" };
  const incoming = line.amountCents > 0;
  if (LOAN_TYPES.has(there)) return { to: "other", key: incoming ? "loanInCents" : "loanOutCents" };
  return { to: "other", key: incoming ? "untrackedInCents" : "untrackedOutCents" };
}

function placeOnCurrent(line: LedgerLine, kind: CategoryKindName | null): Place {
  if (kind === "SAVINGS") return { to: "savingsCategory" };
  if (line.isSecuritiesMovement) return { to: "setAside", pocket: "investment" };
  if (line.isInternalTransfer) return placeTransfer(line);
  return { to: "budget" };
}

function addBudget(ledger: PeriodLedger, line: LedgerLine, kind: CategoryKindName | null) {
  const cents = line.amountCents;
  const id = kind === null ? null : line.categoryId;
  const key = monthKey(line.date);
  const month = ledger.byMonth.get(key) ?? { incomeCents: 0, expenseCents: 0 };
  if (kind === "INCOME" || (kind === null && cents > 0)) {
    add(ledger.incomeMap, id, cents);
    month.incomeCents += cents;
  } else {
    add(ledger.spendMap, id, -cents);
    month.expenseCents -= cents;
  }
  ledger.byMonth.set(key, month);
}

/** `cents` from the current accounts' side. */
function addOther(ledger: PeriodLedger, line: LedgerLine, key: keyof OtherMovements, cents: number) {
  ledger.other[key] += cents;
  if (key !== "betweenCents") ledger.otherLines.push(line);
}

function addSetAside(setAside: SetAside, pocket: "savings" | "investment", cents: number) {
  if (pocket === "savings") setAside.savingsCents += cents;
  else setAside.investmentCents += cents;
}

function apply(ledger: PeriodLedger, line: LedgerLine, kind: CategoryKindName | null, place: Place) {
  // What a debit on a current account keeps.
  const kept = -line.amountCents;
  switch (place.to) {
    case "none":
      return;
    case "budget":
      addBudget(ledger, line, kind);
      return;
    case "budgetOff":
      addBudget(ledger, line, kind);
      // Kept where it is - or, on a loan, property or vehicle account,
      // bridged back: it never reached a current account.
      if (place.pocket === "elsewhere") addOther(ledger, line, "elsewhereCents", kept);
      else addSetAside(ledger.setAside, place.pocket, line.amountCents);
      return;
    case "setAside":
      addSetAside(ledger.setAside, place.pocket, kept);
      return;
    case "savingsCategory":
      add(ledger.setAside.byCategory, line.categoryId!, kept);
      return;
    case "other":
      addOther(ledger, line, place.key, line.amountCents);
  }
}

/**
 * `categoryKinds`: the viewer's own categories. A category id that is not
 * among them - a co-owner's, on a joint account - counts as uncategorized:
 * its name and kind are not the viewer's to read.
 */
export function partitionPeriod(lines: readonly LedgerLine[], categoryKinds: ReadonlyMap<string, CategoryKindName>): PeriodLedger {
  const ledger: PeriodLedger = {
    spendMap: new Map(),
    incomeMap: new Map(),
    setAside: { savingsCents: 0, investmentCents: 0, byCategory: new Map() },
    other: { ...NO_OTHER },
    otherLines: [],
    currentChangeCents: 0,
    byMonth: new Map(),
  };
  for (const line of lines) {
    const kind = (line.categoryId === null ? undefined : categoryKinds.get(line.categoryId)) ?? null;
    const current = CURRENT.has(line.accountType);
    if (current) ledger.currentChangeCents += line.amountCents;
    apply(ledger, line, kind, current ? placeOnCurrent(line, kind) : placeOffCurrent(line, kind));
  }
  ledger.otherLines.sort((a, b) => b.date.getTime() - a.date.getTime());
  return ledger;
}
