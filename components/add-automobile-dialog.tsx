"use client";

import { useState, useTransition } from "react";
import { Car } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { createAccount } from "@/lib/actions/accounts";

type Institution = { id: string; name: string };

export function AddAutomobileDialog({ institutions }: { institutions: Institution[] }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      await createAccount(fd);
      setOpen(false);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title="Ajouter un véhicule"
      trigger={
        <Button>
          <Car size={14} aria-hidden="true" />
          Ajouter un véhicule
        </Button>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <input type="hidden" name="type" value="AUTOMOBILE" />

        <Select
          label="Organisme (optionnel)"
          name="institutionId"
          options={[
            { value: "", label: "— Comptant / aucun —" },
            ...institutions.map((i) => ({ value: i.id, label: i.name })),
          ]}
        />

        <Input
          label="Nom du véhicule"
          name="name"
          placeholder="Tesla Model 3, Renault Clio…"
          required
        />

        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Prix d'achat (€)"
            name="purchasePrice"
            type="number"
            step="0.01"
            min="0"
            placeholder="25 000"
          />
          <Input
            label="Valeur actuelle estimée (€)"
            name="initialBalance"
            type="number"
            step="0.01"
            min="0"
            placeholder="18 000"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Crédit auto restant dû (€)"
            name="liability"
            type="number"
            step="0.01"
            min="0"
            placeholder="0 si comptant"
          />
          <Input
            label="Assurance mensuelle (€)"
            name="insuranceMonthly"
            type="number"
            step="0.01"
            min="0"
            placeholder="ex : 45"
          />
        </div>

        <p className="text-xs text-[var(--muted)]">
          Le prix d&apos;achat sert à calculer la dépréciation. La valeur actuelle est à mettre à jour manuellement (argus, estimation…).
        </p>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Annuler
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Création…" : "Ajouter"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
