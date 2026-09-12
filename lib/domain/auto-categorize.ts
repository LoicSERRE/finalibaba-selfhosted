/**
 * Self-learns a normalizeLabelForCategorization(label) -> categoryId mapping
 * from the user's own categorised history, then suggests that category for
 * matching uncategorised rows. Pure, no DB calls.
 *
 * Deliberately not a hardcoded merchant dictionary: category names are
 * user-defined, so there is no fixed vocabulary to match against. "This exact
 * label was categorised this way before" also covers salary, dividends and
 * interest for free - they are not special cases, just labels.
 *
 * Scoped per-account, because a label is raw bank-feed text specific to one
 * institution's formatting.
 */import { normalizeLabel } from "@/lib/domain/recurring";
import { isGenericTransferLabelNormalized } from "@/lib/domain/transfer-labels";

/**
 * A looser variant of normalizeLabel, used only for the grouping key below
 * (and by the "apply to similar transactions" correction feature in
 * lib/actions/transactions.ts, and "mark as income" propagation in
 * lib/actions/income.ts) - not recurring-transaction detection, which keeps
 * its own separately-tuned normalizeLabel untouched. Strips a trailing
 * year-like suffix after the base normalization, so a label whose only
 * year-to-year variation is the year itself still groups as the same label
 * - a real gap found in production: French Livret interest is credited
 * once a year with a label like "INTERETS 2025"/"INTERETS 26" (banks vary
 * between 4-digit and 2-digit year suffixes, and between institutions the
 * whole prefix varies too - "INTERETS LEP" for a LEP account vs "INTERETS"
 * for a Livret A - which is fine, those genuinely are different accounts
 * and stay correctly separate), so two occurrences of the *exact same*
 * label would otherwise never accumulate (self-learning's
 * MIN_HISTORY_OCCURRENCES could never be reached - by the time a second
 * interest credit lands, a full year has passed and the label has already
 * changed).
 *
 * Only a TRAILING token is stripped, never a 2-digit number anywhere in the
 * label, which would also eat "MCDONALD'S PARIS 15".
 */
export function normalizeLabelForCategorization(label: string): string {
  // Whitespace collapsed BEFORE the strip, so the strip anchors on a literal
  // space: `\s+` before a quantified group is the super-linear-backtracking
  // shape sonarjs flags.
  const collapsed = normalizeLabel(label).replace(/\s+/g, " ");
  return collapsed.replace(/ \d{2}(\d{2})?$/, "").trim();
}

/**
 * Bank boilerplate reused for BOTH real transfers and real external payments,
 * with nothing in the text to separate them - a bank attaches a counterparty
 * name to some transfers and not others. Never a trustworthy group for
 * self-learning or propagation: one salary row once put every "VIREMENT SEPA"
 * in the account under the same category, transfers included.
 *
 * lib/domain/internal-transfers.ts is the real fix for the transfer half; this
 * set only stops the same mistake for whatever ELSE a generic label means.
 */

export function isGenericTransferLabel(label: string): boolean {
  return isGenericTransferLabelNormalized(normalizeLabelForCategorization(label));
}

// A label needs at least this many prior categorized occurrences before
// its majority category is trusted enough to auto-apply going forward - a
// single manually-corrected mistake shouldn't immediately start
// auto-propagating. Lower than recurring detection's MIN_OCCURRENCES (3):
// this is about label-consistency confidence, not time-pattern confidence,
// and a merchant appearing only twice with the same category both times is
// already a real signal.
export const MIN_HISTORY_OCCURRENCES = 2;

// The majority category must clear this share of the label's history, not
// just be the single most common one out of a scattered mix - avoids
// auto-applying a category that only "won" 2 out of 5 categorizations.
export const MIN_CONSISTENCY_RATIO = 0.7;

export type CategorizedSample = { accountId: string; label: string; categoryId: string };
export type UncategorizedTransaction = { id: string; accountId: string; label: string };

// null for a generic label (see GENERIC_TRANSFER_LABELS above) - callers
// must skip it, never fall back to grouping by accountId alone.
function groupKey(accountId: string, label: string): string | null {
  if (isGenericTransferLabel(label)) return null;
  return `${accountId}|${normalizeLabelForCategorization(label)}`;
}

function countCategoriesByGroup(history: CategorizedSample[]): Map<string, Map<string, number>> {
  const countsByGroup = new Map<string, Map<string, number>>();
  for (const h of history) {
    const key = groupKey(h.accountId, h.label);
    if (!key) continue;
    let counts = countsByGroup.get(key);
    if (!counts) {
      counts = new Map();
      countsByGroup.set(key, counts);
    }
    counts.set(h.categoryId, (counts.get(h.categoryId) ?? 0) + 1);
  }
  return countsByGroup;
}

// Picks the majority categoryId for one group, but only when it clears
// both MIN_HISTORY_OCCURRENCES and MIN_CONSISTENCY_RATIO - returns null
// otherwise, kept separate from countCategoriesByGroup above so
// suggestCategoryAssignments stays under the sonarjs cognitive-complexity
// gate.
function confidentMajority(counts: Map<string, number>): string | null {
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  if (total < MIN_HISTORY_OCCURRENCES) return null;

  let bestCategoryId: string | null = null;
  let bestCount = 0;
  for (const [categoryId, count] of counts) {
    if (count > bestCount) {
      bestCategoryId = categoryId;
      bestCount = count;
    }
  }
  return bestCategoryId && bestCount / total >= MIN_CONSISTENCY_RATIO ? bestCategoryId : null;
}

/**
 * Returns a Map of transaction id -> suggested categoryId, one entry per
 * uncategorized transaction whose (account, label) history clears both
 * confidence thresholds above. Transactions with no confident match (new
 * merchant, or an inconsistent history) are simply absent from the result -
 * exactly the "leave the rest for the user" behavior this feature is for.
 */
export function suggestCategoryAssignments(
  uncategorized: UncategorizedTransaction[],
  history: CategorizedSample[]
): Map<string, string> {
  const countsByGroup = countCategoriesByGroup(history);

  const confidentCategoryByGroup = new Map<string, string>();
  for (const [key, counts] of countsByGroup) {
    const categoryId = confidentMajority(counts);
    if (categoryId) confidentCategoryByGroup.set(key, categoryId);
  }

  const suggestions = new Map<string, string>();
  for (const tx of uncategorized) {
    const key = groupKey(tx.accountId, tx.label);
    if (!key) continue;
    const categoryId = confidentCategoryByGroup.get(key);
    if (categoryId) suggestions.set(tx.id, categoryId);
  }
  return suggestions;
}
