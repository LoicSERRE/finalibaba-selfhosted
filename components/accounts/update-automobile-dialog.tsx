"use client";

import { useState, useTransition } from "react";
import { Pencil } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateAutomobileAccount } from "@/lib/actions/accounts";
import { useTranslations } from "next-intl";

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
  const t = useTranslations("updateAutomobile");
  const tc = useTranslations("common");

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
      title={t("title", { name })}
      trigger={
        <Button variant="outline" size="sm">
          <Pencil size={12} aria-hidden="true" />
          {tc("edit")}
        </Button>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <input type="hidden" name="id" value={id} />
        <Input
          label={t("value")}
          name="value"
          type="number"
          step="0.01"
          min="0"
          defaultValue={(Number(valueCents) / 100).toFixed(2)}
          required
        />
        <Input
          label={t("liability")}
          name="liability"
          type="number"
          step="0.01"
          min="0"
          defaultValue={(Number(liabilityCents) / 100).toFixed(2)}
        />
        <Input
          label={t("insurance")}
          name="insuranceMonthly"
          type="number"
          step="0.01"
          min="0"
          defaultValue={insuranceMonthlyCents > BigInt(0) ? (Number(insuranceMonthlyCents) / 100).toFixed(2) : ""}
          placeholder="ex : 45"
        />
        <p className="text-xs text-[var(--muted)]">{t("tip")}</p>
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
