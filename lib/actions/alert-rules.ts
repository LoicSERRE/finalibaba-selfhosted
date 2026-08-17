"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { parseCents } from "@/lib/utils/format";

export async function getAlertRules() {
  return prisma.alertRule.findMany({
    include: { account: true, holding: { include: { account: true } }, category: true },
    orderBy: { createdAt: "desc" },
  });
}

// ACCOUNT_BALANCE and INVESTMENT_VALUE are structurally identical at
// creation time (an account + a cents threshold) - only their eligible
// account list differs, enforced by which accounts the dialog offers, not
// here. See schema.prisma's AlertRule comment for why they share
// balanceThresholdCents/balanceLastAbove instead of each getting their own.
function buildAccountThresholdData(kind: "ACCOUNT_BALANCE" | "INVESTMENT_VALUE", formData: FormData, message: string | null) {
  const accountId = (formData.get("accountId") as string) || "";
  const thresholdRaw = (formData.get("balanceThreshold") as string) || "";
  if (!accountId || !thresholdRaw) throw new Error("Compte et seuil requis.");
  return { kind, accountId, balanceThresholdCents: parseCents(thresholdRaw), message };
}

// UNREALIZED_GAIN: accountId is the only kind where an empty picker value is
// valid input, not a validation error - it means "aggregate across every
// investment/crypto account" (see checkUnrealizedGainRule). gainUnit picks
// which single threshold field is stored; the other stays null so a rule's
// unit is never ambiguous.
function buildUnrealizedGainData(formData: FormData, message: string | null) {
  const accountId = (formData.get("accountId") as string) || "";
  const gainUnit = (formData.get("gainUnit") as string) || "";
  if (gainUnit !== "PERCENT" && gainUnit !== "AMOUNT") throw new Error("Unité requise.");

  if (gainUnit === "PERCENT") {
    const pctRaw = (formData.get("gainThresholdPct") as string) || "";
    if (!pctRaw) throw new Error("Seuil requis.");
    return {
      kind: "UNREALIZED_GAIN" as const,
      accountId: accountId || null,
      gainUnit: "PERCENT" as const,
      gainThresholdPct: Number.parseFloat(pctRaw),
      message,
    };
  }
  const thresholdRaw = (formData.get("balanceThreshold") as string) || "";
  if (!thresholdRaw) throw new Error("Seuil requis.");
  return {
    kind: "UNREALIZED_GAIN" as const,
    accountId: accountId || null,
    gainUnit: "AMOUNT" as const,
    balanceThresholdCents: parseCents(thresholdRaw),
    message,
  };
}

// Kept as its own function (not inlined into createAlertRule) to stay under
// the sonarjs cognitive-complexity gate now that there are 6 kinds - see
// CLAUDE.md's pre-commit pipeline notes.
function buildCreateData(formData: FormData) {
  const kind = formData.get("kind") as string;
  const message = ((formData.get("message") as string) || "").trim() || null;

  if (kind === "ACCOUNT_BALANCE" || kind === "INVESTMENT_VALUE") {
    return buildAccountThresholdData(kind, formData, message);
  }
  if (kind === "ACCOUNT_OVERDRAFT") {
    const accountId = (formData.get("accountId") as string) || "";
    if (!accountId) throw new Error("Compte requis.");
    // No user-entered threshold - always 0, so "à découvert" isn't a number
    // the user has to think about (unlike ACCOUNT_BALANCE's generic
    // threshold, this kind's whole point is fixed at "crosses zero").
    return { kind: "ACCOUNT_OVERDRAFT" as const, accountId, balanceThresholdCents: BigInt(0), message };
  }
  if (kind === "HOLDING_PRICE") {
    const holdingId = (formData.get("holdingId") as string) || "";
    const thresholdRaw = (formData.get("balanceThreshold") as string) || "";
    if (!holdingId || !thresholdRaw) throw new Error("Position et seuil requis.");
    return { kind: "HOLDING_PRICE" as const, holdingId, balanceThresholdCents: parseCents(thresholdRaw), message };
  }
  if (kind === "UNREALIZED_GAIN") {
    return buildUnrealizedGainData(formData, message);
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

type UpdateData = {
  message: string | null;
  balanceThresholdCents?: bigint;
  gainThresholdPct?: number;
  balanceLastAbove?: null;
};

// Changing a threshold invalidates the old crossing baseline - without
// this, moving it while already above/below the new value would read as
// "no change" instead of correctly starting fresh (see
// evaluateAccountBalanceAlert's wasAbove=null case). Same reset
// updateAlertTriggers does for netWorthAlertLastAbove.
function applyThresholdCentsUpdate(data: UpdateData, thresholdRaw: string, currentThreshold: bigint | null) {
  if (!thresholdRaw) return;
  const newThreshold = parseCents(thresholdRaw);
  if (newThreshold !== currentThreshold) {
    data.balanceThresholdCents = newThreshold;
    data.balanceLastAbove = null;
  }
}

const THRESHOLD_CENTS_EDITABLE_KINDS = new Set(["ACCOUNT_BALANCE", "INVESTMENT_VALUE", "HOLDING_PRICE"]);

// Only message and each kind's own threshold are editable after creation -
// kind/account/holding/category/gainUnit are fixed at creation time, same
// "immutable, delete and recreate instead" simplification ShareLink applies
// to its own token. ACCOUNT_OVERDRAFT and BUDGET_OVERRUN have nothing
// threshold-like to edit here (overdraft's is fixed at 0, budget's comes
// from Category.budgetCents) - only message changes for those two.
export async function updateAlertRule(id: string, formData: FormData) {
  const message = ((formData.get("message") as string) || "").trim() || null;
  const current = await prisma.alertRule.findUniqueOrThrow({ where: { id } });

  const data: UpdateData = { message };

  if (THRESHOLD_CENTS_EDITABLE_KINDS.has(current.kind)) {
    applyThresholdCentsUpdate(data, (formData.get("balanceThreshold") as string) || "", current.balanceThresholdCents);
  } else if (current.kind === "UNREALIZED_GAIN" && current.gainUnit === "PERCENT") {
    const pctRaw = (formData.get("gainThresholdPct") as string) || "";
    if (pctRaw) {
      const newPct = Number.parseFloat(pctRaw);
      if (newPct !== current.gainThresholdPct) {
        data.gainThresholdPct = newPct;
        data.balanceLastAbove = null;
      }
    }
  } else if (current.kind === "UNREALIZED_GAIN") {
    applyThresholdCentsUpdate(data, (formData.get("balanceThreshold") as string) || "", current.balanceThresholdCents);
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
