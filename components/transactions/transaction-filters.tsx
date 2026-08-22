"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { UNCATEGORIZED_SENTINEL } from "@/lib/domain/transactions-ledger";

interface Props {
  accounts: { id: string; name: string }[];
  categories: { id: string; name: string }[];
}

// The search box and the min/max amount fields are debounced (400ms) since
// they navigate on every change - the account/category/date fields don't
// need debouncing, a <select> or date picker change is already a single
// deliberate action. Any filter change resets `page` back to the first
// page, same as changing a filter mid-scroll on any paginated list should.
export function TransactionFilters({ accounts, categories }: Readonly<Props>) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const t = useTranslations("transactions");

  const [searchValue, setSearchValue] = useState(searchParams.get("q") ?? "");
  const [amountMinValue, setAmountMinValue] = useState(searchParams.get("amountMin") ?? "");
  const [amountMaxValue, setAmountMaxValue] = useState(searchParams.get("amountMax") ?? "");

  const updateParams = useCallback(
    (updates: Record<string, string>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value) params.set(key, value);
        else params.delete(key);
      }
      params.delete("page");
      router.push(params.toString() ? `${pathname}?${params.toString()}` : pathname);
    },
    [pathname, router, searchParams],
  );

  useEffect(() => {
    const current = searchParams.get("q") ?? "";
    if (searchValue === current) return;
    const id = setTimeout(() => updateParams({ q: searchValue }), 400);
    return () => clearTimeout(id);
  }, [searchValue, searchParams, updateParams]);

  // Both amount fields are debounced together (one nav with both values, not
  // two independent ones) - firing updateParams separately per field would
  // race, since the second call's `searchParams` closure can still be stale
  // from before the first call's navigation lands.
  useEffect(() => {
    const currentMin = searchParams.get("amountMin") ?? "";
    const currentMax = searchParams.get("amountMax") ?? "";
    if (amountMinValue === currentMin && amountMaxValue === currentMax) return;
    const id = setTimeout(() => updateParams({ amountMin: amountMinValue, amountMax: amountMaxValue }), 400);
    return () => clearTimeout(id);
  }, [amountMinValue, amountMaxValue, searchParams, updateParams]);

  return (
    <div className="flex flex-wrap gap-3 items-end">
      <div className="relative flex-1 min-w-[200px]">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" aria-hidden="true" />
        <input
          type="text"
          value={searchValue}
          onChange={(e) => setSearchValue(e.target.value)}
          placeholder={t("searchPlaceholder")}
          aria-label={t("searchAriaLabel")}
          className="w-full min-h-[44px] pl-9 pr-3 py-2 rounded-lg bg-[var(--surface-elevated)] border border-[var(--border)] text-sm text-[var(--foreground)] placeholder:text-[var(--muted)] outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/30 transition-colors"
        />
      </div>

      <select
        value={searchParams.get("accountId") ?? ""}
        onChange={(e) => updateParams({ accountId: e.target.value })}
        aria-label={t("accountFilterLabel")}
        className="min-h-[44px] px-3 py-2 rounded-lg bg-[var(--surface-elevated)] border border-[var(--border)] text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/30 cursor-pointer"
      >
        <option value="">{t("allAccounts")}</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>

      <select
        value={searchParams.get("categoryId") ?? ""}
        onChange={(e) => updateParams({ categoryId: e.target.value })}
        aria-label={t("categoryFilterLabel")}
        className="min-h-[44px] px-3 py-2 rounded-lg bg-[var(--surface-elevated)] border border-[var(--border)] text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/30 cursor-pointer"
      >
        <option value="">{t("allCategories")}</option>
        <option value={UNCATEGORIZED_SENTINEL}>{t("uncategorizedFilter")}</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>

      <div className="flex gap-3">
        <input
          type="date"
          value={searchParams.get("from") ?? ""}
          onChange={(e) => updateParams({ from: e.target.value })}
          aria-label={t("fromDateLabel")}
          className="min-h-[44px] px-3 py-2 rounded-lg bg-[var(--surface-elevated)] border border-[var(--border)] text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/30"
        />
        <input
          type="date"
          value={searchParams.get("to") ?? ""}
          onChange={(e) => updateParams({ to: e.target.value })}
          aria-label={t("toDateLabel")}
          className="min-h-[44px] px-3 py-2 rounded-lg bg-[var(--surface-elevated)] border border-[var(--border)] text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/30"
        />
      </div>

      {/* Min/max grouped so they wrap together as a pair - previously two
          independent flex items, which at some viewport widths left "Max €"
          wrapping alone onto its own line while "Min €" stayed above it. */}
      <div className="flex gap-3">
        <input
          type="number"
          inputMode="decimal"
          min={0}
          step="0.01"
          value={amountMinValue}
          onChange={(e) => setAmountMinValue(e.target.value)}
          placeholder={t("amountMinPlaceholder")}
          aria-label={t("amountMinLabel")}
          className="w-24 min-h-[44px] px-3 py-2 rounded-lg bg-[var(--surface-elevated)] border border-[var(--border)] text-sm text-[var(--foreground)] placeholder:text-[var(--muted)] outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/30"
        />
        <input
          type="number"
          inputMode="decimal"
          min={0}
          step="0.01"
          value={amountMaxValue}
          onChange={(e) => setAmountMaxValue(e.target.value)}
          placeholder={t("amountMaxPlaceholder")}
          aria-label={t("amountMaxLabel")}
          className="w-24 min-h-[44px] px-3 py-2 rounded-lg bg-[var(--surface-elevated)] border border-[var(--border)] text-sm text-[var(--foreground)] placeholder:text-[var(--muted)] outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/30"
        />
      </div>
    </div>
  );
}
