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
import { detectInternalTransferPairings } from "@/lib/domain/internal-transfers";
import { excludeFromBudgetTotals } from "@/lib/domain/transaction-filters";

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

// Flags internal transfers - see CLAUDE.md's "Internal transfer detection"
// for the design and the three defects that shaped it.
//
// Scoped to `accountIds` (own + co-owned), never the whole table: a global
// pass pairs one user's debit with another's unrelated credit. Never narrowed
// to a single account either - transfers are cross-account by nature.
//
// The pool is every row NOBODY HAS RULED ON, flagged or not, so a person's
// decision survives and a pairing can be revisited. That means the pass can
// revoke a flag, which the old monotonic write made impossible - and that
// write was also what stopped two users' passes over a co-owned account from
// thrashing a row. internalTransferPairId replaces the guarantee: a flag is
// only revoked when the partner that justified it is in this pass's own pool.
async function flagInternalTransfers(accountIds: string[], userId: string): Promise<void> {
  if (accountIds.length === 0) return;
  const candidates = await prisma.transaction.findMany({
    // A share purchase and a card payment can never be one leg of a transfer -
    // no second bank account records the other side - and on real data each
    // won a tie against the genuine counterpart.
    where: {
      isSecuritiesMovement: false,
      accountId: { in: accountIds },
      AND: [
        // A row marked a transfer BY HAND stays in, as a partner others can
        // pair against. Leaving it out stranded its counterpart for good:
        // marking one leg removed it from the pool, so the leg that should
        // pair with it had none left and could never be flagged. Measured on
        // a real database - a 500 and a 600 EUR debit kept counting as
        // spending while their credits did not, understating one month by
        // 1 100 EUR. `false` still stays out: that is a person saying "not a
        // transfer", and it must never be paired.
        //
        // Two OR blocks under AND rather than one object with two OR keys,
        // where the second silently replaces the first - and never
        // `{ not: false }`, which is the same three-valued trap as below.
        { OR: [{ internalTransferManual: null }, { internalTransferManual: true }] },
        // Null MUST pass - it is what every other source and every pre-existing
        // row carries. Hence the explicit null branch and not a bare NOT:
        // `NOT (NULL LIKE 'CARD_%')` is NULL in SQL, not TRUE, so a negated
        // match excludes every null row. Written that way first, it took the
        // pool from 628 rows to zero and switched detection off silently.
        { OR: [{ sourceEventType: null }, { NOT: { sourceEventType: { startsWith: "CARD_" } } }] },
      ],
    },
    select: {
      id: true,
      accountId: true,
      amountCents: true,
      date: true,
      isInternalTransfer: true,
      internalTransferManual: true,
      internalTransferPairId: true,
    },
  });
  if (candidates.length === 0) return;

  const partnerById = new Map<string, string>();
  for (const { creditId, debitId } of detectInternalTransferPairings(candidates)) {
    partnerById.set(creditId, debitId);
    partnerById.set(debitId, creditId);
  }
  const poolIds = new Set(candidates.map((c) => c.id));

  const newlyPaired: Array<{ id: string; pairId: string; decided: boolean }> = [];
  const unpaired: string[] = [];
  for (const c of candidates) {
    const partner = partnerById.get(c.id);
    const decided = c.internalTransferManual === true;
    if (partner) {
      // Rewritten when the partner changed too, not only when the flag did -
      // a re-pairing has to leave the stored evidence pointing at the leg
      // that actually justifies it.
      if (!c.isInternalTransfer || c.internalTransferPairId !== partner) {
        newlyPaired.push({ id: c.id, pairId: partner, decided });
      }
      // A hand-marked leg keeps its flag whatever the matching says, so it is
      // only ever written to record which row it paired with.
    } else if (!decided && c.isInternalTransfer && c.internalTransferPairId && poolIds.has(c.internalTransferPairId)) {
      unpaired.push(c.id);
    }
  }

  if (newlyPaired.length === 0 && unpaired.length === 0) return;

  await prisma.$transaction([
    ...newlyPaired.map(({ id, pairId }) =>
      prisma.transaction.update({
        where: { id },
        data: { isInternalTransfer: true, internalTransferPairId: pairId },
      })
    ),
    prisma.transaction.updateMany({
      where: { id: { in: unpaired } },
      data: { isInternalTransfer: false, internalTransferPairId: null },
    }),
  ]);

  // Only rows this pass itself flagged. A hand-marked leg is left alone, the
  // same way setInternalTransferFlag never touches a category either.
  const matchedIds = newlyPaired.filter((p) => !p.decided).map((p) => p.id);
  if (matchedIds.length === 0) return;

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
  // A user with no accounts has nothing to categorize. The queries below would
  // be harmless (an empty `in` matches nothing) but they would still be issued,
  // once per user, on every pass of the cron that loops over all of them.
  if (accountIds.length === 0) return { categorized: 0 };

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
      where: excludeFromBudgetTotals({ ...scope, categoryId: null, splits: { none: {} } }),
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
