"use client";

import { useState, useTransition } from "react";
import { CreditCard } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { createAccount } from "@/lib/actions/accounts";

type Institution = { id: string; name: string };

export function AddLoanDialog({ institutions }: { institutions: Institution[] }) {
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
      title="Ajouter un crédit"
      trigger={
        <Button>
          <CreditCard size={14} />
          Ajouter un crédit
        </Button>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <input type="hidden" name="type" value="LOAN" />

        <Input
          label="Nom du crédit"
          name="name"
          placeholder="Crédit étudiant, Prêt perso…"
          required
        />

        <Select
          label="Organisme prêteur (optionnel)"
          name="institutionId"
          options={[
            { value: "", label: "— Non précisé —" },
            ...institutions.map((i) => ({ value: i.id, label: i.name })),
          ]}
        />

        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Montant emprunté (€)"
            name="loanAmount"
            type="number"
            step="0.01"
            min="0"
            placeholder="15 000"
            required
          />
          <Input
            label="TAEG (%)"
            name="loanTaeg"
            type="number"
            step="0.001"
            min="0"
            placeholder="5.47"
            required
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Durée totale (mois)"
            name="loanDurationMonths"
            type="number"
            step="1"
            min="1"
            placeholder="84"
            required
          />
          <Input
            label="Différé total (mois)"
            name="loanDeferralMonths"
            type="number"
            step="1"
            min="0"
            placeholder="0"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Date de début"
            name="loanStartDate"
            type="date"
            required
          />
          <Input
            label="Assurance mensuelle (€)"
            name="insuranceMonthly"
            type="number"
            step="0.01"
            min="0"
            placeholder="ex : 12"
          />
        </div>

        <p className="text-xs text-[var(--muted)]">
          Le capital restant dû sera calculé automatiquement à partir du TAEG et de la date de début. Le différé total = période pendant laquelle on ne rembourse que les intérêts.
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
