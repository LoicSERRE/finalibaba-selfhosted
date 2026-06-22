"use client";

import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createInstitution } from "@/lib/actions/institutions";

export function AddInstitutionDialog() {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      await createInstitution(fd);
      setOpen(false);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title="Ajouter une institution"
      trigger={
        <Button>
          <Plus size={14} />
          Nouvelle institution
        </Button>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Nom"
          name="name"
          placeholder="LCL, Trade Republic, Revolut…"
          required
        />
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Annuler
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Création…" : "Créer"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
