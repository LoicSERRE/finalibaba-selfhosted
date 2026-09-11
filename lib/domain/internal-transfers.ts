/**
 * Detects internal transfers - money moving between two of the user's own
 * accounts - from amount and date alone, never from the label: a bank reuses
 * the same generic wording ("VIREMENT SEPA") for a transfer and for a real
 * external payment. See CLAUDE.md's "Internal transfer detection".
 *
 * Pure, no DB calls. The assignment is an augmenting-path bipartite matching:
 * it pairs up as many legs as the candidates allow, and prefers the closest
 * dates within that. Maximising the count is the load-bearing part - assigning
 * the closest pair first and never reconsidering it loses real pairs, which is
 * how the two earlier designs failed.
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

// Every credit's candidate debits, closest first, and the credits ordered by
// how close their own best option is - both fall out of one global sort.
function buildAdjacency(pairs: CandidatePair[]): { order: string[]; adjacency: Map<string, string[]> } {
  pairs.sort((a, b) => a.diffMs - b.diffMs);
  const adjacency = new Map<string, string[]>();
  const order: string[] = [];
  for (const pair of pairs) {
    const existing = adjacency.get(pair.creditId);
    if (existing) existing.push(pair.debitId);
    else {
      adjacency.set(pair.creditId, [pair.debitId]);
      order.push(pair.creditId);
    }
  }
  return { order, adjacency };
}

// Give this credit its closest free debit, or take a claimed one if the credit
// holding it can be re-housed. That recursion is what lets a first claim be
// reconsidered instead of standing for good.
function augment(
  creditId: string,
  adjacency: Map<string, string[]>,
  creditByDebit: Map<string, string>,
  visited: Set<string>
): boolean {
  for (const debitId of adjacency.get(creditId) ?? []) {
    if (visited.has(debitId)) continue;
    visited.add(debitId);
    const holder = creditByDebit.get(debitId);
    if (holder === undefined || augment(holder, adjacency, creditByDebit, visited)) {
      creditByDebit.set(debitId, creditId);
      return true;
    }
  }
  return false;
}

/**
 * Which credit was matched with which debit, not just the ids involved. The
 * caller stores the pairing (Transaction.internalTransferPairId) - without it
 * a later pass cannot tell a flag it can revoke from one whose evidence sits
 * on an account it cannot see.
 *
 * Only ever pairs a credit with a debit of the exact opposite amount on a
 * DIFFERENT account: two rows on one account can never be a transfer to
 * another account, however well their amounts cancel out.
 */
export function detectInternalTransferPairings(
  transactions: TransferCandidate[],
  toleranceDays: number = DEFAULT_TOLERANCE_DAYS
): Array<{ creditId: string; debitId: string }> {
  const toleranceMs = toleranceDays * 24 * 60 * 60 * 1000;
  const debitsByAbsAmount = groupDebitsByAbsAmount(transactions);
  const pairs = buildCandidatePairs(transactions, debitsByAbsAmount, toleranceMs);
  const { order, adjacency } = buildAdjacency(pairs);

  const creditByDebit = new Map<string, string>();
  for (const creditId of order) augment(creditId, adjacency, creditByDebit, new Set());

  return [...creditByDebit].map(([debitId, creditId]) => ({ creditId, debitId }));
}
