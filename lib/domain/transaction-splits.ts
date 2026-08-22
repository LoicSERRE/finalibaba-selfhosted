// Pure validation for splitting one transaction across multiple categories -
// no I/O. The actual DB write (and enforcing that categoryId gets nulled
// on the parent transaction) lives in lib/actions/transaction-splits.ts,
// per this project's lib/domain-has-no-DB-calls convention.

export const MIN_SPLIT_LINES = 2;

export interface SplitLineInput {
  categoryId: string | null;
  amountCents: bigint;
}

export interface SplitValidationResult {
  valid: boolean;
  // Only set when invalid - "too_few_lines" | "does_not_sum_to_total" |
  // "zero_amount_line". A UI can map each to its own translated message;
  // this function itself carries no user-facing strings.
  error?: "too_few_lines" | "does_not_sum_to_total" | "zero_amount_line";
}

// A split with a 0-cent line is never useful (it can't represent any real
// portion of the purchase) and would silently let a user "add" an empty
// line and save without noticing - rejected up front rather than allowed
// through as a harmless no-op.
export function validateSplitLines(lines: SplitLineInput[], transactionAmountCents: bigint): SplitValidationResult {
  if (lines.length < MIN_SPLIT_LINES) return { valid: false, error: "too_few_lines" };
  if (lines.some((l) => l.amountCents === BigInt(0))) return { valid: false, error: "zero_amount_line" };
  const sum = lines.reduce((total, l) => total + l.amountCents, BigInt(0));
  if (sum !== transactionAmountCents) return { valid: false, error: "does_not_sum_to_total" };
  return { valid: true };
}
