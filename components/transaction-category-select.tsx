"use client";

import { useTransition } from "react";
import { setTransactionCategory } from "@/lib/actions/transactions";
import { useTranslations } from "next-intl";

type Category = { id: string; name: string; color: string };

export function TransactionCategorySelect({
  transactionId,
  categoryId,
  categories,
}: {
  transactionId: string;
  categoryId: string | null;
  categories: Category[];
}) {
  const [pending, startTransition] = useTransition();
  const t = useTranslations("categories");

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value || null;
    startTransition(async () => {
      await setTransactionCategory(transactionId, value);
    });
  }

  return (
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
  );
}
