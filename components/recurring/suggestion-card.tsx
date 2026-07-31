"use client";

import { useTransition } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AddRecurringDialog, type RecurringInitial } from "@/components/add-recurring-dialog";
import { dismissSuggestion } from "@/lib/actions/recurring";
import { formatCurrency } from "@/lib/format";
import { useTranslations } from "next-intl";

type Frequency = "WEEKLY" | "MONTHLY" | "YEARLY";

type Candidate = {
  accountId: string;
  accountName: string;
  label: string;
  amountCents: number;
  frequency: Frequency;
  anchorDate: string; // YYYY-MM-DD
  categoryId: string | null;
};

export function SuggestionCard({
  candidate,
  accounts,
  categories,
}: {
  candidate: Candidate;
  accounts: { id: string; name: string }[];
  categories: { id: string; name: string; color: string }[];
}) {
  const [pending, startTransition] = useTransition();
  const t = useTranslations("recurring");

  const initial: RecurringInitial = {
    label: candidate.label,
    amountEuro: (Math.abs(candidate.amountCents) / 100).toFixed(2),
    type: candidate.amountCents >= 0 ? "income" : "expense",
    frequency: candidate.frequency,
    intervalCount: 1,
    anchorDate: candidate.anchorDate,
    categoryId: candidate.categoryId,
    accountId: candidate.accountId,
    autoDetected: true,
  };

  function handleDismiss() {
    startTransition(async () => {
      await dismissSuggestion({
        accountId: candidate.accountId,
        label: candidate.label,
        amountCents: candidate.amountCents,
        frequency: candidate.frequency,
        anchorDate: candidate.anchorDate,
      });
    });
  }

  return (
    <div className="flex items-center justify-between gap-3 bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4">
      <div className="min-w-0">
        <p className="text-sm font-medium text-[var(--foreground)] truncate">{candidate.label}</p>
        <p className="text-xs text-[var(--muted)]">
          {candidate.accountName} · {t(candidate.frequency.toLowerCase())} · {formatCurrency(candidate.amountCents)}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <AddRecurringDialog
          initial={initial}
          accounts={accounts}
          categories={categories}
          trigger={<Button size="sm">{t("add")}</Button>}
        />
        <Button variant="outline" size="sm" onClick={handleDismiss} disabled={pending} aria-label={t("dismiss")}>
          <X size={12} aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
