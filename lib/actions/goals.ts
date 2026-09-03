"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { getViewer, assertAccountWritable, assertOwned } from "@/lib/auth-context";
import { parseCents } from "@/lib/utils/format";

export async function getGoals() {
  const viewer = await getViewer();
  return prisma.goal.findMany({
    where: { userId: viewer.id },
    include: { account: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
}

// The Settings picker only ever offers non-LOAN accounts (see
// app/settings/page.tsx's goalEligibleAccounts query), but a Server
// Action is directly invocable regardless of what's rendered - same
// trust boundary as assertManualAccountEligible/assertIncomeEventEligible
// elsewhere in this codebase. Without this check, a goal linked to a
// LOAN account would silently show 0% progress forever with no
// explanation: lib/domain/analytics.ts's assetRows deliberately excludes
// LOAN accounts (a liability, not an asset), so such a goal's
// assetValueById lookup would always miss and fall back to 0.
// Ownership rides along with the LOAN-eligibility rule for the same reason
// the comment above gives: this is the chokepoint both goal-writing actions
// already go through.
async function assertGoalAccountEligible(accountId: string | null) {
  if (accountId === null) return; // "track my whole net worth" - no account to own
  const viewer = await getViewer();
  await assertAccountWritable(viewer.id, accountId);
  const account = await prisma.account.findUnique({ where: { id: accountId }, select: { type: true } });
  if (!account) throw new Error("Compte introuvable.");
  if (account.type === "LOAN") throw new Error("Un prêt ne peut pas être lié à un objectif d'épargne.");
}

// Every field is freely editable after creation - unlike AlertRule, Goal
// has no kind-driven field shape to keep immutable, so create and update
// share this one builder outright.
function buildGoalData(formData: FormData) {
  const name = ((formData.get("name") as string) || "").trim();
  const targetRaw = (formData.get("targetCents") as string) || "";
  const accountId = (formData.get("accountId") as string) || "";
  const targetDateRaw = (formData.get("targetDate") as string) || "";

  if (!name) throw new Error("Nom requis.");
  const targetCents = parseCents(targetRaw);
  if (targetCents <= BigInt(0)) throw new Error("Montant cible requis.");

  return {
    name,
    targetCents,
    // Empty string = "track total net worth" (see the Goal model's own
    // schema comment) - not a validation error, a first-class choice.
    accountId: accountId || null,
    // Noon-UTC convention, same as every other date-only input in this
    // codebase (CSV import, recurring transactions, sales) - avoids a
    // pure calendar-date input silently shifting a day in a negative-UTC-
    // offset deployment.
    targetDate: targetDateRaw ? new Date(`${targetDateRaw}T12:00:00.000Z`) : null,
  };
}

export async function createGoal(formData: FormData) {
  const data = buildGoalData(formData);
  await assertGoalAccountEligible(data.accountId);
  const viewer = await getViewer();
  await prisma.goal.create({ data: { ...data, userId: viewer.id } });
  revalidateGoals();
}

export async function updateGoal(id: string, formData: FormData) {
  const data = buildGoalData(formData);
  await assertGoalAccountEligible(data.accountId);
  const viewer = await getViewer();
  await assertOwned("goal", id, viewer.id);
  await prisma.goal.update({ where: { id }, data });
  revalidateGoals();
}

export async function deleteGoal(id: string) {
  const viewer = await getViewer();
  await assertOwned("goal", id, viewer.id);
  await prisma.goal.delete({ where: { id } });
  revalidateGoals();
}

// Settings manages goals, Analytics displays their progress - both need
// revalidating after every mutation.
function revalidateGoals() {
  revalidatePath("/settings");
  revalidatePath("/analytics");
}
