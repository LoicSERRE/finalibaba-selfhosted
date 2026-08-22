"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/prisma";

export async function createInstitution(formData: FormData) {
  const name = (formData.get("name") as string).trim();
  if (!name) throw new Error("Name required");

  const woobModule = (formData.get("woobModule") as string | null)?.trim() || null;
  const woobLogin = (formData.get("woobLogin") as string | null)?.trim() || null;
  const woobPassword = (formData.get("woobPassword") as string | null)?.trim() || null;

  await prisma.institution.create({
    data: {
      name,
      ...(woobModule && woobLogin && woobPassword
        ? { woobModule, woobLogin, woobPassword }
        : {}),
    },
  });
  revalidatePath("/settings");
}

export async function setGocardlessInstitutionId(id: string, gcId: string) {
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
  await prisma.institution.update({
    where: { id },
    data: { woobModule: module, woobLogin: login, woobPassword: password },
  });
  revalidatePath("/settings");
}

export async function clearWoobConfig(id: string) {
  await prisma.institution.update({
    where: { id },
    data: { woobModule: null, woobLogin: null, woobPassword: null },
  });
  revalidatePath("/settings");
}

export async function deleteInstitution(id: string) {
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
  const inst = await prisma.institution.findUnique({ where: { id: institutionId }, select: { name: true } });
  const prefix = inst ? DEDICATED_SYNC_PREFIXES[inst.name.toLowerCase()] : undefined;
  if (!prefix) return { legacyOldest: null, woobOldest: null };

  const [legacyAccounts, woobAccounts] = await Promise.all([
    prisma.account.findMany({ where: { institutionId, syncId: { startsWith: prefix } }, select: { id: true } }),
    prisma.account.findMany({ where: { institutionId, syncId: { startsWith: `woob:${institutionId}:` } }, select: { id: true } }),
  ]);
  const [legacyOldest, woobOldest] = await Promise.all([
    oldestHistoryDate(legacyAccounts.map((a) => a.id)),
    oldestHistoryDate(woobAccounts.map((a) => a.id)),
  ]);
  return { legacyOldest, woobOldest };
}

export async function migrateDedicatedSyncToWoob(institutionId: string): Promise<{ deleted: number }> {
  const inst = await prisma.institution.findUnique({ where: { id: institutionId }, select: { name: true } });
  if (!inst) throw new Error("Institution not found");

  const prefix = DEDICATED_SYNC_PREFIXES[inst.name.toLowerCase()];
  if (!prefix) throw new Error("Not a dedicated-sync institution");

  const woobAccountCount = await prisma.account.count({
    where: { institutionId, syncId: { startsWith: `woob:${institutionId}:` } },
  });
  if (woobAccountCount === 0) {
    throw new Error("No Woob-synced accounts found yet for this institution - run a Woob sync first");
  }

  const result = await prisma.account.deleteMany({
    where: { institutionId, syncId: { startsWith: prefix } },
  });

  revalidatePath("/settings");
  revalidatePath("/accounts");
  revalidatePath("/analytics");
  revalidatePath("/");
  return { deleted: result.count };
}
