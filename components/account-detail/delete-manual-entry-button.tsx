"use client";

import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { deleteManualEntry } from "@/lib/actions/manual-entries";

/**
 * Removes an entry this person typed in, undoing what it did to the balance.
 *
 * Only rendered for a manual entry (`isManualEntry(syncId)`), because only a
 * manual entry ever moved the balance: a CSV-imported or synced row never did,
 * so "reversing" one would invent a movement that never happened. The Server
 * Action re-checks the same prefix rather than trusting this.
 *
 * Confirmed rather than immediate: it is the only delete on this table, it
 * changes a money figure, and there is no undo.
 */
export function DeleteManualEntryButton({ transactionId }: Readonly<{ transactionId: string }>) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const t = useTranslations("accountDetail.manualEntry");
  const tc = useTranslations("common");

  function handleConfirm() {
    setError(null);
    startTransition(async () => {
      const result = await deleteManualEntry(transactionId);
      if (!result.ok) {
        setError(t(result.error === "not_manual" ? "errorNotManual" : "errorNotFound"));
        return;
      }
      setOpen(false);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError(null);
      }}
      title={t("deleteConfirmTitle")}
      trigger={
        <Button variant="outline" size="sm" aria-label={t("deleteEntry")} title={t("deleteEntry")}>
          <Trash2 size={12} aria-hidden="true" />
        </Button>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-[var(--foreground)]">{t("deleteConfirmBody")}</p>
        {error && (
          <p role="alert" className="text-xs text-[var(--negative)]">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
            {tc("cancel")}
          </Button>
          <Button type="button" size="sm" onClick={handleConfirm} disabled={pending}>
            {pending ? tc("deleting") : tc("delete")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
