/**
 * Detects internal transfers (money moving between two of the same user's
 * own accounts) independently of the transaction label - a real gap found
 * in production: a French bank's generic transfer label ("VIREMENT SEPA")
 * is reused both for real internal transfers and for real external
 * payments (a salary, a benefit) with no textual way to tell them apart,
 * and the bank doesn't always attach a counterparty name either (checked
 * against a real account's data - it does for some transfers and not
 * others, no reliable pattern). Label text can't solve this; the amount
 * itself can - a transfer between two of the user's own accounts always
 * produces a matching debit on one account and credit on the other, for
 * the exact same amount, within a day or two of each other. This is a
 * single-user app (see CLAUDE.md's v2.0 multi-user note), so every account
 * in the database belongs to the same person - any such matching pair is
 * safe to treat as an internal transfer without further evidence.
 *
 * Pure function, no DB calls - mirrors lib/domain/auto-categorize.ts's
 * shape. Greedy nearest-date matching: for each credit, the closest
 * unclaimed opposite-amount debit on a different account within
 * toleranceDays wins - not a globally-optimal matching, but a personal
 * finance account rarely has more than one same-day, same-amount transfer
 * candidate to disambiguate between, so this is a deliberate simplicity
 * tradeoff over a more complex assignment algorithm.
 */

export type TransferCandidate = {
  id: string;
  accountId: string;
  amountCents: bigint;
  date: Date;
};

const DEFAULT_TOLERANCE_DAYS = 3;

// Groups every debit (negative amountCents) by its absolute amount, so a
// credit only ever scans its own amount bucket instead of every debit in
// the whole candidate set. Kept separate from detectInternalTransferPairs
// below to stay under the sonarjs cognitive-complexity gate.
function groupDebitsByAbsAmount(transactions: TransferCandidate[]): Map<string, TransferCandidate[]> {
  const debitsByAbsAmount = new Map<string, TransferCandidate[]>();
  for (const tx of transactions) {
    if (tx.amountCents >= BigInt(0)) continue;
    const key = (-tx.amountCents).toString();
    const bucket = debitsByAbsAmount.get(key);
    if (bucket) bucket.push(tx);
    else debitsByAbsAmount.set(key, [tx]);
  }
  return debitsByAbsAmount;
}

// Picks the closest-dated unclaimed debit (different account, within
// toleranceMs) for one credit - null if none qualifies. Same
// complexity-budget reason as the function above.
function findClosestDebit(
  credit: TransferCandidate,
  candidates: TransferCandidate[],
  usedDebitIds: Set<string>,
  toleranceMs: number
): TransferCandidate | null {
  let best: TransferCandidate | null = null;
  let bestDiffMs = Infinity;
  for (const debit of candidates) {
    if (usedDebitIds.has(debit.id)) continue;
    if (debit.accountId === credit.accountId) continue;
    const diffMs = Math.abs(credit.date.getTime() - debit.date.getTime());
    if (diffMs > toleranceMs) continue;
    if (diffMs < bestDiffMs) {
      best = debit;
      bestDiffMs = diffMs;
    }
  }
  return best;
}

/**
 * Returns the set of transaction ids that are one half of a detected
 * internal-transfer pair. Only ever pairs a credit (positive amountCents)
 * with a debit (negative) of the exact opposite amount on a *different*
 * account - two transactions on the same account can never be a transfer
 * into/out of "another" account of the user's, so same-account matches are
 * never considered even if the amounts happen to cancel out.
 */
export function detectInternalTransferPairs(
  transactions: TransferCandidate[],
  toleranceDays: number = DEFAULT_TOLERANCE_DAYS
): Set<string> {
  const toleranceMs = toleranceDays * 24 * 60 * 60 * 1000;
  const matched = new Set<string>();
  const debitsByAbsAmount = groupDebitsByAbsAmount(transactions);
  const usedDebitIds = new Set<string>();

  for (const credit of transactions) {
    if (credit.amountCents <= BigInt(0)) continue;
    const candidates = debitsByAbsAmount.get(credit.amountCents.toString());
    if (!candidates) continue;

    const best = findClosestDebit(credit, candidates, usedDebitIds, toleranceMs);
    if (best) {
      matched.add(credit.id);
      matched.add(best.id);
      usedDebitIds.add(best.id);
    }
  }

  return matched;
}
