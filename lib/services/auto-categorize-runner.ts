// The categorization engine itself, extracted out of lib/actions/auto-
// categorize.ts when v2.0 made it per-user. Deliberately NOT a "use server"
// module: it takes a userId as a plain parameter, and every exported member
// of a "use server" file is directly invocable from the browser with
// attacker-chosen arguments - a userId parameter there would be an
// impersonation primitive. Keeping the engine here means the only callable
// surface stays the session-resolving wrappers in lib/actions/auto-
// categorize.ts, plus the two internal cron routes that authenticate with
// NEXTAUTH_SECRET and loop over users themselves.
//
// Same "a service reads what it needs from the DB itself" precedent as
// lib/services/api-auth.ts.
import { prisma } from "@/lib/db/prisma";
import { suggestCategoryAssignments } from "@/lib/domain/auto-categorize";
import { matchMerchantCategory, MERCHANT_CATEGORY_COLORS } from "@/lib/domain/merchant-categories";
import { matchMccCategory, MCC_CATEGORY_COLORS } from "@/lib/domain/mcc-categories";
import { detectInternalTransferPairs } from "@/lib/domain/internal-transfers";
import { excludeInternalTransfers } from "@/lib/domain/transaction-filters";

type UncategorizedTx = { id: string; accountId: string; label: string; merchantCategoryCode: string | null };

const TEXT_DICTIONARY_COLORS = new Map(Object.entries(MERCHANT_CATEGORY_COLORS));

// Of the 8-category default taxonomy, "Revenus" is the one that's income,
// not spending - CategoryKind.INCOME, same as any category a user
// explicitly marks that way via the create/edit dialog. Everything else
// this module can create defaults to EXPENSE (Category's own schema
// default), matching the taxonomy documented in CLAUDE.md.
const INCOME_CATEGORY_NAMES = new Set(["Revenus"]);

// Resolves category NAMES (from either default-category source below) to
// real Category ids, creating any that don't exist yet - the one place
// auto-categorization creates a Category rather than only assigning an
// existing one, exactly so a brand new user with zero categories still
// gets somewhere useful for a well-known merchant or MCC to land. Takes an
// explicit name->color map rather than picking a source itself, so it's
// reusable for both the text dictionary and the MCC map without knowing
// which one called it. Kept separate from autoCategorizeForUser below to
// stay under the sonarjs cognitive-complexity gate.
//
// Both the lookup and the create are scoped to `userId` (v2.0): Category.name
// is unique per user now, not globally, so an unscoped name lookup would
// resolve to whichever user's "Alimentation" happened to be found first and
// silently file one person's groceries under another's budget.
async function resolveDefaultCategoryIds(
  names: string[],
  colorByName: Map<string, string>,
  userId: string,
): Promise<Map<string, string>> {
  const categoryIdByName = new Map<string, string>();
  if (names.length === 0) return categoryIdByName;

  const existing = await prisma.category.findMany({
    where: { userId, name: { in: names } },
    select: { id: true, name: true },
  });
  for (const c of existing) categoryIdByName.set(c.name, c.id);

  const missingNames = names.filter((n) => !categoryIdByName.has(n));
  const created = await Promise.all(
    missingNames.map((name) =>
      prisma.category.create({
        data: { userId, name, color: colorByName.get(name)!, kind: INCOME_CATEGORY_NAMES.has(name) ? "INCOME" : "EXPENSE" },
      })
    )
  );
  for (const c of created) categoryIdByName.set(c.name, c.id);

  return categoryIdByName;
}

// Self-learned history (this user's own confirmed categorization) always
// wins when it exists - both default-category sources below only ever
// cover transactions that history has no opinion on, so neither overrides
// an explicit user choice, past or present. Kept separate from
// autoCategorizeForUser for the same complexity-budget reason as the
// function above.
async function matchAgainstDefaults(
  uncategorized: UncategorizedTx[],
  matcher: (tx: UncategorizedTx) => string | null,
  colorByName: Map<string, string>,
  userId: string,
): Promise<Map<string, string>> {
  const matches = new Map<string, string>(); // transactionId -> categoryName
  for (const tx of uncategorized) {
    const categoryName = matcher(tx);
    if (categoryName) matches.set(tx.id, categoryName);
  }
  if (matches.size === 0) return new Map();

  const categoryIdByName = await resolveDefaultCategoryIds([...new Set(matches.values())], colorByName, userId);

  const suggestions = new Map<string, string>();
  for (const [transactionId, categoryName] of matches) {
    const categoryId = categoryIdByName.get(categoryName);
    if (categoryId) suggestions.set(transactionId, categoryId);
  }
  return suggestions;
}

