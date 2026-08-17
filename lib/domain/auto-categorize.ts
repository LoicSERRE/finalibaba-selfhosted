/**
 * Self-learns a normalizeLabel(label) -> categoryId mapping from the user's
 * own already-categorized transaction history, then suggests that category
 * for uncategorized transactions whose label matches confidently. Pure
 * function, no DB calls - mirrors lib/domain/recurring.ts's shape.
 *
 * Deliberately not a hardcoded merchant/category dictionary - Category
 * names and countries are entirely user-defined in this app (see "Tax
 * treatment"'s country-agnostic precedent), so there's no fixed vocabulary
 * to match a merchant name against. The only reliable signal is "this exact
 * label pattern was already categorized this way before" - this also
 * covers salary, dividends, and interest for free: they're not detected as
 * a special case, they're just another label the user categorizes once
 * (into "Salaire"/"Dividendes"/whatever they call it) and this engine
 * recognizes on every future occurrence, same as any merchant.
 *
 * Scoped per-account (accountId is part of the grouping key, same as
 * detectCandidates in recurring.ts) rather than across every account -
 * label is raw bank-feed text specific to one institution's formatting, so
 * matching similar-looking labels across two different accounts risks a
 * false merge, exactly the reasoning recurring-transaction detection
 * already applies to the identical (accountId, normalizeLabel(label)) key
 * shape.
 */
import { normalizeLabel } from "@/lib/domain/recurring";

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

function groupKey(accountId: string, label: string): string {
  return `${accountId}|${normalizeLabel(label)}`;
}

function countCategoriesByGroup(history: CategorizedSample[]): Map<string, Map<string, number>> {
  const countsByGroup = new Map<string, Map<string, number>>();
  for (const h of history) {
    const key = groupKey(h.accountId, h.label);
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
    const categoryId = confidentCategoryByGroup.get(groupKey(tx.accountId, tx.label));
    if (categoryId) suggestions.set(tx.id, categoryId);
  }
  return suggestions;
}
