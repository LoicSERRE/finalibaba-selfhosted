"use client";

import { useState, useTransition } from "react";
import { Home } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { createAccount } from "@/lib/actions/accounts";

type Institution = { id: string; name: string };

export function AddRealEstateDialog({ institutions }: { institutions: Institution[] }) {
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
      title="Ajouter un bien immobilier"
      trigger={
        <Button>
          <Home size={14} />
          Ajouter un bien
        </Button>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <input type="hidden" name="type" value="REAL_ESTATE" />

        <Select
          label="Institution / Organisme"
          name="institutionId"
          options={
            institutions.length
              ? institutions.map((i) => ({ value: i.id, label: i.name }))
              : [{ value: "", label: "— Aucune institution —" }]
          }
          disabled={!institutions.length}
        />

        <Input
          label="Nom du bien"
          name="name"
          placeholder="Appartement Paris 11e, Résidence principale…"
          required
        />

        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Valeur estimée (€)"
            name="initialBalance"
            type="number"
            step="0.01"
            min="0"
            placeholder="250 000"
          />
          <Input
            label="Capital restant dû (€)"
            name="liability"
            type="number"
            step="0.01"
            min="0"
            placeholder="0 si sans crédit"
          />
        </div>

        <p className="text-xs text-[var(--muted)]">
          La valeur estimée est à mettre à jour manuellement (estimation marché, Meilleurs Agents…).
        </p>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Annuler
          </Button>
          <Button type="submit" disabled={pending || !institutions.length}>
            {pending ? "Création…" : "Ajouter"}
          </Button>
        </div>

        {!institutions.length && (
          <p className="text-xs text-[var(--negative)] text-center">
            Ajoutez d&apos;abord une institution dans Paramètres.
          </p>
        )}
      </form>
    </Dialog>
  );
}
