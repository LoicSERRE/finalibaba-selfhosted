"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { getViewer, assertOwned } from "@/lib/auth-context";
import { legacyTrSyncIds, parseTrSuffix, buildTrSyncId } from "@/lib/domain/sync-ids";

export async function createInstitution(formData: FormData) {
  const name = (formData.get("name") as string).trim();
  if (!name) throw new Error("Name required");

  const woobModule = (formData.get("woobModule") as string | null)?.trim() || null;
  const woobLogin = (formData.get("woobLogin") as string | null)?.trim() || null;
  const woobPassword = (formData.get("woobPassword") as string | null)?.trim() || null;
  const trPhone = (formData.get("trPhone") as string | null)?.trim() || null;
  const trPin = (formData.get("trPin") as string | null)?.trim() || null;

  // At most one provider, the same rule setWoobConfig/setTradeRepublicConfig
  // enforce on an existing row - the picker only ever offers one, but this is
  // a Server Action and a form payload is whatever the caller sends.
  // Trade Republic wins a payload carrying both rather than silently writing
  // an institution that two backends would each claim.
  let provider: Record<string, string> = {};
  if (trPhone && trPin) {
    provider = { trPhone, trPin };
  } else if (woobModule && woobLogin && woobPassword) {
    provider = { woobModule, woobLogin, woobPassword };
  }

  const viewer = await getViewer();

  // Institution names are unique per user, and prisma/seed.ts ships reference
  // rows for the common ones - "Trade Republic", "LCL", "Coinbase" - with no
  // credentials on them. So on a seeded install, which is the documented
  // default, picking one of those banks from the list is a name collision, and
  // creating blind fails. Attaching the credentials to the empty row is what
  // the user meant anyway: they picked a bank, not a database row.
  //
  // An institution that already syncs is a different story - silently
  // repointing it would swap a working connection for another under the same
  // name, so that says so instead. Editing it stays where it belongs, on its
  // own row in Settings.
  const existing = await prisma.institution.findFirst({
    where: { userId: viewer.id, name },
    select: { id: true, woobModule: true, trPhone: true },
  });

  if (existing) {
    if (existing.woobModule || existing.trPhone) {
      throw new Error(`"${name}" est déjà configurée - modifie sa synchronisation depuis sa ligne.`);
    }
    await prisma.institution.update({ where: { id: existing.id }, data: provider });
  } else {
    await prisma.institution.create({ data: { userId: viewer.id, name, ...provider } });
  }
  revalidatePath("/settings");
}

export async function setGocardlessInstitutionId(id: string, gcId: string) {
  const viewer = await getViewer();
  await assertOwned("institution", id, viewer.id);
  await prisma.institution.update({
    where: { id },
    data: { gocardlessInstitutionId: gcId },
  });
}

// Clears a stale/incomplete GoCardless link (gocardlessInstitutionId set,
// possibly gocardlessRequisitionId too if a requisition was created but its
// OAuth consent was never finished) - the only way to detach one, since
// setGocardlessInstitutionId has no counterpart. Real gap found in
// production: GOCARDLESS_SECRET_ID had been removed from this instance's
// env after an abandoned connection attempt, which hid every GoCardless
// button (all gated on gcConfigured in app/settings/page.tsx) - leaving the
// "· Open Banking" badge permanently shown next to that institution with no
// way to act on it, even though nothing was actually connected.
//
// Refuses to run if any account already has a real gocardlessAccountId for
// this institution - clearing the link at that point wouldn't delete their
// data, only hide their sync button, and there's no legitimate reason to do
// that, so it's not offered (mirrors migrateDedicatedSyncToWoob's own
// can't-touch-real-data guard above).
export async function clearGocardlessConnection(id: string) {
  const viewer = await getViewer();
  await assertOwned("institution", id, viewer.id);
  const linkedAccounts = await prisma.account.count({
    where: { institutionId: id, gocardlessAccountId: { not: null } },
  });
  if (linkedAccounts > 0) {
    throw new Error("Cannot disconnect: this institution already has GoCardless-synced accounts");
  }

  await prisma.institution.update({
    where: { id },
    data: { gocardlessInstitutionId: null, gocardlessRequisitionId: null },
  });
  revalidatePath("/settings");
}

