"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { bulkAssignCategory } from "@/lib/actions/transactions";
import { formatCurrency } from "@/lib/format";
import { useTranslations } from "next-intl";

const selectClass =
  "bg-[var(--surface-elevated)] border border-[var(--border)] rounded-lg px-2 py-1.5 text-xs text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)] cursor-pointer";

export function UncategorizedGroupCard({
  label,
  count,
  totalCents,
  transactionIds,
  categories,
}: {
  label: string;
  count: number;
  totalCents: number;
  transactionIds: string[];
  categories: { id: string; name: string; color: string }[];
}) {
  const [categoryId, setCategoryId] = useState("");
  const [pending, startTransition] = useTransition();
  const [applied, setApplied] = useState(false);
  const t = useTranslations("categories");

  function handleApply() {
    startTransition(async () => {
      await bulkAssignCategory(transactionIds, categoryId || null);
      setApplied(true);
    });
  }

  if (applied) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4">
      <div className="min-w-0">
        <p className="text-sm font-medium text-[var(--foreground)] truncate">{label}</p>
        <p className="text-xs text-[var(--muted)]">
          {t("occurrenceCount", { count, suffix: count !== 1 ? "s" : "" })} · {formatCurrency(totalCents)}
        </p>
      </div>
      <div className="flex items-center gap-2 w-full sm:w-auto">
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={`${selectClass} min-w-0 flex-1 sm:flex-initial`}>
          <option value="" disabled>
            {t("chooseCategory")}
          </option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <Button size="sm" onClick={handleApply} disabled={pending || !categoryId}>
          {t("apply")}
        </Button>
      </div>
    </div>
  );
}
