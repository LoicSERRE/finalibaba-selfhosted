"use server";

import { FR_PFU_TOTAL_RATE, FR_SOCIAL_LEVIES_RATE, isCountryCode } from "@/lib/domain/tax-locale";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { parseCents } from "@/lib/utils/format";
import { getViewer } from "@/lib/auth-context";

export async function getUserSettings() {
  const viewer = await getViewer();
  return getUserSettingsFor(viewer.id);
}

/**
 * NOT exported, and that is the point: every export of a "use server" module is
 * invocable from the browser with attacker-chosen arguments, and this returns
 * the row holding smtpPassword and ntfyAuthToken in plaintext. A
 * userId-parameterised export would hand any user everyone else's credentials.
 */
async function getUserSettingsFor(userId: string) {
  return prisma.userSettings.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });
}

/**
 * ONE ACTION PER SETTINGS CARD, never one shared action, and that is a
 * correctness rule rather than tidiness.
 *
 * A field absent from a submitted form does not arrive as "unchanged" - it
 * arrives as null, and each parser then turns it into a real value. One action
 * writing all six columns therefore had each card silently erase the other's
 * data: reported as "I can't pick a country, saving does nothing", where the
 * country saved and the next profile save wiped it.
 *
 * A third card gets its own action too, rather than widening one of these.
 */
export async function updateFinancialProfile(formData: FormData) {
  const data = {
    salaryNetCents: parseCents((formData.get("salary") as string) || "0"),
    monthlyExpensesCents: parseCents((formData.get("expenses") as string) || "0"),
    monthlySavedCents: parseCents((formData.get("saved") as string) || "0"),
  };

  // savingsGoalCents is intentionally absent - superseded by the Goal
  // model (v1.14), see that model's own schema comment. The column stays
  // in place, just no longer written here.
  await writeUserSettings(data);
}

export async function updateTaxSettings(formData: FormData) {
  const rate = (field: string, fallback: number) =>
    Math.min(1, Math.max(0, Number.parseFloat((formData.get(field) as string) || String(fallback * 100)) / 100));

  // Validated against the known set rather than trusted: this drives which
  // wrappers and rates the UI offers, and an unrecognised value would silently
  // resolve to the neutral OTHER preset anyway. Empty stays null - "I have not
  // said" is a real state, distinct from "somewhere with no presets".
  const rawCountry = ((formData.get("country") as string) || "").trim();

  await writeUserSettings({
    country: isCountryCode(rawCountry) ? rawCountry : null,
    taxRatePea: rate("taxRatePea", FR_SOCIAL_LEVIES_RATE),
    taxRateCto: rate("taxRateCto", FR_PFU_TOTAL_RATE),
    taxRateCrypto: rate("taxRateCrypto", FR_PFU_TOTAL_RATE),
  });
}

/** Only the columns these two forms own - spelled out rather than derived from
 *  Prisma's update input, which permits field-update operators that the create
 *  half of the upsert below cannot accept. */
type UserSettingsPatch = {
  salaryNetCents?: bigint;
  monthlyExpensesCents?: bigint;
  monthlySavedCents?: bigint;
  country?: string | null;
  taxRatePea?: number;
  taxRateCto?: number;
  taxRateCrypto?: number;
};

async function writeUserSettings(data: UserSettingsPatch) {
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
