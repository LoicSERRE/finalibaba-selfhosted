"use client";

import { useState, useTransition } from "react";
import { Plus, Pencil } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { createIncomeEvent, updateIncomeEvent } from "@/lib/actions/income";
import { useTranslations } from "next-intl";

type IncomeType = "DIVIDEND" | "INTEREST";

const DIVIDEND_ACCOUNT_TYPES = new Set(["INVESTMENT", "CRYPTO"]);
const INTEREST_ACCOUNT_TYPES = new Set(["CHECKING", "SAVINGS"]);

// Plain serializable initial values only - no BigInt across the RSC boundary.
// `id` present = editing an existing row; absent = creating.
export type IncomeInitial = {
  id?: string;
  type: IncomeType;
  accountId: string;
  ticker: string | null;
  amountEuro: string; // gross, e.g. "12.34"
  taxWithheldEuro: string | null;
  date: string; // YYYY-MM-DD
};

export function AddIncomeDialog({
  initial,
  accounts,
  trigger,
}: Readonly<{
  initial?: IncomeInitial;
  accounts: { id: string; name: string; type: string }[];
  trigger?: React.ReactNode;
}>) {
  const isEdit = !!initial?.id;
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [type, setType] = useState<IncomeType>(initial?.type ?? "DIVIDEND");
  const t = useTranslations("income");
  const tc = useTranslations("common");

  const relevantAccounts = accounts.filter((a) =>
    (type === "DIVIDEND" ? DIVIDEND_ACCOUNT_TYPES : INTEREST_ACCOUNT_TYPES).has(a.type)
  );

  function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    fd.set("type", type);
    startTransition(async () => {
      if (initial?.id) {
        await updateIncomeEvent(initial.id, fd);
      } else {
        await createIncomeEvent(fd);
        form.reset();
        setType("DIVIDEND");
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
        <div className="space-y-1.5">
          <span className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">{t("type")}</span>
          <div className="flex rounded-lg overflow-hidden border border-[var(--border)]">
            <button
              type="button"
              aria-pressed={type === "DIVIDEND"}
              onClick={() => setType("DIVIDEND")}
              className={`flex-1 py-2 min-h-[44px] text-xs font-medium cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)] ${
                type === "DIVIDEND" ? "bg-[var(--accent)]/15 text-[var(--accent-text)]" : "text-[var(--muted)] hover:text-[var(--foreground)]"
              }`}
            >
              {t("dividend")}
            </button>
            <button
              type="button"
              aria-pressed={type === "INTEREST"}
              onClick={() => setType("INTEREST")}
              className={`flex-1 py-2 min-h-[44px] text-xs font-medium cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)] ${
                type === "INTEREST" ? "bg-[var(--accent)]/15 text-[var(--accent-text)]" : "text-[var(--muted)] hover:text-[var(--foreground)]"
              }`}
            >
              {t("interest")}
            </button>
          </div>
        </div>

        <Select
          id="inc-account"
          label={t("account")}
          name="accountId"
          defaultValue={initial?.accountId}
          required
          options={[{ value: "", label: tc("selectAccount"), disabled: true }, ...relevantAccounts.map((a) => ({ value: a.id, label: a.name }))]}
        />

        {type === "DIVIDEND" && (
          <Input
            id="inc-ticker"
            label={t("ticker")}
            type="text"
            name="ticker"
            defaultValue={initial?.ticker ?? ""}
            placeholder="AAPL"
            maxLength={20}
          />
        )}

        <div className="grid grid-cols-2 gap-3">
          <Input
            id="inc-amount"
            label={t("amount")}
            type="text"
            inputMode="decimal"
            name="amount"
            defaultValue={initial?.amountEuro}
            placeholder="12.34"
            required
          />
          <Input
            id="inc-tax"
            label={t("taxWithheld")}
            type="text"
            inputMode="decimal"
            name="taxWithheld"
            defaultValue={initial?.taxWithheldEuro ?? ""}
            placeholder="1.85"
          />
        </div>

        <Input id="inc-date" label={t("date")} type="date" name="date" defaultValue={initial?.date} required />

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
