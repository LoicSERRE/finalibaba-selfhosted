"use server";

import { revalidatePath } from "next/cache";
import { getViewer, assertAccountWritable } from "@/lib/auth-context";
import { actionError, actionOk, type ActionResult } from "@/lib/domain/action-result";
import { revalidateCategory, revalidateIncome } from "@/lib/actions/revalidate";
import { takeUndo } from "@/lib/services/undo-store";
import {
  isRestoreConflict,
  restoreCategory,
  restoreGoal,
  restoreIncomeEvent,
  restoreRecurring,
  type DeletionSnapshot,
} from "@/lib/services/undo-deletion";

export type UndoError = "undo_expired" | "undo_conflict";

/**
 * Put back what a deletion took, from the token it returned (v2.13).
 *
 * Takes nothing but the token: the snapshot never left the server, and a
 * token only resolves for the user it was issued to. Account-scoped rows are
 * re-authorized, because a co-ownership can be revoked inside the window.
 */
export async function undoDeletion(token: string): Promise<ActionResult<void, UndoError>> {
  const viewer = await getViewer();
  const snapshot = typeof token === "string" ? takeUndo<DeletionSnapshot>(viewer.id, token) : null;
  if (!snapshot) return actionError("undo_expired");

  try {
    switch (snapshot.kind) {
      case "category":
        await restoreCategory(snapshot);
        revalidateCategory(snapshot.category.id);
        break;
      case "goal":
        await restoreGoal(snapshot);
        revalidatePath("/settings");
        revalidatePath("/analytics");
        break;
      case "incomeEvent":
        await assertAccountWritable(viewer.id, snapshot.event.accountId);
        await restoreIncomeEvent(snapshot);
        revalidateIncome(snapshot.event.accountId);
        break;
      case "recurring":
        await assertAccountWritable(viewer.id, snapshot.accountId);
        await restoreRecurring(snapshot);
        revalidatePath("/recurring");
        break;
    }
  } catch (error) {
    if (isRestoreConflict(error)) return actionError("undo_conflict");
    throw error;
  }
  return actionOk();
}
