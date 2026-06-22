"use client";

import { useState, useTransition } from "react";
import { Pencil } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateAutomobileAccount } from "@/lib/actions/accounts";

export function UpdateAutomobileDialog({
  id,
  name,
  valueCents,
  liabilityCents,
  insuranceMonthlyCents = BigInt(0),
}: {
  id: string;
  name: string;
  valueCents: bigint;
  liabilityCents: bigint;
  insuranceMonthlyCents?: bigint;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      await updateAutomobileAccount(fd);
      setOpen(false);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title={`Mettre à jour — ${name}`}
      trigger={
        <Button variant="outline" size="sm">
          <Pencil size={12} aria-hidden="true" />
          Mettre à jour
        </Button>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <input type="hidden" name="id" value={id} />
        <Input
          label="Valeur actuelle estimée (€)"
          name="value"
          type="number"
          step="0.01"
          min="0"
          defaultValue={(Number(valueCents) / 100).toFixed(2)}
          required
        />
        <Input
          label="Crédit auto restant dû (€)"
          name="liability"
          type="number"
          step="0.01"
          min="0"
          defaultValue={(Number(liabilityCents) / 100).toFixed(2)}
        />
        <Input
          label="Assurance mensuelle (€)"
          name="insuranceMonthly"
          type="number"
          step="0.01"
          min="0"
          defaultValue={insuranceMonthlyCents > BigInt(0) ? (Number(insuranceMonthlyCents) / 100).toFixed(2) : ""}
          placeholder="ex : 45"
        />
        <p className="text-xs text-[var(--muted)]">
          Consultez l&apos;argus ou une estimation récente pour la valeur actuelle.
        </p>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Annuler
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Enregistrement…" : "Enregistrer"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
