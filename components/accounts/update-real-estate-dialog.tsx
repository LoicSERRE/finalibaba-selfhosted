"use client";

import { useState, useTransition } from "react";
import { Pencil } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateRealEstateAccount } from "@/lib/actions/accounts";
import { useTranslations } from "next-intl";

export function UpdateRealEstateDialog({
  id,
  name,
  valueCents,
  liabilityCents,
}: {
  id: string;
  name: string;
  valueCents: bigint;
  liabilityCents: bigint;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const t = useTranslations("updateRealEstate");
  const tc = useTranslations("common");

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      await updateRealEstateAccount(fd);
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
