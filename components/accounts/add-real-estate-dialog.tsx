"use client";

import { useState, useTransition } from "react";
import { Home } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { createAccount } from "@/lib/actions/accounts";
import { useTranslations } from "next-intl";

type Institution = { id: string; name: string };

export function AddRealEstateDialog({ institutions }: { institutions: Institution[] }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const t = useTranslations("addRealEstate");
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
          <Home size={14} aria-hidden="true" />
          {t("trigger")}
        </Button>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <input type="hidden" name="type" value="REAL_ESTATE" />

        <Select
          label={t("institution")}
          name="institutionId"
          options={
            institutions.length
              ? institutions.map((i) => ({ value: i.id, label: i.name }))
              : [{ value: "", label: t("noInstitution") }]
          }
          disabled={!institutions.length}
        />

        <Input
          label={t("name")}
          name="name"
          placeholder="Appartement Paris 11e, Résidence principale…"
          required
        />

        <div className="grid grid-cols-2 gap-3">
          <Input
            label={t("value")}
            name="initialBalance"
            type="number"
            step="0.01"
            min="0"
            placeholder="250000"
          />
          <Input
            label={t("liability")}
            name="liability"
            type="number"
            step="0.01"
            min="0"
            placeholder="0"
          />
        </div>

        <p className="text-xs text-[var(--muted)]">{t("tip")}</p>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            {tc("cancel")}
          </Button>
          <Button type="submit" disabled={pending || !institutions.length}>
            {pending ? t("creating") : t("submit")}
          </Button>
        </div>

        {!institutions.length && (
          <p className="text-xs text-[var(--negative)] text-center">{t("addFirst")}</p>
        )}
      </form>
    </Dialog>
  );
}
