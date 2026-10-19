import { prisma } from "@/lib/db/prisma";
import type { AlertRule, Category, Goal, IncomeEvent } from "@/app/generated/prisma/client";

/**
 * What each undoable change takes away, and how to put it back: deletions
 * (v2.13) and the ledger's bulk edits (v2.14).
 *
 * Plain module, not "use server": every function here takes ids or a userId
 * from its caller, which a browser must never be able to choose - the
 * actions in lib/actions/* resolve and authorize those first. Restores reuse
 * the original ids, so links held elsewhere (URLs, other rows) keep working.
 */

export type UndoSnapshot =
  | { kind: "category"; category: Category; transactionIds: string[]; splitIds: string[]; recurringIds: string[]; alertRules: AlertRule[] }
  | { kind: "goal"; goal: Goal }
  | { kind: "incomeEvent"; event: IncomeEvent }
  | { kind: "recurring"; id: string; accountId: string; active: boolean; dismissedAt: Date | null }
  // accountIds: only to revalidate the right pages once restored.
  | { kind: "transactionsCategory"; assignedCategoryId: string | null; previous: Array<{ id: string; categoryId: string | null }>; accountIds: string[] }
  | { kind: "transactionsTransfer"; previous: Array<{ id: string; internalTransferManual: boolean | null }>; accountIds: string[] };

/**
 * A category's own row, and every row its deletion changes: transactions,
 * splits and recurring series lose the link (SetNull), its alert rules are
 * deleted with it (Cascade).
 */
export async function snapshotCategory(id: string): Promise<UndoSnapshot> {
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
export async function restoreCategory(snapshot: Extract<UndoSnapshot, { kind: "category" }>) {
  const { category, transactionIds, splitIds, recurringIds, alertRules } = snapshot;
  await prisma.$transaction([
    prisma.category.create({ data: category }),
    prisma.transaction.updateMany({ where: { id: { in: transactionIds }, categoryId: null }, data: { categoryId: category.id } }),
    prisma.transactionSplit.updateMany({ where: { id: { in: splitIds }, categoryId: null }, data: { categoryId: category.id } }),
    prisma.recurringTransaction.updateMany({ where: { id: { in: recurringIds }, categoryId: null }, data: { categoryId: category.id } }),
    prisma.alertRule.createMany({ data: alertRules }),
  ]);
}

export async function restoreGoal(snapshot: Extract<UndoSnapshot, { kind: "goal" }>) {
  await prisma.goal.create({ data: snapshot.goal });
}

export async function restoreIncomeEvent(snapshot: Extract<UndoSnapshot, { kind: "incomeEvent" }>) {
  await prisma.incomeEvent.create({ data: snapshot.event });
}

/** A recurring "delete" is a dismissal; undoing puts back the exact prior state, paused or not. */
export async function restoreRecurring(snapshot: Extract<UndoSnapshot, { kind: "recurring" }>) {
  await prisma.recurringTransaction.update({
    where: { id: snapshot.id },
    data: { active: snapshot.active, dismissedAt: snapshot.dismissedAt },
  });
}

type RestoreKey = string | boolean | null;

/**
 * Ids grouped by the value they go back to, one updateMany per group. Not
 * generic on purpose: a type parameter hides a function from lizard
 * (dev-docs/release-audit.md, item 2).
 */
function groupIds(rows: Array<{ id: string; key: RestoreKey }>): Map<RestoreKey, string[]> {
  const groups = new Map<RestoreKey, string[]>();
  for (const { id, key } of rows) {
    const ids = groups.get(key);
    if (ids) ids.push(id);
    else groups.set(key, [id]);
  }
  return groups;
}

/**
 * Put each transaction back in the category it had, but only where the bulk
 * edit is still what is there: one recategorized or split since keeps the
 * user's newer choice. `writableAccountIds` drops anything the viewer lost
 * access to inside the window rather than failing the whole undo.
 */
export async function restoreTransactionsCategory(
  snapshot: Extract<UndoSnapshot, { kind: "transactionsCategory" }>,
  writableAccountIds: string[]
) {
  const groups = groupIds(snapshot.previous.map((row) => ({ id: row.id, key: row.categoryId })));
  await prisma.$transaction(
    [...groups].map(([categoryId, ids]) =>
      prisma.transaction.updateMany({
        where: { id: { in: ids }, accountId: { in: writableAccountIds }, categoryId: snapshot.assignedCategoryId, splits: { none: {} } },
        data: { categoryId: categoryId as string | null },
      })
    )
  );
}

/** Un-mark what the bulk edit marked, back to each row's prior manual flag. */
export async function restoreTransactionsTransfer(
  snapshot: Extract<UndoSnapshot, { kind: "transactionsTransfer" }>,
  writableAccountIds: string[]
) {
  const groups = groupIds(snapshot.previous.map((row) => ({ id: row.id, key: row.internalTransferManual })));
  await prisma.$transaction(
    [...groups].map(([internalTransferManual, ids]) =>
      prisma.transaction.updateMany({
        where: { id: { in: ids }, accountId: { in: writableAccountIds }, isInternalTransfer: true, internalTransferManual: true },
        data: { isInternalTransfer: false, internalTransferManual: internalTransferManual as boolean | null },
      })
    )
  );
}

/** Unique (P2002) or foreign-key (P2003) clash: something took the place back, or a parent is gone. */
export function isRestoreConflict(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "P2002" || code === "P2003";
}
