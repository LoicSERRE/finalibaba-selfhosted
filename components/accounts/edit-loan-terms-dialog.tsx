"use client";

import { useState, useTransition } from "react";
import { Pencil } from "lucide-react";
import { useTranslations } from "next-intl";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateLoanTerms } from "@/lib/actions/loans";
import type { LoanTermsValues } from "@/lib/domain/loan-terms";

// Per-field readonly: a Readonly<{...}> props type hides the component from
// lizard (scripts/lizard-blind-spots.py).
type Props = {
  readonly accountId: string;
  readonly values: LoanTermsValues;
  /** The bank reports this loan: the intro says what stays the bank's. */
  readonly bankReported: boolean;
};

const ERROR_KEY: Record<string, string> = {
  invalid_amount: "errorAmount",
  invalid_rate: "errorRate",
  invalid_duration: "errorDuration",
  invalid_deferral: "errorDeferral",
  invalid_insurance: "errorInsurance",
  invalid_date: "errorDate",
};

/**
 * A loan's contract terms, editable (v2.19.2): what a bank never sends and
 * what it may get wrong. Every field may be left empty; on a bank-reported
 * loan an emptied field is filled again by the next sync.
 */
export function EditLoanTermsDialog({ accountId, values, bankReported }: Props) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const t = useTranslations("loanTerms");
  const tc = useTranslations("common");

  function handleSubmit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setError(null);
    startTransition(async () => {
      const result = await updateLoanTerms(accountId, formData);
      if (!result.ok) {
        setError(t(ERROR_KEY[result.error] ?? "errorUnexpected"));
        return;
      }
      setOpen(false);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError(null);
      }}
      title={t("title")}
      trigger={
        <Button variant="outline" size="sm" aria-label={t("trigger")}>
          <Pencil size={12} aria-hidden="true" />
          <span>{t("trigger")}</span>
        </Button>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-xs text-[var(--muted)]">{bankReported ? t("introBank") : t("introManual")}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input label={t("amount")} name="amount" inputMode="decimal" defaultValue={values.amount} placeholder="5000" />
          <Input label={t("rate")} name="rate" inputMode="decimal" defaultValue={values.rate} placeholder="0,99" />
          <Input label={t("startDate")} name="startDate" type="date" defaultValue={values.startDate} />
          <Input label={t("endDate")} name="endDate" type="date" defaultValue={values.endDate} />
          <Input label={t("durationMonths")} name="durationMonths" inputMode="numeric" defaultValue={values.durationMonths} placeholder="72" />
          <Input label={t("deferralMonths")} name="deferralMonths" inputMode="numeric" defaultValue={values.deferralMonths} placeholder="24" />
          <Input label={t("insurance")} name="insurance" inputMode="decimal" defaultValue={values.insurance} placeholder="0" />
        </div>
        <label className="flex items-start gap-3 text-sm text-[var(--foreground)] cursor-pointer">
          <input
            type="checkbox"
            name="fundsOnAccounts"
            defaultChecked={values.fundsOnAccounts}
            className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]"
          />
          <span>
            {t("fundsOnAccounts")}
            <span className="block text-xs text-[var(--muted)] mt-0.5">{t("fundsOnAccountsHint")}</span>
          </span>
        </label>
        {error && (
          <p role="alert" className="text-xs text-[var(--negative)]">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            {tc("cancel")}
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? tc("saving") : tc("save")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
