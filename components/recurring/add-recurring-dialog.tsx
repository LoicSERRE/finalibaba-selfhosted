"use client";

import { useState, useTransition } from "react";
import { Plus, Pencil } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { createRecurringTransaction, updateRecurringTransaction } from "@/lib/actions/recurring";
import { useTranslations } from "next-intl";
import { MAX_INTERVAL_COUNT } from "@/lib/domain/recurring";

type Frequency = "WEEKLY" | "MONTHLY" | "YEARLY";

const INTERVAL_HINT_KEY: Record<Frequency, string> = {
  WEEKLY: "intervalHintWeekly",
  MONTHLY: "intervalHint",
  YEARLY: "intervalHintYearly",
};

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
  /** Regular cadence, varying amount - a salary, a benefit, a dividend. */
  amountVaries?: boolean;
};

export function AddRecurringDialog({
  initial,
  accounts,
  categories,
  trigger,
}: Readonly<{
  initial?: RecurringInitial;
  accounts: { id: string; name: string }[];
  categories: { id: string; name: string; color: string }[];
  trigger?: React.ReactNode;
}>) {
  const isEdit = !!initial?.id;
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [type, setType] = useState<"income" | "expense">(initial?.type ?? "expense");
  const [frequency, setFrequency] = useState<Frequency>(initial?.frequency ?? "MONTHLY");
  const t = useTranslations("recurring");
  const tc = useTranslations("common");

  function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
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
        setFrequency("MONTHLY");
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
        {/* Carried through the form or confirming the suggestion would lose it,
            and isMissed would then compare a varying salary against a median. */}
        {initial?.amountVaries && <input type="hidden" name="amountVaries" value="true" />}

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
                  type === "expense" ? "bg-[var(--negative)]/15 text-[var(--negative-text)]" : "text-[var(--muted)] hover:text-[var(--foreground)]"
                }`}
              >
                {t("expense")}
              </button>
              <button
                type="button"
                aria-pressed={type === "income"}
                onClick={() => setType("income")}
                className={`flex-1 py-2 min-h-[44px] text-xs font-medium cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)] ${
                  type === "income" ? "bg-[var(--positive)]/15 text-[var(--positive-text)]" : "text-[var(--muted)] hover:text-[var(--foreground)]"
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
            value={frequency}
            onChange={(e) => setFrequency(e.target.value as Frequency)}
            options={[
              { value: "WEEKLY", label: t("weekly") },
              { value: "MONTHLY", label: t("monthly") },
              { value: "YEARLY", label: t("yearly") },
            ]}
          />
          {/* The unit sits beside the number on purpose: without it, "Tous
              les [5]" read as "on the 5th of the month", and a monthly series
              became "every 5 months" without anyone noticing. */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="rec-interval" className="text-sm font-medium text-[var(--foreground)]">
              {t("intervalLabel")}
            </label>
            <div className="flex items-center gap-2">
              <input
                id="rec-interval"
                type="number"
                name="intervalCount"
                min={1}
                max={MAX_INTERVAL_COUNT[frequency]}
                defaultValue={initial?.intervalCount ?? 1}
                required
                aria-describedby="rec-interval-hint"
                className="w-20 min-h-11 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              />
              <span className="text-sm text-[var(--muted)]">{t(`intervalUnit.${frequency}`)}</span>
            </div>
          </div>
        </div>
        <p id="rec-interval-hint" className="text-xs text-[var(--muted)] -mt-1">
          {t(INTERVAL_HINT_KEY[frequency])}
        </p>

        <Input id="rec-anchor" label={t("anchorDate")} hint={t("anchorHint")} type="date" name="anchorDate" defaultValue={initial?.anchorDate} required />

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
