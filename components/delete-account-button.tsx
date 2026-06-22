"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { deleteAccount } from "@/lib/actions/accounts";

export function DeleteAccountButton({
  id,
  name,
  backHref,
}: {
  id: string;
  name: string;
  backHref: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const handleDelete = () => {
    startTransition(async () => {
      await deleteAccount(id);
      setOpen(false);
      router.push(backHref);
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title="Supprimer ce compte ?"
      trigger={
        <Button variant="destructive" size="sm">
          <Trash2 size={12} aria-hidden="true" />
          Supprimer
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="flex items-start gap-3 p-3 rounded-lg bg-[var(--negative)]/10 border border-[var(--negative)]/20">
          <AlertTriangle size={16} className="text-[var(--negative)] shrink-0 mt-0.5" aria-hidden="true" />
          <p className="text-sm text-[var(--foreground)]">
            Le compte <strong>&laquo;{name}&raquo;</strong> et tout son historique (soldes, transactions) seront définitivement supprimés.
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Annuler
          </Button>
          <Button variant="destructive" onClick={handleDelete} disabled={pending}>
            <Trash2 size={12} aria-hidden="true" />
            {pending ? "Suppression…" : "Supprimer définitivement"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
