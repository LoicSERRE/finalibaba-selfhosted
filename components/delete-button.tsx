"use client";

import { useState, useTransition } from "react";
import { Trash2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";

export function DeleteButton({
  onDelete,
  label = "Supprimer",
  description,
}: {
  onDelete: () => Promise<void>;
  label?: string;
  description?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

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
      title="Confirmer la suppression"
      trigger={
        <Button variant="destructive" size="sm">
          <Trash2 size={12} aria-hidden="true" />
          {label}
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="flex items-start gap-3 p-3 rounded-lg bg-[var(--negative)]/10 border border-[var(--negative)]/20">
          <AlertTriangle size={16} className="text-[var(--negative)] shrink-0 mt-0.5" aria-hidden="true" />
          <p className="text-sm text-[var(--foreground)]">
            {description ?? "Cette action est irréversible."}
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Annuler
          </Button>
          <Button variant="destructive" onClick={handleDelete} disabled={pending}>
            <Trash2 size={12} aria-hidden="true" />
            {pending ? "Suppression…" : "Supprimer"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
