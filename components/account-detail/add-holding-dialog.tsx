"use client";

import { useState, useTransition } from "react";
import { Plus, Pencil } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { upsertHolding } from "@/lib/actions/holdings";
import { useTranslations } from "next-intl";

const CURRENCIES = ["EUR", "USD", "GBP", "CHF"];

type Holding = {
  id: string;
  ticker: string;
  name: string | null;
  quantity: { toString(): string };
  lastPriceCents: bigint;
  costBasisCents: bigint | null;
  targetPct: number | null;
  currency: string;
  nativePriceCents: bigint | null;
  nativeCostBasisCents: bigint | null;
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
  const t = useTranslations("addHolding");
  const tc = useTranslations("common");
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
      title={isEdit ? t("editTitle", { ticker: existing.ticker }) : t("addTitle", { name: accountName })}
      trigger={
        isEdit ? (
          <Button variant="ghost" size="sm" aria-label={t("editAriaLabel")}>
            <Pencil size={12} aria-hidden="true" />
          </Button>
        ) : (
          <Button size="sm">
            <Plus size={14} aria-hidden="true" />
            {t("position")}
          </Button>
        )
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <input type="hidden" name="accountId" value={accountId} />
        <Input
          label={t("ticker")}
          name="ticker"
          placeholder="MSFT, BTC, ETH…"
          defaultValue={existing?.ticker}
          required
          readOnly={isEdit}
        />
        <Input
          label={t("name")}
          name="name"
          placeholder="Microsoft, Bitcoin…"
          defaultValue={existing?.name ?? ""}
        />
        <Input
          label={t("qty")}
          name="quantity"
          type="number"
          step="any"
          min="0"
          placeholder="10"
          defaultValue={existing?.quantity.toString()}
          required
        />
        <Select
          label={t("currency")}
          name="currency"
          defaultValue={existing?.currency ?? "EUR"}
          options={CURRENCIES.map((c) => ({ value: c, label: c }))}
        />
        <Input
          label={t("price")}
          name="price"
          type="number"
          step="0.01"
          min="0"
          placeholder="0.00"
          defaultValue={
            existing
              ? (Number(existing.nativePriceCents ?? existing.lastPriceCents) / 100).toFixed(2)
              : ""
          }
          required
        />
        <Input
          label={t("costBasis")}
          name="costBasis"
          type="number"
          step="0.01"
          min="0"
          placeholder={t("costBasisPlaceholder")}
          defaultValue={
            existing && (existing.nativeCostBasisCents ?? existing.costBasisCents) != null
              ? (Number(existing.nativeCostBasisCents ?? existing.costBasisCents) / 100).toFixed(2)
              : ""
          }
        />
        <p className="text-xs text-[var(--muted)] -mt-2">{t("nativeAmountHint")}</p>
        <p className="text-xs text-[var(--muted)] -mt-2">{t("taxHint")}</p>
        <Input
          label={t("targetPct")}
          name="targetPct"
          type="number"
          step="0.1"
          min="0"
          max="100"
          placeholder={t("targetPctPlaceholder")}
          defaultValue={existing?.targetPct != null ? (existing.targetPct * 100).toFixed(1) : ""}
        />
        <p className="text-xs text-[var(--muted)] -mt-2">{t("targetPctHint")}</p>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            {tc("cancel")}
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? tc("saving") : isEdit ? t("update") : t("submit")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
