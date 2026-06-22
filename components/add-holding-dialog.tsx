"use client";

import { useState, useTransition } from "react";
import { Plus, Pencil } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { upsertHolding } from "@/lib/actions/holdings";

type Holding = {
  id: string;
  ticker: string;
  name: string | null;
  quantity: { toString(): string };
  lastPriceCents: bigint;
  costBasisCents: bigint | null;
};

export function AddHoldingDialog({
  accountId,
  accountName,
  existing,
}: {
  accountId: string;
  accountName: string;
  existing?: Holding;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const isEdit = !!existing;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      await upsertHolding(fd);
      setOpen(false);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title={isEdit ? `Modifier — ${existing.ticker}` : `Ajouter une position — ${accountName}`}
      trigger={
        isEdit ? (
          <Button variant="ghost" size="sm" aria-label="Modifier">
            <Pencil size={12} />
          </Button>
        ) : (
          <Button size="sm">
            <Plus size={14} />
            Position
          </Button>
        )
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <input type="hidden" name="accountId" value={accountId} />
        <Input
          label="Ticker / Symbole"
          name="ticker"
          placeholder="MSFT, BTC, ETH…"
          defaultValue={existing?.ticker}
          required
          readOnly={isEdit}
        />
        <Input
          label="Nom de l'actif"
          name="name"
          placeholder="Microsoft, Bitcoin…"
          defaultValue={existing?.name ?? ""}
        />
        <Input
          label="Quantité"
          name="quantity"
          type="number"
          step="any"
          min="0"
          placeholder="10"
          defaultValue={existing?.quantity.toString()}
          required
        />
        <Input
          label="Prix unitaire actuel (€)"
          name="price"
          type="number"
          step="0.01"
          min="0"
          placeholder="0.00"
          defaultValue={existing ? (Number(existing.lastPriceCents) / 100).toFixed(2) : ""}
          required
        />
        <Input
          label="Prix de revient total (€) — optionnel"
          name="costBasis"
          type="number"
          step="0.01"
          min="0"
          placeholder="Montant total investi, ex: 5000.00"
          defaultValue={
            existing?.costBasisCents != null
              ? (Number(existing.costBasisCents) / 100).toFixed(2)
              : ""
          }
        />
        <p className="text-xs text-[var(--muted)] -mt-2">
          Sert à calculer les plus-values et l&apos;impôt latent.
        </p>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Annuler
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Enregistrement…" : isEdit ? "Mettre à jour" : "Ajouter"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
