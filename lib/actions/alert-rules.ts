"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { parseCents } from "@/lib/utils/format";

export async function getAlertRules() {
  return prisma.alertRule.findMany({
    include: { account: true, category: true },
    orderBy: { createdAt: "desc" },
  });
}

function buildCreateData(formData: FormData) {
  const kind = formData.get("kind") as string;
  const message = ((formData.get("message") as string) || "").trim() || null;

  if (kind === "ACCOUNT_BALANCE") {
    const accountId = (formData.get("accountId") as string) || "";
    const thresholdRaw = (formData.get("balanceThreshold") as string) || "";
    if (!accountId || !thresholdRaw) throw new Error("Compte et seuil requis.");
    return { kind: "ACCOUNT_BALANCE" as const, accountId, balanceThresholdCents: parseCents(thresholdRaw), message };
  }
  if (kind === "BUDGET_OVERRUN") {
    const categoryId = (formData.get("categoryId") as string) || "";
    if (!categoryId) throw new Error("Catégorie requise.");
    return { kind: "BUDGET_OVERRUN" as const, categoryId, message };
  }
  throw new Error("Invalid rule kind.");
}

export async function createAlertRule(formData: FormData) {
  await prisma.alertRule.create({ data: buildCreateData(formData) });
  revalidatePath("/settings");
}

// Only message and (for ACCOUNT_BALANCE) the threshold are editable after
// creation - kind/account/category are fixed at creation time, same
// "immutable, delete and recreate instead" simplification ShareLink
// applies to its own token.
export async function updateAlertRule(id: string, formData: FormData) {
  const message = ((formData.get("message") as string) || "").trim() || null;
  const thresholdRaw = (formData.get("balanceThreshold") as string) || "";
  const current = await prisma.alertRule.findUniqueOrThrow({ where: { id } });

  const data: { message: string | null; balanceThresholdCents?: bigint; balanceLastAbove?: null } = { message };
  if (current.kind === "ACCOUNT_BALANCE" && thresholdRaw) {
    const newThreshold = parseCents(thresholdRaw);
    if (newThreshold !== current.balanceThresholdCents) {
      // Same reset as updateAlertSettings does for netWorthAlertLastAbove -
      // changing the threshold invalidates the old crossing baseline.
      data.balanceThresholdCents = newThreshold;
      data.balanceLastAbove = null;
    }
  }
  await prisma.alertRule.update({ where: { id }, data });
  revalidatePath("/settings");
}

export async function deleteAlertRule(id: string) {
  await prisma.alertRule.delete({ where: { id } });
  revalidatePath("/settings");
}

export async function toggleAlertRuleActive(id: string, active: boolean) {
  await prisma.alertRule.update({ where: { id }, data: { active } });
  revalidatePath("/settings");
}
