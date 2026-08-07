"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { parseCents } from "@/lib/utils/format";

export async function getUserSettings() {
  return prisma.userSettings.upsert({
    where: { id: "singleton" },
    create: {},
    update: {},
  });
}

// Deliberately a read-only findUnique, not the upsert-based getUserSettings()
// above - this is called from the anonymous, unauthenticated /login page on
// every page view, and that must never write to the DB. Defaults to false
// when no row exists yet (fresh install, /settings never visited).
export async function getTotpEnabled(): Promise<boolean> {
  const row = await prisma.userSettings.findUnique({
    where: { id: "singleton" },
    select: { totpEnabled: true },
  });
  return row?.totpEnabled ?? false;
}

export async function updateUserSettings(formData: FormData) {
  const salary = parseCents((formData.get("salary") as string) || "0");
  const expenses = parseCents((formData.get("expenses") as string) || "0");
  const goal = parseCents((formData.get("goal") as string) || "50000");
  const saved = parseCents((formData.get("saved") as string) || "0");
  const taxRatePea = Math.min(1, Math.max(0, Number.parseFloat((formData.get("taxRatePea") as string) || "17.2") / 100));
  const taxRateCto = Math.min(1, Math.max(0, Number.parseFloat((formData.get("taxRateCto") as string) || "31.4") / 100));
  const taxRateCrypto = Math.min(1, Math.max(0, Number.parseFloat((formData.get("taxRateCrypto") as string) || "31.4") / 100));

  const data = { salaryNetCents: salary, monthlyExpensesCents: expenses, savingsGoalCents: goal, monthlySavedCents: saved, taxRatePea, taxRateCto, taxRateCrypto };

  await prisma.userSettings.upsert({
    where: { id: "singleton" },
    create: data,
    update: data,
  });

  revalidatePath("/");
  revalidatePath("/accounts");
  revalidatePath("/analytics");
  revalidatePath("/settings");
}
