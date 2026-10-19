"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

interface TagFilterProps {
  tags: string[];
  onChange: React.ChangeEventHandler<HTMLSelectElement>;
}

/**
 * The ledger's tag filter (v2.14), shown once any tag exists. Its own file:
 * defined next to TransactionFilters, it hid that component from lizard in
 * every form tried (dev-docs/release-audit.md, item 2). Reads its own value
 * so TransactionFilters, at lizard's CCN limit already, gains no branch.
 */
export function TagFilter({ tags, onChange }: Readonly<TagFilterProps>) {
  const t = useTranslations("transactions");
  const searchParams = useSearchParams();
  if (tags.length === 0) return null;
  return (
    <select
      value={searchParams.get("tag") ?? ""}
      onChange={onChange}
      aria-label={t("tagFilterLabel")}
      className="min-h-[44px] px-3 py-2 rounded-lg bg-[var(--surface-elevated)] border border-[var(--border)] text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/30 cursor-pointer"
    >
      <option value="">{t("allTags")}</option>
      {tags.map((tag) => (
        <option key={tag} value={tag}>
          #{tag}
        </option>
      ))}
    </select>
  );
}
