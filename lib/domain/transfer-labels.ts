/**
 * Bank boilerplate that means nothing on its own.
 *
 * A bank reuses "VIREMENT SEPA" for a transfer between your own accounts AND
 * for an unrelated salary-sized credit, with no reliable way to tell which
 * from the text. So this label must never be treated as identifying anything:
 * it gates self-learning, "apply to similar", "mark as income", and - since
 * v2.10.5 - the relaxed amount test in recurring detection.
 *
 * Its own module rather than living beside one of those consumers: it now has
 * four, on both sides of an import that would otherwise be a cycle
 * (auto-categorize.ts already reads normalizeLabel from recurring.ts). The
 * alternative was a second copy of the list, which is exactly how
 * infer_account_type's two copies drifted apart before a user reported it.
 */
const GENERIC_TRANSFER_LABELS = new Set(["virement sepa", "virement instantane"]);

/** `normalize` is the caller's own normaliser - the two in this codebase agree
 *  on these entries (neither carries a trailing year), and passing it in is
 *  what keeps this module dependency-free. */
export function isGenericTransferLabelNormalized(normalizedLabel: string): boolean {
  return GENERIC_TRANSFER_LABELS.has(normalizedLabel);
}
