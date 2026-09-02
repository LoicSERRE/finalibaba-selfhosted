"use server";

import { isCountryCode } from "@/lib/domain/tax-locale";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { parseCents } from "@/lib/utils/format";
import { getViewer } from "@/lib/auth-context";

export async function getUserSettings() {
  const viewer = await getViewer();
  return getUserSettingsFor(viewer.id);
}

/**
 * One settings row per user, created on first read.
 *
 * NOT exported, deliberately: every export of a "use server" module is
 * directly invocable from the browser with attacker-chosen arguments, and this
 * returns the row holding `smtpPassword` and `ntfyAuthToken` in plaintext (see
 * schema.prisma) - exporting a userId-parameterized version of it would hand
 * any authenticated user every other user's alert credentials. Callers with a
 * session use getUserSettings() above; the alert cron, which has no session,
 * runs its own scoped upsert per user in app/api/alerts/check/route.ts.
 */
async function getUserSettingsFor(userId: string) {
  return prisma.userSettings.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });
}

export async function updateUserSettings(formData: FormData) {
  const salary = parseCents((formData.get("salary") as string) || "0");
  const expenses = parseCents((formData.get("expenses") as string) || "0");
  const saved = parseCents((formData.get("saved") as string) || "0");
  const taxRatePea = Math.min(1, Math.max(0, Number.parseFloat((formData.get("taxRatePea") as string) || "17.2") / 100));
  const taxRateCto = Math.min(1, Math.max(0, Number.parseFloat((formData.get("taxRateCto") as string) || "31.4") / 100));
  const taxRateCrypto = Math.min(1, Math.max(0, Number.parseFloat((formData.get("taxRateCrypto") as string) || "31.4") / 100));

  // Validated against the known set rather than trusted: this drives which
  // wrappers and rates the UI offers, and an unrecognised value would silently
  // resolve to the neutral OTHER preset anyway. Empty stays null - "I have not
  // said" is a real state, distinct from "somewhere with no presets".
  const rawCountry = ((formData.get("country") as string) || "").trim();
  const country = isCountryCode(rawCountry) ? rawCountry : null;

  // savingsGoalCents is intentionally absent - superseded by the Goal
  // model (v1.14), see that model's own schema comment. The column stays
  // in place, just no longer written here.
  const data = { salaryNetCents: salary, monthlyExpensesCents: expenses, monthlySavedCents: saved, taxRatePea, taxRateCto, taxRateCrypto, country };

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
