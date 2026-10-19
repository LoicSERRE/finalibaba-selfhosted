import { prisma } from "@/lib/db/prisma";
import type { AlertRule, Category, Goal, IncomeEvent } from "@/app/generated/prisma/client";

/**
 * What each undoable deletion takes away, and how to put it back (v2.13).
 *
 * Plain module, not "use server": every function here takes ids or a userId
 * from its caller, which a browser must never be able to choose - the
 * actions in lib/actions/* resolve and authorize those first. Restores reuse
 * the original ids, so links held elsewhere (URLs, other rows) keep working.
 */

export type DeletionSnapshot =
  | { kind: "category"; category: Category; transactionIds: string[]; splitIds: string[]; recurringIds: string[]; alertRules: AlertRule[] }
  | { kind: "goal"; goal: Goal }
  | { kind: "incomeEvent"; event: IncomeEvent }
  | { kind: "recurring"; id: string; accountId: string; active: boolean; dismissedAt: Date | null };

/**
 * A category's own row, and every row its deletion changes: transactions,
 * splits and recurring series lose the link (SetNull), its alert rules are
 * deleted with it (Cascade).
 */
export async function snapshotCategory(id: string): Promise<DeletionSnapshot> {
  const [category, transactions, splits, recurrings, alertRules] = await Promise.all([
    prisma.category.findUniqueOrThrow({ where: { id } }),
    prisma.transaction.findMany({ where: { categoryId: id }, select: { id: true } }),
    prisma.transactionSplit.findMany({ where: { categoryId: id }, select: { id: true } }),
    prisma.recurringTransaction.findMany({ where: { categoryId: id }, select: { id: true } }),
    prisma.alertRule.findMany({ where: { categoryId: id } }),
  ]);
  return {
    kind: "category",
    category,
    transactionIds: transactions.map((t) => t.id),
    splitIds: splits.map((s) => s.id),
    recurringIds: recurrings.map((r) => r.id),
    alertRules,
  };
}

/**
 * Recreate the category, then re-link only rows that are still unassigned:
 * a transaction recategorized in the meantime keeps the user's newer choice.
 */
export async function restoreCategory(snapshot: Extract<DeletionSnapshot, { kind: "category" }>) {
  const { category, transactionIds, splitIds, recurringIds, alertRules } = snapshot;
  await prisma.$transaction([
    prisma.category.create({ data: category }),
    prisma.transaction.updateMany({ where: { id: { in: transactionIds }, categoryId: null }, data: { categoryId: category.id } }),
    prisma.transactionSplit.updateMany({ where: { id: { in: splitIds }, categoryId: null }, data: { categoryId: category.id } }),
    prisma.recurringTransaction.updateMany({ where: { id: { in: recurringIds }, categoryId: null }, data: { categoryId: category.id } }),
    prisma.alertRule.createMany({ data: alertRules }),
  ]);
}

export async function restoreGoal(snapshot: Extract<DeletionSnapshot, { kind: "goal" }>) {
  await prisma.goal.create({ data: snapshot.goal });
}

export async function restoreIncomeEvent(snapshot: Extract<DeletionSnapshot, { kind: "incomeEvent" }>) {
  await prisma.incomeEvent.create({ data: snapshot.event });
}

/** A recurring "delete" is a dismissal; undoing puts back the exact prior state, paused or not. */
export async function restoreRecurring(snapshot: Extract<DeletionSnapshot, { kind: "recurring" }>) {
  await prisma.recurringTransaction.update({
    where: { id: snapshot.id },
    data: { active: snapshot.active, dismissedAt: snapshot.dismissedAt },
  });
}

/** Unique (P2002) or foreign-key (P2003) clash: something took the place back, or a parent is gone. */
export function isRestoreConflict(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "P2002" || code === "P2003";
}