// Detects internal transfers (money moving between two of the user's own
// accounts) purely by amount+date pairing, independent of the transaction
// label - see lib/domain/internal-transfers.ts for why label text alone
// can't do this reliably (a real production incident: a bank's generic
// "VIREMENT SEPA" label gets reused for both).
//
// Scoped to `accountIds` (the runner's own base set: accounts they own or
// co-own), never the whole table. This pass used to run globally, which was
// correct while every account in the database belonged to the same person -
// the exact assumption lib/domain/internal-transfers.ts's own header states.
// In multi-user that assumption is false and a global pass becomes a
// cross-user false-positive generator: user A's €500 debit and user B's
// unrelated €500 credit two days apart would be paired and both silently
// excluded from their owners' budgets and income. In mono mode the base set
// is every account anyway, so behavior there is unchanged.
//
// Running it per user means a transfer is flagged if ANY stakeholder can see
// both sides, which is the intended semantics for a co-owned account. It is
// safe to run repeatedly from several users' passes: the write only ever
// sets isInternalTransfer to true (monotonic), so two passes can't thrash a
// row back and forth.
//
// Deliberately NOT narrowed further to one accountId the way the rest of the
// engine can be - transfers are inherently cross-account, so the pool has to
// span the runner's whole base set. Once a pair is flagged, the
// isInternalTransfer index keeps each subsequent run bounded to genuinely
// new transactions rather than rescanning history.
async function flagInternalTransfers(accountIds: string[], userId: string): Promise<void> {
  if (accountIds.length === 0) return;
  const candidates = await prisma.transaction.findMany({
    where: { isInternalTransfer: false, accountId: { in: accountIds } },
    select: { id: true, accountId: true, amountCents: true, date: true },
  });
  if (candidates.length === 0) return;

  const matchedIds = [...detectInternalTransferPairs(candidates)];
  if (matchedIds.length === 0) return;

  await prisma.transaction.updateMany({
    where: { id: { in: matchedIds } },
    data: { isInternalTransfer: true },
  });

  // Retroactive cleanup for the exact incident this was built to fix: a
  // transaction already (wrongly) sitting in "Revenus" that's now
  // confirmed to be an internal transfer gets un-categorized. Deliberately
  // narrow - only "Revenus" specifically, not any category - a different
  // category could reflect a deliberate manual choice (some users may want
  // to track internal transfers under their own category) that this pass
  // has no business overriding.
  //
  // The category match is scoped to this user's own "Revenus" (v2.0): on a
  // co-owned account another user's category of the same name may be what's
  // currently assigned, and silently clearing someone else's deliberate
  // categorization is exactly what the "deliberately narrow" rule above
  // exists to prevent.
  await prisma.transaction.updateMany({
    where: { id: { in: matchedIds }, category: { userId, name: "Revenus" } },
    data: { categoryId: null },
  });
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
 *    Transaction.merchantCategoryCode - assigned by the card network at
 *    merchant registration time, so more authoritative than a label guess.
 * 3. The merchant text dictionary (lib/domain/merchant-categories.ts), for
 *    the cold-start case the other two can't cover.
 *
 * `accountIds` is the runner's base set (own + co-owned); `accountId`
 * narrows to one of those when a caller only cares about a single account
 * (a CSV import, a GoCardless sync). Runs flagInternalTransfers over the
 * whole base set first regardless - a detected internal transfer is then
 * excluded from the uncategorized pool below, so none of the three sources
 * ever assigns it a category (it isn't real income or spending). The flag
 * doesn't block a manual categorization from the transaction row's own
 * dropdown, only the automatic sources here.
 */
export async function autoCategorizeForUser(
  userId: string,
  accountIds: string[],
  accountId?: string,
): Promise<{ categorized: number }> {
  await flagInternalTransfers(accountIds, userId);

  // Always an id-set filter, never an unscoped query: a bare `{}` here would
  // pull every user's transactions into the pool and categorize them with
  // this user's categories.
  const scope = accountId
    ? { accountId: accountIds.includes(accountId) ? accountId : "__none__" }
    : { accountId: { in: accountIds } };

  const [uncategorized, history] = await Promise.all([
    // "splits: { none: {} }" matters here specifically - a split
    // transaction also has categoryId: null (its category info lives in
    // TransactionSplit rows instead, see CLAUDE.md's "Split transactions"),
    // and without this guard every one of the three sources below would
    // treat it as genuinely uncategorized and silently overwrite the
    // user's manual split the next time this runs.
    prisma.transaction.findMany({
      where: excludeInternalTransfers({ ...scope, categoryId: null, splits: { none: {} } }),
      select: { id: true, accountId: true, label: true, merchantCategoryCode: true },
    }),
    prisma.transaction.findMany({
      where: { ...scope, categoryId: { not: null } },
      select: { accountId: true, label: true, categoryId: true },
    }),
  ]);

  if (uncategorized.length === 0) return { categorized: 0 };

  const learned = suggestCategoryAssignments(
    uncategorized,
    history.map((h) => ({ accountId: h.accountId, label: h.label, categoryId: h.categoryId! }))
  );

  const afterLearned = uncategorized.filter((tx) => !learned.has(tx.id));
  const fromMcc = await matchAgainstDefaults(afterLearned, (tx) => matchMccCategory(tx.merchantCategoryCode), new Map(Object.entries(MCC_CATEGORY_COLORS)), userId);

  const afterMcc = afterLearned.filter((tx) => !fromMcc.has(tx.id));
  const fromDictionary = await matchAgainstDefaults(afterMcc, (tx) => matchMerchantCategory(tx.label)?.categoryName ?? null, TEXT_DICTIONARY_COLORS, userId);

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