export async function setWoobConfig(id: string, module: string, login: string, password: string) {
  const viewer = await getViewer();
  await assertOwned("institution", id, viewer.id);
  // Clears any Trade Republic config for the same reason
  // setTradeRepublicConfig clears the Woob fields: one provider per
  // institution, decided explicitly here rather than by whichever branch the
  // sync service happens to test first.
  await prisma.institution.update({
    where: { id },
    data: {
      woobModule: module,
      woobLogin: login,
      woobPassword: password,
      trPhone: null,
      trPin: null,
    },
  });
  revalidatePath("/settings");
}

/**
 * Trade Republic credentials for one institution (v2.1), the per-user
 * counterpart to setWoobConfig above.
 *
 * An institution carries one provider or the other, never both: the sync
 * service dispatches on which set is populated, so leaving Woob config in
 * place would make which backend runs depend on the order of two `if`s
 * rather than on what the user chose. Clearing it here makes the choice
 * explicit at the point it is made.
 *
 * trPin is stored in plaintext, the same trust model as woobPassword right
 * above it - see the schema comment and SECURITY.md.
 */
export async function setTradeRepublicConfig(id: string, phone: string, pin: string) {
  const viewer = await getViewer();
  await assertOwned("institution", id, viewer.id);

  const trimmedPhone = phone.trim();
  const trimmedPin = pin.trim();
  if (!trimmedPhone || !trimmedPin) throw new Error("Numéro de téléphone et code PIN requis.");

  await prisma.institution.update({
    where: { id },
    data: {
      trPhone: trimmedPhone,
      trPin: trimmedPin,
      woobModule: null,
      woobLogin: null,
      woobPassword: null,
    },
  });
  revalidatePath("/settings");
}

/**
 * Removes the Trade Republic connection from an institution.
 *
 * Deliberately leaves the Account rows and their whole history in place, the
 * same as clearWoobConfig below: disconnecting a sync must never destroy the
 * data it already imported. The accounts simply stop updating, and reconnecting
 * later picks them back up by syncId.
 */
export async function clearTradeRepublicConfig(id: string) {
  const viewer = await getViewer();
  await assertOwned("institution", id, viewer.id);
  await prisma.institution.update({
    where: { id },
    data: { trPhone: null, trPin: null },
  });
  revalidatePath("/settings");
}

export async function clearWoobConfig(id: string) {
  const viewer = await getViewer();
  await assertOwned("institution", id, viewer.id);
  await prisma.institution.update({
    where: { id },
    data: { woobModule: null, woobLogin: null, woobPassword: null },
  });
  revalidatePath("/settings");
}

export async function deleteInstitution(id: string) {
  const viewer = await getViewer();
  await assertOwned("institution", id, viewer.id);
  await prisma.institution.delete({ where: { id } });
  revalidatePath("/settings");
  revalidatePath("/accounts");
  revalidatePath("/analytics");
  revalidatePath("/");
}

// syncId prefix each dedicated .env-configured sync writes - see sync_lcl.py
// (`f"lcl:{account.id}"`) and sync_tr.py (`f"tr:{sync_suffix}"`/`"tr:cash"`).
// Both scripts resolve their target Institution by an exact name lookup
// (get_institution_id(cur, "LCL") / "Trade Republic"), and Institution.name
// is globally unique, so there is exactly one Institution row either prefix
// can ever be attached to.
const DEDICATED_SYNC_PREFIXES: Record<string, string> = {
  lcl: "lcl:",
  "trade republic": "tr:",
};

/**
 * A Prisma filter matching exactly the accounts the .env sync owns.
 *
 * For LCL a prefix is safe - nothing else writes `lcl:`. For Trade Republic it
 * is not: `tr:` also matches the per-user `tr:<institutionId>:` shape, so
 * deleting by prefix during a migration would take the accounts the migration
 * had just created along with the ones it meant to remove. That is the same
 * history-loss the v1.11 LCL incident produced, and it would land on whoever
 * moves off TR_PHONE - so the two are matched differently on purpose.
 */
function legacyAccountFilter(institutionName: string) {
  if (institutionName.toLowerCase() === "trade republic") {
    return { syncId: { in: legacyTrSyncIds() } };
  }
  const prefix = DEDICATED_SYNC_PREFIXES[institutionName.toLowerCase()];
  return prefix ? { syncId: { startsWith: prefix } } : null;
}

