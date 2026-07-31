"use client";

import { useState, useTransition } from "react";
import { Car } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { createAccount } from "@/lib/actions/accounts";
import { useTranslations } from "next-intl";

type Institution = { id: string; name: string };

export function AddAutomobileDialog({ institutions }: { institutions: Institution[] }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const t = useTranslations("addAutomobile");
  const tc = useTranslations("common");

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
      title={t("title")}
      trigger={
        <Button>
          <Car size={14} aria-hidden="true" />
          {t("trigger")}
        </Button>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <input type="hidden" name="type" value="AUTOMOBILE" />

        <Select
          label={t("institution")}
          name="institutionId"
          options={[
            { value: "", label: t("noOrganization") },
            ...institutions.map((i) => ({ value: i.id, label: i.name })),
          ]}
        />

        <Input
          label={t("name")}
          name="name"
          placeholder="Tesla Model 3, Renault Clio…"
          required
        />

        <div className="grid grid-cols-2 gap-3">
          <Input
            label={t("purchasePrice")}
            name="purchasePrice"
            type="number"
            step="0.01"
            min="0"
            placeholder="25000"
          />
          <Input
            label={t("value")}
            name="initialBalance"
            type="number"
            step="0.01"
            min="0"
            placeholder="18000"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Input
            label={t("financing")}
            name="liability"
            type="number"
            step="0.01"
            min="0"
            placeholder="0"
          />
          <Input
            label={t("insuranceMonthly")}
            name="insuranceMonthly"
            type="number"
            step="0.01"
            min="0"
            placeholder="45"
          />
        </div>

        <p className="text-xs text-[var(--muted)]">{t("tip")}</p>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            {tc("cancel")}
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? t("creating") : t("submit")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
