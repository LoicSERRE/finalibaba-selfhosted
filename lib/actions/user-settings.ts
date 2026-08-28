"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { parseCents } from "@/lib/utils/format";
import { getViewer, OWNER_USER_ID } from "@/lib/auth-context";
import { normalizeUsername } from "@/lib/domain/users";

export async function getUserSettings() {
  const viewer = await getViewer();
  return getUserSettingsFor(viewer.id);
}

/**
 * One settings row per user, created on first read. Split out from
 * getUserSettings() so server-to-server callers that already resolved a user
 * (the alert cron loops over every user) don't have to go through the session.
 */
export async function getUserSettingsFor(userId: string) {
  return prisma.userSettings.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });
}

// Deliberately a read-only findUnique, not an upsert - this is called from
// the anonymous, unauthenticated /login page on every page view, and that
// must never write to the DB. Takes the submitted username because the login
// form has to know whether to render the 2FA field *before* anyone is
// authenticated; falls back to the owner when no username was typed (the
// legacy password-only form). Returns false for an unknown username rather
// than erroring, which also avoids leaking whether an account exists.
export async function getTotpEnabled(username?: string): Promise<boolean> {
  const normalized = username ? normalizeUsername(username) : null;
  const row = normalized
    ? await prisma.user.findUnique({ where: { username: normalized }, select: { totpEnabled: true } })
    : await prisma.user.findUnique({ where: { id: OWNER_USER_ID }, select: { totpEnabled: true } });
  return row?.totpEnabled ?? false;
}

export async function updateUserSettings(formData: FormData) {
  const salary = parseCents((formData.get("salary") as string) || "0");
  const expenses = parseCents((formData.get("expenses") as string) || "0");
  const saved = parseCents((formData.get("saved") as string) || "0");
  const taxRatePea = Math.min(1, Math.max(0, Number.parseFloat((formData.get("taxRatePea") as string) || "17.2") / 100));
  const taxRateCto = Math.min(1, Math.max(0, Number.parseFloat((formData.get("taxRateCto") as string) || "31.4") / 100));
  const taxRateCrypto = Math.min(1, Math.max(0, Number.parseFloat((formData.get("taxRateCrypto") as string) || "31.4") / 100));

  // savingsGoalCents is intentionally absent - superseded by the Goal
  // model (v1.14), see that model's own schema comment. The column stays
  // in place, just no longer written here.
  const data = { salaryNetCents: salary, monthlyExpensesCents: expenses, monthlySavedCents: saved, taxRatePea, taxRateCto, taxRateCrypto };

  const viewer = await getViewer();
  await prisma.userSettings.upsert({
    where: { userId: viewer.id },
    create: { ...data, userId: viewer.id },
    update: data,
  });

  revalidatePath("/");
  revalidatePath("/accounts");
  revalidatePath("/analytics");
  revalidatePath("/settings");
}
