"use client";

import { useState, useTransition } from "react";
import { Trash2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useTranslations } from "next-intl";

export function DeleteButton({
  onDelete,
  label,
  description,
  iconOnly = false,
}: Readonly<{
  onDelete: () => Promise<void>;
  label?: string;
  description?: string;
  // For tight row-of-icon-buttons contexts (settings list rows, income
  // event cards) sitting next to other icon-only actions (edit, pause) -
  // an icon+text "Supprimer" pill next to icon-only siblings reads as
  // visually inconsistent. Off by default: everywhere else in the app a
  // labeled destructive button is the clearer, safer default.
  iconOnly?: boolean;
}>) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const t = useTranslations("common");
  const resolvedLabel = label ?? t("delete");

  const handleDelete = () => {
    startTransition(async () => {
      await onDelete();
      setOpen(false);
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title={t("confirmDelete")}
      trigger={
        <Button variant="destructive" size="sm" aria-label={iconOnly ? resolvedLabel : undefined}>
          <Trash2 size={12} aria-hidden="true" />
          {!iconOnly && resolvedLabel}
        </Button>
      }
    >
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
