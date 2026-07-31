"use client";

import { useState, useTransition } from "react";
import { CreditCard } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { createAccount } from "@/lib/actions/accounts";
import { useTranslations } from "next-intl";

type Institution = { id: string; name: string };

export function AddLoanDialog({ institutions }: { institutions: Institution[] }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const t = useTranslations("addLoan");
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
          <CreditCard size={14} aria-hidden="true" />
          {t("trigger")}
        </Button>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <input type="hidden" name="type" value="LOAN" />

        <Input
          label={t("name")}
          name="name"
          placeholder="Crédit étudiant, Prêt perso…"
          required
        />

        <Select
          label={t("institution")}
          name="institutionId"
          options={[
            { value: "", label: t("noOrganization") },
            ...institutions.map((i) => ({ value: i.id, label: i.name })),
          ]}
        />

        <div className="grid grid-cols-2 gap-3">
          <Input
            label={t("amount")}
            name="loanAmount"
            type="number"
            step="0.01"
            min="0"
            placeholder="15000"
            required
          />
          <Input
            label={t("rate")}
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
            label={t("duration")}
            name="loanDurationMonths"
            type="number"
            step="1"
            min="1"
            placeholder="84"
            required
          />
          <Input
            label={t("deferral")}
            name="loanDeferralMonths"
            type="number"
            step="1"
            min="0"
            placeholder="0"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Input
            label={t("start")}
            name="loanStartDate"
            type="date"
            required
          />
          <Input
            label={t("insurance")}
            name="insuranceMonthly"
            type="number"
            step="0.01"
            min="0"
            placeholder="12"
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
