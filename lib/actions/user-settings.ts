"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { parseCents } from "@/lib/format";

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

  await prisma.userSettings.upsert({
    where: { id: "singleton" },
    create: { salaryNetCents: salary, monthlyExpensesCents: expenses, savingsGoalCents: goal, monthlySavedCents: saved },
    update: { salaryNetCents: salary, monthlyExpensesCents: expenses, savingsGoalCents: goal, monthlySavedCents: saved },
  });

  revalidatePath("/analytics");
  revalidatePath("/settings");
}
