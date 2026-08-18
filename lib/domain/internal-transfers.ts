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
 * shape. Global-priority matching: every (credit, debit) pair within
 * toleranceDays is a candidate, and the closest-dated pair overall is
 * assigned first, then the next-closest among what's left, and so on.
 *
 * Not the same as "for each credit, grab its own closest available debit" -
 * that earlier approach let a credit processed early (in whatever order the
 * transactions happen to be listed, which has no relationship to date)
 * permanently claim a debit that only looked like its best local match,
 * even when a *different*, later-processed credit was actually the true
 * same-day counterpart for that debit. Found in production: a same-day,
 * same-amount, cross-account pair (an obvious real transfer) went
 * unmatched because an unrelated same-amount credit a few days off had
 * already consumed the one true debit first. Global-priority ordering
 * fixes this specific failure mode - the exact-date pair always outranks
 * a looser one and gets assigned before the looser pair even gets a
 * chance to compete for the same debit. Still not a provably-optimal
 * assignment for every conceivable case, but a personal finance account
 * rarely has more than a couple of same-amount candidates to disambiguate
 * between, so this remains a deliberate simplicity tradeoff over a full
 * min-cost matching algorithm.
 */

export type TransferCandidate = {
  id: string;
  accountId: string;
  amountCents: bigint;
  date: Date;
};

const DEFAULT_TOLERANCE_DAYS = 3;

type CandidatePair = { creditId: string; debitId: string; diffMs: number };

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

// Every (credit, debit) pair within tolerance, on different accounts,
// regardless of whether either side is already "used" - assignment happens
// afterward, once every candidate pair is known and sorted by closeness.
// Same complexity-budget reason as the function above.
function buildCandidatePairs(
  transactions: TransferCandidate[],
  debitsByAbsAmount: Map<string, TransferCandidate[]>,
  toleranceMs: number
): CandidatePair[] {
  const pairs: CandidatePair[] = [];
  for (const credit of transactions) {
    if (credit.amountCents <= BigInt(0)) continue;
    const candidates = debitsByAbsAmount.get(credit.amountCents.toString());
    if (!candidates) continue;
    for (const debit of candidates) {
      if (debit.accountId === credit.accountId) continue;
      const diffMs = Math.abs(credit.date.getTime() - debit.date.getTime());
      if (diffMs > toleranceMs) continue;
      pairs.push({ creditId: credit.id, debitId: debit.id, diffMs });
    }
  }
  return pairs;
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
  const debitsByAbsAmount = groupDebitsByAbsAmount(transactions);
  const pairs = buildCandidatePairs(transactions, debitsByAbsAmount, toleranceMs);
  pairs.sort((a, b) => a.diffMs - b.diffMs);

  const matched = new Set<string>();
  const usedCreditIds = new Set<string>();
  const usedDebitIds = new Set<string>();
  for (const pair of pairs) {
    if (usedCreditIds.has(pair.creditId) || usedDebitIds.has(pair.debitId)) continue;
    usedCreditIds.add(pair.creditId);
    usedDebitIds.add(pair.debitId);
    matched.add(pair.creditId);
    matched.add(pair.debitId);
  }

  return matched;
}
