"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { offerUndo } from "@/components/shared/offer-undo";
import type { ActionResult } from "@/lib/domain/action-result";
import { useTranslations } from "next-intl";

// Named payload rather than `ActionResult<{ undoToken: string }>` inline: a
// top-level alias of a generic over an object literal hides the rest of the
// file from lizard (dev-docs/release-audit.md, item 2).
type UndoPayload = { undoToken: string };
type UndoableResult = ActionResult<UndoPayload>;

export function DeleteButton({
  onDelete,
  label,
  description,
  iconOnly = false,
  undoable = false,
  deletedMessage,
}: Readonly<{
  onDelete: () => Promise<void> | Promise<UndoableResult>;
  label?: string;
  description?: string;
  // For tight row-of-icon-buttons contexts (settings list rows, income
  // event cards) sitting next to other icon-only actions (edit, pause) -
  // an icon+text "Supprimer" pill next to icon-only siblings reads as
  // visually inconsistent. Off by default: everywhere else in the app a
  // labeled destructive button is the clearer, safer default.
  iconOnly?: boolean;
  // An undoable deletion (v2.13; its action returns an undo token) skips the
  // confirmation dialog: it happens on the first click and a toast offers
  // "Annuler" - quicker, and safer than a dialog people learn to click
  // through. Everything else keeps the dialog, which irreversible and
  // security-sensitive deletions (revoking a key, a share, a co-owner) must:
  // undoing a revocation would re-grant access.
  undoable?: boolean;
  /** What the toast says once an undoable deletion is done. */
  deletedMessage?: string;
}>) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const t = useTranslations("common");
  const resolvedLabel = label ?? t("delete");

  const handleDelete = () => {
    startTransition(async () => {
      const result = await onDelete();
      setOpen(false);
      if (!result) return;
      if (!result.ok) {
        toast({ tone: "error", message: t("deleteFailed") });
        return;
      }
      offerUndo(deletedMessage ?? t("deleted"), result.data.undoToken, t, router.refresh);
    });
  };

  const trigger = (
    <Button
      variant="destructive"
      size="sm"
      aria-label={iconOnly ? resolvedLabel : undefined}
      disabled={pending}
      onClick={undoable ? handleDelete : undefined}
    >
      <Trash2 size={12} aria-hidden="true" />
      {!iconOnly && resolvedLabel}
    </Button>
  );

  if (undoable) return trigger;

  return (
    <Dialog open={open} onOpenChange={setOpen} title={t("confirmDelete")} trigger={trigger}>
      <div className="space-y-4">
        <div className="flex items-start gap-3 p-3 rounded-lg bg-[var(--negative)]/10 border border-[var(--negative)]/20">
          <AlertTriangle size={16} className="text-[var(--negative)] shrink-0 mt-0.5" aria-hidden="true" />
          <p className="text-sm text-[var(--foreground)]">
            {description ?? t("irreversible")}
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            {t("cancel")}
          </Button>
          <Button variant="destructive" onClick={handleDelete} disabled={pending}>
            <Trash2 size={12} aria-hidden="true" />
            {pending ? t("deleting") : t("delete")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
