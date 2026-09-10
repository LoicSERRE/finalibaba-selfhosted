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

/**
 * Two actions, one per Settings card - NOT one shared action, and that
 * distinction is the whole point rather than tidiness.
 *
 * `/settings` renders two separate forms against this module: the financial
 * profile (salary/expenses/saved) and the tax section (country + the three
 * suggested rates). A single action reading every field from `formData` wrote
 * all six columns on every submit, and a field absent from the submitted form
 * does not arrive as "unchanged" - it arrives as `null`, which each parser
 * then turned into a real value: `|| "0"` for the money fields, the FR default
 * for the rates, and `isCountryCode("")` being false for the country.
 *
 * So each card silently erased the other's data. Reported as "I can't pick a
 * country, saving does nothing" - the country did save, and was then wiped by
 * the next save of the financial profile. Confirmed against a real production
 * database: `country` empty next to a populated `salaryNetCents`, with
 * `taxRatePea` sitting at exactly `0.18600000000000003` - the float you get
 * from `parseFloat("18.6")/100`, i.e. the default this action writes when the
 * field is absent, not a value anyone typed.
 *
 * Same split, for the same reason, as updateAlertChannels/updateAlertTriggers
 * (see CLAUDE.md's "Settings UI split"). When adding a third Settings card,
 * give it its own action too rather than widening one of these.
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
