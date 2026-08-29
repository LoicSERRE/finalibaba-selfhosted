"use client";

import { Split } from "lucide-react";
import { TransactionCategorySelect } from "@/components/shared/transaction-category-select";
import { SplitTransactionDialog } from "@/components/shared/split-transaction-dialog";
import { Button } from "@/components/ui/button";
import { useTranslations } from "next-intl";

type Category = { id: string; name: string; color: string };
type SplitLine = { categoryId: string | null; amountCents: bigint };

// The category cell for one transaction row, used everywhere a transaction
// list lets you assign/inspect a category (the account's own transactions
// table, and the global /transactions ledger) - branches between the plain
// single-category <select> and the split-transaction UI depending on
// whether this transaction currently has any TransactionSplit rows. Not
// used on /budgets/[categoryId] - that page excludes split transactions
// from its own plain-transaction query and renders split-derived rows with
// a static, non-interactive badge instead (editing one split line's
// category in isolation isn't supported inline there).
export function TransactionCategoryCell({
  transactionId,
  categoryId,
  amountCents,
  categories,
  splits,
  readOnly = false,
}: Readonly<{
  transactionId: string;
  categoryId: string | null;
  amountCents: bigint;
  categories: Category[];
  splits: SplitLine[];
  /** True when a granted (read-only) portfolio is on screen - renders the
   *  current category as a static chip instead of an editable control. The
   *  Server Actions behind both branches already refuse a guest; this only
   *  keeps the UI from offering an action that could not succeed. */
  readOnly?: boolean;
}>) {
  const t = useTranslations("categories");

  if (readOnly) {
    // Same static-badge treatment /budgets/[categoryId] already gives split
    // rows: show what the category IS, offer no way to change it.
    if (splits.length > 0) {
      return (
        <span className="inline-flex items-center gap-1 text-xs text-[var(--muted)]">
          <Split size={12} aria-hidden="true" />
          {t("splitBadgeCount", { count: splits.length })}
        </span>
      );
    }
    const current = categories.find((c) => c.id === categoryId);
    if (!current) return <span className="text-xs text-[var(--muted)]">-</span>;
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-[var(--foreground)]">
        <span
          aria-hidden="true"
          className="inline-block w-2 h-2 rounded-full shrink-0"
          style={{ backgroundColor: current.color }}
        />
        {current.name}
      </span>
    );
  }

  if (splits.length > 0) {
    return (
      <SplitTransactionDialog
        transactionId={transactionId}
        amountCents={amountCents}
        categories={categories}
        initialSplits={splits}
        trigger={
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs text-[var(--foreground)] bg-[var(--surface-elevated)] border border-[var(--border)] rounded-lg px-2 py-1 cursor-pointer hover:border-[var(--accent)] transition-colors min-h-[44px] sm:min-h-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            <Split size={12} aria-hidden="true" />
            {t("splitBadgeCount", { count: splits.length })}
          </button>
        }
      />
    );
  }

  return (
    <div className="flex items-center gap-1">
      <TransactionCategorySelect transactionId={transactionId} categoryId={categoryId} categories={categories} />
      <SplitTransactionDialog
        transactionId={transactionId}
        amountCents={amountCents}
        categories={categories}
        initialSplits={[]}
        trigger={
          <Button type="button" variant="ghost" size="sm" aria-label={t("splitTrigger")} title={t("splitTrigger")}>
            <Split size={12} aria-hidden="true" />
          </Button>
        }
      />
    </div>
  );
}
