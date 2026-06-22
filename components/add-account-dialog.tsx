"use client";

import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { createAccount } from "@/lib/actions/accounts";

const ACCOUNT_TYPES = [
  { value: "CHECKING", label: "Compte courant" },
  { value: "SAVINGS", label: "Épargne (Livret A, LEP…)" },
  { value: "INVESTMENT", label: "Compte-titres / PEA" },
  { value: "CRYPTO", label: "Crypto" },
  { value: "MEAL_VOUCHER", label: "Titres-restaurant" },
  { value: "REAL_ESTATE", label: "Immobilier" },
  { value: "AUTOMOBILE", label: "Automobile / Véhicule" },
];

type Institution = { id: string; name: string };

export function AddAccountDialog({
  institutions,
  defaultType,
}: {
  institutions: Institution[];
  defaultType?: string;
}) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState(defaultType ?? "CHECKING");
  const [pending, startTransition] = useTransition();

  const isRealEstate = type === "REAL_ESTATE";
  const isAutomobile = type === "AUTOMOBILE";
  const isManualValue = isRealEstate || isAutomobile;
  const isInvestment = type === "INVESTMENT" || type === "CRYPTO";
  const isPEACTO = type === "INVESTMENT";

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
      title="Ajouter un compte"
      trigger={
        <Button>
          <Plus size={14} aria-hidden="true" />
          Nouveau compte
        </Button>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Select
          label="Type"
          name="type"
          value={type}
          onChange={(e) => setType(e.target.value)}
          options={ACCOUNT_TYPES}
        />
        <Select
          label="Institution"
          name="institutionId"
          options={
            institutions.length
              ? institutions.map((i) => ({ value: i.id, label: i.name }))
              : [{ value: "", label: "— Aucune institution —" }]
          }
          disabled={!institutions.length}
        />
        <Input
          label="Nom du compte"
          name="name"
          placeholder={isAutomobile ? "Tesla Model 3" : isRealEstate ? "Résidence principale" : "Livret A"}
          required
        />
        {!isInvestment && (
          <Input
            label={isManualValue ? "Valeur estimée (€)" : "Solde initial (€)"}
            name="initialBalance"
            type="number"
            step="0.01"
            min="0"
            placeholder="0.00"
          />
        )}
        {isManualValue && (
          <Input
            label={isAutomobile ? "Crédit auto restant dû (€)" : "Capital restant dû / emprunt (€)"}
            name="liability"
            type="number"
            step="0.01"
            min="0"
            placeholder="0.00"
          />
        )}
        {isPEACTO && (
          <Select
            label="Type de compte"
            name="investmentSubtype"
            options={[
              { value: "", label: "— Non précisé —" },
              { value: "PEA", label: "PEA — taxe 17,2% (prélèvements sociaux)" },
              { value: "CTO", label: "CTO — taxe 31,4% sur les plus-values" },
            ]}
          />
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
          >
            Annuler
          </Button>
          <Button type="submit" disabled={pending || !institutions.length}>
            {pending ? "Création…" : "Créer"}
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