/**
 * The per-user accounts that prove the new sync actually produced something.
 *
 * Either backend counts: an institution moving off `.env` goes to Woob or, for
 * Trade Republic, to the per-user Trade Republic path added in v2.1. Before
 * that, only `woob:` counted, so someone migrating from TR_PHONE to their own
 * Trade Republic credentials could never satisfy the guard and the migration
 * refused forever.
 */
function perUserAccountFilter(institutionId: string) {
  return {
    OR: [
      { syncId: { startsWith: `woob:${institutionId}:` } },
      { syncId: { startsWith: `tr:${institutionId}:` } },
    ],
  };
}

// Completes the migration warned about by ConfigureWoobDialog's
// dedicatedEnvWarning banner: once a Woob sync has actually run for this
// institution (proven by at least one "woob:<institutionId>:"-prefixed
// Account existing), this deletes the old dedicated-sync accounts -
// Prisma cascades the delete to their Transaction/HistoricalBalance/Holding
// rows, since every FK pointing at Account is onDelete: Cascade (see
// schema.prisma). Requires proof that Woob has real data first so this can
// never delete the only copy of an account's history.
//
// This only removes the DB-side duplicate - it does NOT and cannot touch
// .env (Server Actions run inside the same container but have no business
// rewriting deploy config). The caller still has to remove LCL_LOGIN/
// LCL_PASSWORD (or TR_PHONE/TR_PIN) from .env and restart, or the next
// scheduled sync (within 4h) recreates the very accounts just deleted here -
// see CLAUDE.md's "Migrating an existing dedicated integration to Woob".
// Real production incident (2026-08): a user clicked "Migrer maintenant" on
// an institution where the "lcl:"-prefixed accounts had years of real
// Transaction/HistoricalBalance history but the "woob:"-prefixed
// replacements had only just started accumulating their own - the dialog
// only ever compared *account count* (5 vs 5, which matched), never
// *history depth*, so nothing warned before the cascade delete permanently
// erased that history. Recovered by hand from a database backup; this
// function exists so the dialog can warn before it happens to anyone else.
// The actual "is this gap big enough to warn about" threshold is a display
// decision, not a data-fetching one - see HISTORY_DEPTH_WARNING_DAYS in
// lib/domain/institutions.ts, which ConfigureWoobDialog applies to the raw
// dates returned here.
async function oldestHistoryDate(accountIds: string[]): Promise<Date | null> {
  if (accountIds.length === 0) return null;
  const [tx, hb] = await Promise.all([
    prisma.transaction.findFirst({ where: { accountId: { in: accountIds } }, orderBy: { date: "asc" }, select: { date: true } }),
    prisma.historicalBalance.findFirst({ where: { accountId: { in: accountIds } }, orderBy: { recordedAt: "asc" }, select: { recordedAt: true } }),
  ]);
  const dates = [tx?.date, hb?.recordedAt].filter((d): d is Date => !!d);
  return dates.length > 0 ? dates.reduce((a, b) => (a < b ? a : b), dates[0]) : null;
}

// Compares how far back each side's history actually goes, for the same
// institution's dedicated-sync (lcl:/tr:) vs Woob (woob:<id>:) accounts -
// the comparison ConfigureWoobDialog's confirmation step is missing today,
// see the incident note above. Returns { null, null } for an institution
// that isn't a dedicated-sync one at all (mirrors migrateDedicatedSyncToWoob's
// own prefix lookup) rather than throwing - this is a read-only display
// helper, not a guard, so a non-applicable institution just renders no
// warning instead of erroring the whole settings page.
export async function getMigrationHistoryDepth(
  institutionId: string,
): Promise<{ legacyOldest: Date | null; woobOldest: Date | null }> {
  const viewer = await getViewer();
  await assertOwned("institution", institutionId, viewer.id);
  const inst = await prisma.institution.findUnique({ where: { id: institutionId }, select: { name: true } });
  const legacy = inst ? legacyAccountFilter(inst.name) : null;
  if (!legacy) return { legacyOldest: null, woobOldest: null };

  const [legacyAccounts, woobAccounts] = await Promise.all([
    prisma.account.findMany({ where: { institutionId, ...legacy }, select: { id: true } }),
    prisma.account.findMany({ where: { institutionId, ...perUserAccountFilter(institutionId) }, select: { id: true } }),
  ]);
  const [legacyOldest, woobOldest] = await Promise.all([
    oldestHistoryDate(legacyAccounts.map((a) => a.id)),
    oldestHistoryDate(woobAccounts.map((a) => a.id)),
  ]);
  return { legacyOldest, woobOldest };
}

