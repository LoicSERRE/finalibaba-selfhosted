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
 * shape. Every (credit, debit) pair within toleranceDays on two different
 * accounts is a candidate; the assignment between them is an augmenting-path
 * bipartite matching, which pairs up **as many legs as the candidates allow**
 * and prefers the closest dates within that.
 *
 * Two earlier assignments were each wrong in a way the next one fixed, and
 * both are worth keeping in view because the third is not obviously
 * different from the second:
 *
 *   1. "For each credit, take its closest free debit." A credit processed
 *      early - in whatever order the rows happened to be listed, which has
 *      nothing to do with date - could permanently claim a debit that was
 *      only its best local match, while the credit that was that debit's
 *      true same-day counterpart found nothing. Seen in production.
 *   2. "Assign the closest candidate pair overall first, then the next."
 *      That fixes case 1 and still loses legs, because a claim is never
 *      reconsidered. Measured on a real account: a 1200 EUR movement from a
 *      Livret to a current account and on to a broker the next day gives two
 *      credits and two debits and four valid candidate pairs. The
 *      Livret-to-broker pair happens to land on the same day, wins on
 *      closeness, and blocks BOTH real pairings - one pair assigned where
 *      two were available, and the two current-account legs left to count as
 *      ordinary spending and income.
 *
 * Maximising the count is what rules that out: a claim can be handed over
 * whenever the credit holding it has somewhere else to go, so a locally
 * attractive pair can no longer cost two real ones. Closeness still decides
 * between equally valid assignments, it just no longer decides how many
 * there are. Not provably minimum-cost - preferring the nearest option is a
 * heuristic on top of the cardinality guarantee, which is the part that
 * matters here - and the buckets are per exact amount, so they hold a
 * handful of rows at most.
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

// Every credit's candidate debits, closest first, plus the credits
// themselves ordered by how close their own best option is. Both fall out
// of one global sort, so a credit with a same-day counterpart is offered its
// pick before one whose nearest candidate is three days off.
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

// Standard augmenting-path step: give this credit its closest free debit, or
// take one already claimed if the credit holding it can be re-housed
// elsewhere. That "can be re-housed" recursion is the whole difference from
// simply handing out the closest pairs and moving on - it is what lets a
// first claim be reconsidered rather than standing for good.
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
 * Returns the assignment itself - which credit was matched with which
 * debit - not just the ids involved. The caller stores it (Transaction.
 * internalTransferPairId) so a later pass can tell "this row is flagged and
 * I can see why" from "this row is flagged and the evidence is somewhere I
 * cannot look", which is the only safe basis for ever *revoking* a flag.
 *
 * Only ever pairs a credit (positive amountCents) with a debit (negative)
 * of the exact opposite amount on a *different* account - two transactions
 * on the same account can never be a transfer into/out of "another" account
 * of the user's, so same-account matches are never considered even if the
 * amounts happen to cancel out.
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
