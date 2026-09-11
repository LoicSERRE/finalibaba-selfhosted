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

  // Names are unique per user and prisma/seed.ts ships credential-less
  // reference rows, so on a seeded install picking a common bank is a name
  // collision. Attaching to the empty row is what the user meant. One that
  // already syncs is refused instead - silently repointing a working
  // connection is the one outcome nobody could have meant.
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

// Detaches a stale or half-finished GoCardless link - the only way to, since
// setGocardlessInstitutionId has no counterpart. Without it, removing
// GOCARDLESS_SECRET_ID from .env hides every GoCardless button and strands the
// "Open Banking" badge with no way to act on it.
//
// Refuses once any account carries a real gocardlessAccountId: that would hide
// a working sync button rather than detach anything.
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
 * Trade Republic credentials for one institution, the per-user counterpart to
 * setWoobConfig. An institution carries one provider or the other, never both:
 * the sync dispatches on whichever set is populated, so leaving the Woob config
 * would make the backend depend on the order of two `if`s. trPin is plaintext,
 * same trust model as woobPassword.
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
 * Removes the connection, never the Account rows: disconnecting a sync must not
 * destroy what it imported. Reconnecting picks them back up by syncId.
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
 * Exactly the accounts the .env sync owns. A prefix is safe for LCL and NOT for
 * Trade Republic: `tr:` also matches the per-user `tr:<institutionId>:` shape,
 * so deleting by prefix takes the accounts a migration just created.
 */
function legacyAccountFilter(institutionName: string) {
  if (institutionName.toLowerCase() === "trade republic") {
    return { syncId: { in: legacyTrSyncIds() } };
  }
  const prefix = DEDICATED_SYNC_PREFIXES[institutionName.toLowerCase()];
  return prefix ? { syncId: { startsWith: prefix } } : null;
}

/**
 * Proof the new sync produced something. EITHER backend counts - counting only
 * `woob:` meant a move from TR_PHONE to per-user Trade Republic could never
 * satisfy the guard, and the migration refused forever.
 */
function perUserAccountFilter(institutionId: string) {
  return {
    OR: [
      { syncId: { startsWith: `woob:${institutionId}:` } },
      { syncId: { startsWith: `tr:${institutionId}:` } },
    ],
  };
}

// DELETES the old dedicated-sync accounts, cascading to their transactions,
// balances and holdings. Requires proof that Woob already produced real data,
// so it can never remove the only copy of an account's history.
//
// Removes the DB-side duplicate only: the caller must still take LCL_LOGIN /
// TR_PHONE out of .env and restart, or the next scheduled sync recreates
// exactly what this just deleted.
// Matching ACCOUNT COUNTS are not matching history depth: a real migration
// showed 5 vs 5 and the cascade delete erased years of transactions the
// replacements did not have yet, recovered by hand from a backup. The warning
// threshold itself is a display decision - HISTORY_DEPTH_WARNING_DAYS.
async function oldestHistoryDate(accountIds: string[]): Promise<Date | null> {
  if (accountIds.length === 0) return null;
  const [tx, hb] = await Promise.all([
    prisma.transaction.findFirst({ where: { accountId: { in: accountIds } }, orderBy: { date: "asc" }, select: { date: true } }),
    prisma.historicalBalance.findFirst({ where: { accountId: { in: accountIds } }, orderBy: { recordedAt: "asc" }, select: { recordedAt: true } }),
  ]);
  const dates = [tx?.date, hb?.recordedAt].filter((d): d is Date => !!d);
  return dates.length > 0 ? dates.reduce((a, b) => (a < b ? a : b), dates[0]) : null;
}

// How far back each side's history goes. A read-only display helper, not a
// guard: a non-applicable institution returns nulls and renders no warning
// rather than erroring the whole settings page.
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
 * Hands the .env Trade Republic accounts over to this institution's own
 * credentials, keeping every row. Nothing is deleted - only the string saying
 * which sync owns them is wrong, so `tr:cash` becomes
 * `tr:<institutionId>:cash` and everything hanging off the account stays put.
 * Use this rather than migrateDedicatedSyncToWoob, which deletes.
 *
 * Refuses while TR_PHONE is still set, and that guard is the feature: the env
 * sync resolves by those same legacy ids, so running between the rename and
 * the .env edit simply recreates `tr:cash`.
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
  let skipped = 0;
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
    if (clash) {
      skipped++;
      continue;
    }

    await prisma.account.update({ where: { id: account.id }, data: { syncId: target } });
    adopted++;
  }

  // Every account already had a per-user copy, so this did nothing and would
  // otherwise report a cheerful "0 adopted". That is the state of anyone who
  // synced before removing TR_PHONE: two full sets side by side, and no way
  // to tell from here which copy holds the real history. Say so, and point at
  // the tool that measures both and lets them choose.
  if (adopted === 0 && skipped > 0) {
    throw new Error(
      `Ces ${skipped} compte(s) existent déjà en double : une synchronisation a déjà créé sa propre copie. Lance ./scripts/fix-duplicate-tr-accounts.sh sur le serveur - il compare l'historique des deux copies et supprime la plus pauvre.`,
    );
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
