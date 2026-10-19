"use client";

import { toast } from "@/components/ui/toast";
import { undoDeletion } from "@/lib/actions/undo";

type Translate = (key: "restored" | "undoConflict" | "undoExpired" | "undo") => string;

/**
 * Raise a confirmation toast that offers to undo, given the token an
 * undoable action returned (v2.13). Shared by DeleteButton and the ledger's
 * bulk toolbar so both report a failed undo the same way, never silently.
 * `t` is the caller's `useTranslations("common")`; `refresh` its router's.
 */
export function offerUndo(message: string, undoToken: string | null, t: Translate, refresh: () => void) {
  if (!undoToken) {
    toast({ message });
    return;
  }
  toast({ message, action: { label: t("undo"), onClick: () => spendUndo(undoToken, t, refresh) } });
}

async function spendUndo(token: string, t: Translate, refresh: () => void) {
  const result = await undoDeletion(token);
  if (result.ok) {
    toast({ message: t("restored") });
    refresh();
    return;
  }
  toast({ tone: "error", message: t(result.error === "undo_conflict" ? "undoConflict" : "undoExpired") });
}
