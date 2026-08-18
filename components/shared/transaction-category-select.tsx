"use client";

import { useState, useTransition } from "react";
import { setTransactionCategory, applyCategoryToSimilarTransactions } from "@/lib/actions/transactions";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useTranslations } from "next-intl";

type Category = { id: string; name: string; color: string };

export function TransactionCategorySelect({
  transactionId,
  categoryId,
  categories,
}: Readonly<{
  transactionId: string;
  categoryId: string | null;
  categories: Category[];
}>) {
  const [pending, startTransition] = useTransition();
  const [applyPending, startApplyTransition] = useTransition();
  // null = closed. Otherwise holds the just-applied categoryId (possibly
  // null for "uncategorized") and how many sibling transactions (same
  // account, same normalized label) are still sitting in a different
  // category - only opened when that count is > 0, so a label with no
  // siblings never interrupts the user with an empty prompt.
  const [pendingPropagation, setPendingPropagation] = useState<{ categoryId: string | null; siblingCount: number } | null>(null);
  const t = useTranslations("categories");

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value || null;
    startTransition(async () => {
      const { siblingCount } = await setTransactionCategory(transactionId, value);
      if (siblingCount > 0) setPendingPropagation({ categoryId: value, siblingCount });
    });
  }

  function handleApplyToSimilar() {
    if (!pendingPropagation) return;
    const { categoryId: targetCategoryId } = pendingPropagation;
    startApplyTransition(async () => {
      await applyCategoryToSimilarTransactions(transactionId, targetCategoryId);
      setPendingPropagation(null);
    });
  }

  const targetCategoryName = pendingPropagation
    ? (categories.find((c) => c.id === pendingPropagation.categoryId)?.name ?? t("uncategorized"))
    : "";

  return (
    <>
      <select
        value={categoryId ?? ""}
        onChange={handleChange}
        disabled={pending}
        aria-label={t("assignLabel")}
        className="bg-transparent border border-[var(--border)] rounded-lg px-2 py-1 text-xs text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)] cursor-pointer disabled:opacity-50 max-w-[140px]"
      >
        <option value="">{t("uncategorized")}</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      {pendingPropagation && (
        <Dialog
          open={true}
          onOpenChange={(open) => !open && setPendingPropagation(null)}
          title={t("applySimilarTitle")}
          trigger={<span aria-hidden="true" />}
        >
          <div className="space-y-4">
            <p className="text-sm text-[var(--foreground)]">
              {t("applySimilarBody", {
                count: pendingPropagation.siblingCount,
                suffix: pendingPropagation.siblingCount !== 1 ? "s" : "",
                categoryName: targetCategoryName,
              })}
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setPendingPropagation(null)} disabled={applyPending}>
                {t("applySimilarDismiss")}
              </Button>
              <Button onClick={handleApplyToSimilar} disabled={applyPending}>
                {applyPending ? t("applyingSimilar") : t("applySimilarConfirm", { count: pendingPropagation.siblingCount })}
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}
