"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { suggestCategoryAssignments } from "@/lib/domain/auto-categorize";
import { matchMerchantCategory, MERCHANT_CATEGORY_COLORS } from "@/lib/domain/merchant-categories";
import { matchMccCategory, MCC_CATEGORY_COLORS } from "@/lib/domain/mcc-categories";

type UncategorizedTx = { id: string; accountId: string; label: string; merchantCategoryCode: string | null };

const TEXT_DICTIONARY_COLORS = new Map(Object.entries(MERCHANT_CATEGORY_COLORS));

// Resolves category NAMES (from either default-category source below) to
// real Category ids, creating any that don't exist yet - the one place
// auto-categorization creates a Category rather than only assigning an
// existing one, exactly so a brand new user with zero categories still
// gets somewhere useful for a well-known merchant or MCC to land. Takes an
// explicit name->color map rather than picking a source itself, so it's
// reusable for both the text dictionary and the MCC map without knowing
// which one called it. Kept separate from autoCategorizeTransactions below
// to stay under the sonarjs cognitive-complexity gate.
async function resolveDefaultCategoryIds(names: string[], colorByName: Map<string, string>): Promise<Map<string, string>> {
  const categoryIdByName = new Map<string, string>();
  if (names.length === 0) return categoryIdByName;

  const existing = await prisma.category.findMany({
    where: { name: { in: names } },
    select: { id: true, name: true },
  });
  for (const c of existing) categoryIdByName.set(c.name, c.id);

  const missingNames = names.filter((n) => !categoryIdByName.has(n));
  const created = await Promise.all(
    missingNames.map((name) => prisma.category.create({ data: { name, color: colorByName.get(name)! } }))
  );
  for (const c of created) categoryIdByName.set(c.name, c.id);

  return categoryIdByName;
}

// Self-learned history (this user's own confirmed categorization) always
// wins when it exists - both default-category sources below only ever
// cover transactions that history has no opinion on, so neither overrides
// an explicit user choice, past or present. Kept separate from
// autoCategorizeTransactions for the same complexity-budget reason as the
// function above.
async function matchAgainstDefaults(
  uncategorized: UncategorizedTx[],
  matcher: (tx: UncategorizedTx) => string | null,
  colorByName: Map<string, string>
): Promise<Map<string, string>> {
  const matches = new Map<string, string>(); // transactionId -> categoryName
  for (const tx of uncategorized) {
    const categoryName = matcher(tx);
    if (categoryName) matches.set(tx.id, categoryName);
  }
  if (matches.size === 0) return new Map();

  const categoryIdByName = await resolveDefaultCategoryIds([...new Set(matches.values())], colorByName);

  const suggestions = new Map<string, string>();
  for (const [transactionId, categoryName] of matches) {
    const categoryId = categoryIdByName.get(categoryName);
    if (categoryId) suggestions.set(transactionId, categoryId);
  }
  return suggestions;
}

/**
 * Runs three complementary categorization sources against currently-
 * uncategorized transactions and applies whatever the highest-priority one
 * that has an answer suggests, in this order:
 *
 * 1. The self-learning label -> category engine (lib/domain/auto-categorize.ts),
 *    learned from this user's own already-categorized history - always
 *    takes priority when it has an answer, since it reflects this user's
 *    actual, confirmed intent.
 * 2. The Merchant Category Code map (lib/domain/mcc-categories.ts), for
 *    GoCardless-synced transactions whose bank populated
 *    `merchantCategoryCode` - a more authoritative signal than free-text
 *    matching (assigned by the card network at merchant registration time),
 *    but only ever present for GoCardless accounts and only when that
 *    specific bank chooses to fill it in.
 * 3. The curated merchant-name dictionary (lib/domain/merchant-categories.ts),
 *    for well-known brands neither of the above had an answer for - solves
 *    the cold-start problem for a brand new user.
 *
 * Any of the three can create a default Category (Alimentation, Transport,
 * etc.) if none exists yet - see resolveDefaultCategoryIds above.
 *
 * Called from four places: CSV import (scoped to the imported account),
 * the sync-triggered /api/transactions/auto-categorize route (every
 * account, every ~4h sync cycle, same as the alerts check),
 * syncGocardlessTransactions (lib/actions/gocardless.ts, right after new
 * GoCardless transactions land, so a populated merchantCategoryCode gets a
 * chance to match in the very same sync), and the manual "Auto-catégoriser"
 * button on /budgets (every account, on demand).
 */
export async function autoCategorizeTransactions(accountId?: string): Promise<{ categorized: number }> {
  const accountFilter = accountId ? { accountId } : {};

  const [uncategorized, history] = await Promise.all([
    prisma.transaction.findMany({
      where: { ...accountFilter, categoryId: null },
      select: { id: true, accountId: true, label: true, merchantCategoryCode: true },
    }),
    prisma.transaction.findMany({
      where: { ...accountFilter, categoryId: { not: null } },
      select: { accountId: true, label: true, categoryId: true },
    }),
  ]);

  if (uncategorized.length === 0) return { categorized: 0 };

  const learned = suggestCategoryAssignments(
    uncategorized,
    history.map((h) => ({ accountId: h.accountId, label: h.label, categoryId: h.categoryId! }))
  );

  const afterLearned = uncategorized.filter((tx) => !learned.has(tx.id));
  const fromMcc = await matchAgainstDefaults(afterLearned, (tx) => matchMccCategory(tx.merchantCategoryCode), new Map(Object.entries(MCC_CATEGORY_COLORS)));

  const afterMcc = afterLearned.filter((tx) => !fromMcc.has(tx.id));
  const fromDictionary = await matchAgainstDefaults(afterMcc, (tx) => matchMerchantCategory(tx.label)?.categoryName ?? null, TEXT_DICTIONARY_COLORS);

  const suggestions = new Map([...learned, ...fromMcc, ...fromDictionary]);
  if (suggestions.size === 0) return { categorized: 0 };

  // One updateMany per distinct target category rather than one per
  // transaction - suggestions.size is typically small but the number of
  // distinct categories among them is usually much smaller still.
  const idsByCategory = new Map<string, string[]>();
  for (const [transactionId, categoryId] of suggestions) {
    const ids = idsByCategory.get(categoryId) ?? [];
    ids.push(transactionId);
    idsByCategory.set(categoryId, ids);
  }

  await Promise.all(
    [...idsByCategory.entries()].map(([categoryId, ids]) =>
      prisma.transaction.updateMany({ where: { id: { in: ids } }, data: { categoryId } })
    )
  );

  return { categorized: suggestions.size };
}

export async function runAutoCategorizeNow() {
  const result = await autoCategorizeTransactions();
  revalidatePath("/budgets");
  revalidatePath("/accounts");
  revalidatePath("/");
  return result;
}
