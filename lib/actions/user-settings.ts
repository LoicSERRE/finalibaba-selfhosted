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

export async function updateUserSettings(formData: FormData) {
  const salary = parseCents((formData.get("salary") as string) || "0");
  const expenses = parseCents((formData.get("expenses") as string) || "0");
  const goal = parseCents((formData.get("goal") as string) || "50000");
  const saved = parseCents((formData.get("saved") as string) || "0");
  const taxRatePea = Math.min(1, Math.max(0, parseFloat((formData.get("taxRatePea") as string) || "17.2") / 100));
  const taxRateCto = Math.min(1, Math.max(0, parseFloat((formData.get("taxRateCto") as string) || "31.4") / 100));
  const taxRateCrypto = Math.min(1, Math.max(0, parseFloat((formData.get("taxRateCrypto") as string) || "31.4") / 100));

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
