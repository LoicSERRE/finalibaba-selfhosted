"use client";

import { useState, useTransition } from "react";
import { Banknote } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { recordSale } from "@/lib/actions/sales";
import { formatCurrency } from "@/lib/utils/format";
import { useTranslations } from "next-intl";

type Holding = {
  ticker: string;
  quantity: { toString(): string };
  costBasisCents: bigint | null;
};

export function SellHoldingDialog({ accountId, holding }: Readonly<{ accountId: string; holding: Holding }>) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [quantitySold, setQuantitySold] = useState("");
  const [proceeds, setProceeds] = useState("");
  const [costBasis, setCostBasis] = useState("");
  const t = useTranslations("sellHolding");
  const tc = useTranslations("common");

  const holdingQty = Number.parseFloat(holding.quantity.toString()) || 0;
  const holdingCostBasisEuro = holding.costBasisCents != null ? Number(holding.costBasisCents) / 100 : null;

  function handleQuantityChange(value: string) {
    setQuantitySold(value);
    if (holdingCostBasisEuro !== null && holdingQty > 0) {
      const qty = Number.parseFloat(value) || 0;
      setCostBasis(((holdingCostBasisEuro * qty) / holdingQty).toFixed(2));
    }
  }

  const gainCents = Math.round((Number.parseFloat(proceeds) || 0) * 100) - Math.round((Number.parseFloat(costBasis) || 0) * 100);
  const showGain = proceeds.trim() !== "" && costBasis.trim() !== "";

  function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      await recordSale(fd);
      setOpen(false);
      setQuantitySold("");
      setProceeds("");
      setCostBasis("");
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title={t("title", { ticker: holding.ticker })}
      trigger={
        <Button variant="ghost" size="sm" aria-label={t("trigger")}>
          <Banknote size={12} aria-hidden="true" />
        </Button>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <input type="hidden" name="accountId" value={accountId} />
        <input type="hidden" name="ticker" value={holding.ticker} />
        <Input
          label={t("quantitySold", { available: holding.quantity.toString() })}
          name="quantitySold"
          type="number"
          step="any"
          min="0"
          max={holdingQty || undefined}
          placeholder="10"
          value={quantitySold}
          onChange={(e) => handleQuantityChange(e.target.value)}
          required
        />
        <Input
          label={t("proceeds")}
          name="proceeds"
          type="number"
          step="0.01"
          min="0"
          placeholder="0.00"
          value={proceeds}
          onChange={(e) => setProceeds(e.target.value)}
          required
        />
        <Input
          label={t("costBasis")}
          name="costBasis"
          type="number"
          step="0.01"
          min="0"
          placeholder="0.00"
          value={costBasis}
          onChange={(e) => setCostBasis(e.target.value)}
          required
        />
        <Input label={t("date")} name="date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required />
        {showGain && (
          <p className="text-sm">
            {t("gainPreview")}{" "}
            <span className={`font-semibold tabular-nums ${gainCents >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>
              {gainCents >= 0 ? "+" : ""}
              {formatCurrency(gainCents)}
            </span>
          </p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            {tc("cancel")}
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? tc("saving") : t("submit")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
