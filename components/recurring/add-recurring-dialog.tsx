"use client";

import { useState, useTransition } from "react";
import { Plus, Pencil } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { createRecurringTransaction, updateRecurringTransaction } from "@/lib/actions/recurring";
import { useTranslations } from "next-intl";

type Frequency = "WEEKLY" | "MONTHLY" | "YEARLY";

// Plain serializable initial values only - no BigInt across the RSC boundary.
// `id` present = editing an existing row; absent = creating (possibly
// pre-filled from a detected suggestion, in which case `autoDetected` is set).
export type RecurringInitial = {
  id?: string;
  label: string;
  amountEuro: string; // absolute value, e.g. "16.00"
  type: "income" | "expense";
  frequency: Frequency;
  intervalCount: number;
  anchorDate: string; // YYYY-MM-DD
  categoryId: string | null;
  accountId: string;
  autoDetected?: boolean;
};

export function AddRecurringDialog({
  initial,
  accounts,
  categories,
  trigger,
}: {
  initial?: RecurringInitial;
  accounts: { id: string; name: string }[];
  categories: { id: string; name: string; color: string }[];
  trigger?: React.ReactNode;
}) {
  const isEdit = !!initial?.id;
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [type, setType] = useState<"income" | "expense">(initial?.type ?? "expense");
  const t = useTranslations("recurring");
  const tc = useTranslations("common");

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    fd.set("type", type);
    startTransition(async () => {
      if (initial?.id) {
        await updateRecurringTransaction(initial.id, fd);
      } else {
        await createRecurringTransaction(fd);
        form.reset();
        setType("expense");
      }
      setOpen(false);
    });
  }

  const defaultTrigger = isEdit ? (
    <Button variant="outline" size="sm" aria-label={tc("edit")}>
      <Pencil size={12} aria-hidden="true" />
    </Button>
  ) : (
    <Button>
      <Plus size={14} aria-hidden="true" />
      {t("create")}
    </Button>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title={isEdit ? t("edit") : t("create")}
      trigger={trigger ?? defaultTrigger}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {initial?.autoDetected && <input type="hidden" name="autoDetected" value="true" />}

        <Input id="rec-label" label={t("label")} type="text" name="label" defaultValue={initial?.label} required maxLength={200} />

        <Select
          id="rec-account"
          label={t("account")}
          name="accountId"
          defaultValue={initial?.accountId}
          required
          options={[{ value: "", label: tc("selectAccount"), disabled: true }, ...accounts.map((a) => ({ value: a.id, label: a.name }))]}
        />

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">{t("amount")}</span>
            <div className="flex rounded-lg overflow-hidden border border-[var(--border)]">
              <button
                type="button"
                aria-pressed={type === "expense"}
                onClick={() => setType("expense")}
                className={`flex-1 py-2 min-h-[44px] text-xs font-medium cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)] ${
                  type === "expense" ? "bg-[var(--negative)]/15 text-[var(--negative)]" : "text-[var(--muted)] hover:text-[var(--foreground)]"
                }`}
              >
                {t("expense")}
              </button>
              <button
                type="button"
                aria-pressed={type === "income"}
                onClick={() => setType("income")}
                className={`flex-1 py-2 min-h-[44px] text-xs font-medium cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)] ${
                  type === "income" ? "bg-[var(--positive)]/15 text-[var(--positive)]" : "text-[var(--muted)] hover:text-[var(--foreground)]"
                }`}
              >
                {t("income")}
              </button>
            </div>
          </div>
          <Input
            id="rec-amount"
            label="€"
            type="text"
            inputMode="decimal"
            name="amount"
            defaultValue={initial?.amountEuro}
            placeholder="15.99"
            required
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Select
            id="rec-frequency"
            label={t("frequency")}
            name="frequency"
            defaultValue={initial?.frequency ?? "MONTHLY"}
            options={[
              { value: "WEEKLY", label: t("weekly") },
              { value: "MONTHLY", label: t("monthly") },
              { value: "YEARLY", label: t("yearly") },
            ]}
          />
          <Input
            id="rec-interval"
            label={t("every")}
            type="number"
            name="intervalCount"
            min={1}
            max={99}
            defaultValue={initial?.intervalCount ?? 1}
          />
        </div>

        <Input id="rec-anchor" label={t("anchorDate")} type="date" name="anchorDate" defaultValue={initial?.anchorDate} required />

        <Select
          id="rec-category"
          label={tc("optional")}
          name="categoryId"
          defaultValue={initial?.categoryId ?? ""}
          options={[{ value: "", label: "-" }, ...categories.map((c) => ({ value: c.id, label: c.name }))]}
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