/**
 * Hand the .env Trade Republic sync's existing accounts over to this
 * institution's own credentials, keeping every one of them and their history.
 *
 * The alternative already here, migrateDedicatedSyncToWoob, DELETES the legacy
 * accounts once replacements exist - which for a move off TR_PHONE means
 * throwing away years of transactions and balances and starting the new
 * connection from whatever Trade Republic still serves. That is the shape that
 * cost a real user their LCL history in v1.11, and the history-depth warning
 * only tells you it is about to happen.
 *
 * Nothing has to be deleted. The rows are already correct; only the string
 * that says which sync owns them is wrong. `tr:cash` becomes
 * `tr:<institutionId>:cash`, the Account row is untouched otherwise, and every
 * Transaction, HistoricalBalance and Holding hanging off it stays exactly
 * where it is. The per-user sync then recognises them as its own and keeps
 * appending.
 *
 * Refuses while TR_PHONE is still set, and that guard is the point rather than
 * caution: the env sync resolves its accounts by those same legacy ids, so if
 * it ran between the rename and the .env edit it would simply create `tr:cash`
 * again - the duplicate set this whole operation exists to avoid. Removing the
 * credentials first makes the race impossible instead of unlikely.
 */
export async function adoptDedicatedTrAccounts(
  institutionId: string,
): Promise<{ adopted: number }> {
  const viewer = await getViewer();
  await assertOwned("institution", institutionId, viewer.id);

  if (process.env.TR_PHONE) {
    throw new Error(
      "Retire d'abord TR_PHONE et TR_PIN du .env puis redémarre les conteneurs - sinon la synchronisation .env recréerait les comptes juste après.",
    );
  }

  const institution = await prisma.institution.findUnique({
    where: { id: institutionId },
    select: { trPhone: true },
  });
  if (!institution?.trPhone) {
    throw new Error("Configure d'abord Trade Republic sur cette institution.");
  }

  const legacy = await prisma.account.findMany({
    where: { institutionId, syncId: { in: legacyTrSyncIds() } },
    select: { id: true, syncId: true },
  });

  let adopted = 0;
  for (const account of legacy) {
    const suffix = parseTrSuffix(account.syncId);
    if (!suffix) continue;
    const target = buildTrSyncId(suffix, institutionId);

    // syncId is globally unique. A row already holding the target id means a
    // per-user sync has already run and made its own copy, so renaming would
    // fail the constraint - leave both alone and let the user decide, rather
    // than merging two accounts on a guess.
    const clash = await prisma.account.findUnique({
      where: { syncId: target },
      select: { id: true },
    });
    if (clash) continue;

    await prisma.account.update({ where: { id: account.id }, data: { syncId: target } });
    adopted++;
  }

  revalidatePath("/settings");
  revalidatePath("/accounts");
  revalidatePath("/");
  return { adopted };
}

export async function migrateDedicatedSyncToWoob(institutionId: string): Promise<{ deleted: number }> {
  // This one deletes accounts (and cascades to their whole history), so the
  // ownership check matters more here than anywhere else in this file.
  const viewer = await getViewer();
  await assertOwned("institution", institutionId, viewer.id);
  const inst = await prisma.institution.findUnique({ where: { id: institutionId }, select: { name: true } });
  if (!inst) throw new Error("Institution not found");

  const legacy = legacyAccountFilter(inst.name);
  if (!legacy) throw new Error("Not a dedicated-sync institution");

  const perUserAccountCount = await prisma.account.count({
    where: { institutionId, ...perUserAccountFilter(institutionId) },
  });
  if (perUserAccountCount === 0) {
    throw new Error(
      "No accounts from the new sync found yet for this institution - run it once first",
    );
  }

  const result = await prisma.account.deleteMany({
    where: { institutionId, ...legacy },
  });

  revalidatePath("/settings");
  revalidatePath("/accounts");
  revalidatePath("/analytics");
  revalidatePath("/");
  return { deleted: result.count };
}
