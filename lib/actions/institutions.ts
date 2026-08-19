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
