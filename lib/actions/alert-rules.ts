"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { getViewer, assertAccountWritable, assertOwned } from "@/lib/auth-context";
import { parseCents } from "@/lib/utils/format";

// Real, pre-existing bug found while testing REBALANCING_DRIFT live (the
// first kind whose demo/dev data actually exercised a holding-linked rule
// end-to-end): a blanket `holding: { include: { account: true } }` sends
// the full Holding row - including `quantity`, a Decimal.js instance -
// across the Server -> Client boundary to this "use client" component's
// props. React's RSC serialization rejects that outright ("Only plain
// objects can be passed to Client Components... Decimal objects are not
// supported"), confirmed live on every /settings load once any rule has a
// holdingId (this affects the pre-existing HOLDING_PRICE kind identically,
// not something new to REBALANCING_DRIFT). Narrowed every relation to a
// `select` matching exactly what AlertRuleRow/HoldingOption in
// alert-rules-section.tsx actually read.
export async function getAlertRules() {
  const viewer = await getViewer();
  return prisma.alertRule.findMany({
    where: { userId: viewer.id },
    include: {
      account: { select: { id: true, name: true } },
      holding: { select: { id: true, ticker: true, name: true, account: { select: { id: true, name: true } } } },
      category: { select: { id: true, name: true, budgetCents: true } },
    },
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
  if (kind === "REBALANCING_DRIFT") {
    const holdingId = (formData.get("holdingId") as string) || "";
    const pctRaw = (formData.get("gainThresholdPct") as string) || "";
    if (!holdingId || !pctRaw) throw new Error("Position et seuil requis.");
    return { kind: "REBALANCING_DRIFT" as const, holdingId, gainThresholdPct: Number.parseFloat(pctRaw), message };
  }
  if (kind === "NEW_TRANSACTION") {
    return buildNewTransactionData(formData, message);
  }
  throw new Error("Invalid rule kind.");
}

// NEW_TRANSACTION: every field is optional, unlike every other kind -
// "notify me on any new transaction anywhere" is a legitimate configuration
// on its own, not a malformed one. accountId empty = every account (same
// "null is valid input" precedent as UNREALIZED_GAIN); balanceThreshold
// empty = no minimum amount; transactionDirection empty = both debits and
// credits.
function buildNewTransactionData(formData: FormData, message: string | null) {
  const accountId = (formData.get("accountId") as string) || "";
  const thresholdRaw = (formData.get("balanceThreshold") as string) || "";
  const direction = (formData.get("transactionDirection") as string) || "";
  const transactionDirection: "DEBIT" | "CREDIT" | null =
    direction === "DEBIT" || direction === "CREDIT" ? direction : null;
  return {
    kind: "NEW_TRANSACTION" as const,
    accountId: accountId || null,
    balanceThresholdCents: thresholdRaw ? parseCents(thresholdRaw) : null,
    transactionDirection,
    message,
  };
}

// Server Actions are directly invocable regardless of what the UI picker
// offers (same trust boundary as assertGoalAccountEligible/
// assertCsvImportEligible elsewhere in this codebase) - a REBALANCING_DRIFT
// rule pointed at a holding with no target set would silently never fire
// (computeHoldingDriftPts's own malformed-row guard), the same kind of
// dead-rule-with-no-explanation gap assertGoalAccountEligible was added to
// close for Goal/LOAN accounts.
async function assertHoldingHasTarget(holdingId: string): Promise<void> {
  const holding = await prisma.holding.findUnique({ where: { id: holdingId }, select: { targetPct: true } });
  if (holding?.targetPct == null) {
    throw new Error("Cette position n'a pas de cible de répartition définie.");
  }
}

// A rule can only ever target what the viewer can reach - otherwise someone
// could point a rule at another user's account or holding and receive
// notifications describing its balance.
async function assertRuleTargetsWritable(
  viewerId: string,
  data: { accountId?: string | null; holdingId?: string; categoryId?: string }
): Promise<void> {
  if (data.accountId) await assertAccountWritable(viewerId, data.accountId);
  if (data.categoryId) await assertOwned("category", data.categoryId, viewerId);
  if (data.holdingId) {
    const holding = await prisma.holding.findUnique({
      where: { id: data.holdingId },
      select: { accountId: true },
    });
    if (!holding) throw new Error("Position introuvable.");
    await assertAccountWritable(viewerId, holding.accountId);
  }
}

export async function createAlertRule(formData: FormData) {
  const data = buildCreateData(formData);
  const viewer = await getViewer();
  await assertRuleTargetsWritable(viewer.id, data as Parameters<typeof assertRuleTargetsWritable>[1]);
  if (data.kind === "REBALANCING_DRIFT") {
    await assertHoldingHasTarget(data.holdingId);
  }
  await prisma.alertRule.create({ data: { ...data, userId: viewer.id } });
  revalidatePath("/settings");
}

type UpdateData = {
  message: string | null;
  balanceThresholdCents?: bigint | null;
  gainThresholdPct?: number;
  balanceLastAbove?: null;
  transactionDirection?: "DEBIT" | "CREDIT" | null;
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

// Mirrors applyThresholdCentsUpdate above, over gainThresholdPct instead of
// balanceThresholdCents - shared by UNREALIZED_GAIN/PERCENT and
// REBALANCING_DRIFT below, the two kinds that store their threshold there.
function applyGainThresholdPctUpdate(data: UpdateData, pctRaw: string, currentPct: number | null) {
  if (!pctRaw) return;
  const newPct = Number.parseFloat(pctRaw);
  if (newPct !== currentPct) {
    data.gainThresholdPct = newPct;
    data.balanceLastAbove = null;
  }
}

// NEW_TRANSACTION only - unlike every other kind's threshold, both fields
// here are genuinely optional filters, so a blank submission means "clear
// it," not "leave unchanged" (the other kinds' thresholds are required at
// creation, so blank there can only mean "user didn't retype it"). Always
// sets both from the form, never conditionally. Deliberately does NOT touch
// lastNotifiedTransactionAt - see schema.prisma's AlertRule comment for why
// this cursor must survive a filter edit unlike every other kind's own
// dedup flag.
function applyNewTransactionUpdate(data: UpdateData, formData: FormData) {
  const thresholdRaw = (formData.get("balanceThreshold") as string) || "";
  const direction = (formData.get("transactionDirection") as string) || "";
  data.balanceThresholdCents = thresholdRaw ? parseCents(thresholdRaw) : null;
  data.transactionDirection = direction === "DEBIT" || direction === "CREDIT" ? direction : null;
}

// Only message and each kind's own threshold are editable after creation -
// kind/account/holding/category/gainUnit are fixed at creation time, same
// "immutable, delete and recreate instead" simplification ShareLink applies
// to its own token. ACCOUNT_OVERDRAFT and BUDGET_OVERRUN have nothing
// threshold-like to edit here (overdraft's is fixed at 0, budget's comes
// from Category.budgetCents) - only message changes for those two.
export async function updateAlertRule(id: string, formData: FormData) {
  const message = ((formData.get("message") as string) || "").trim() || null;
  const viewer = await getViewer();
  await assertOwned("alertRule", id, viewer.id);
  const current = await prisma.alertRule.findUniqueOrThrow({ where: { id } });

  const data: UpdateData = { message };

  if (THRESHOLD_CENTS_EDITABLE_KINDS.has(current.kind)) {
    applyThresholdCentsUpdate(data, (formData.get("balanceThreshold") as string) || "", current.balanceThresholdCents);
  } else if (
    (current.kind === "UNREALIZED_GAIN" && current.gainUnit === "PERCENT") ||
    current.kind === "REBALANCING_DRIFT"
  ) {
    applyGainThresholdPctUpdate(data, (formData.get("gainThresholdPct") as string) || "", current.gainThresholdPct);
  } else if (current.kind === "UNREALIZED_GAIN") {
    applyThresholdCentsUpdate(data, (formData.get("balanceThreshold") as string) || "", current.balanceThresholdCents);
  } else if (current.kind === "NEW_TRANSACTION") {
    applyNewTransactionUpdate(data, formData);
  }

  await prisma.alertRule.update({ where: { id }, data });
  revalidatePath("/settings");
}

export async function deleteAlertRule(id: string) {
  const viewer = await getViewer();
  await assertOwned("alertRule", id, viewer.id);
  await prisma.alertRule.delete({ where: { id } });
  revalidatePath("/settings");
}

export async function toggleAlertRuleActive(id: string, active: boolean) {
  const viewer = await getViewer();
  await assertOwned("alertRule", id, viewer.id);
  await prisma.alertRule.update({ where: { id }, data: { active } });
  revalidatePath("/settings");
}
