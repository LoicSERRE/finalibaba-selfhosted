import type { getTranslations } from "next-intl/server";
import { formatCurrency } from "@/lib/utils/format";

export interface SharedTransactionRow {
  id: string;
  date: Date;
  label: string;
  amountCents: bigint;
  accountName: string;
  category: { name: string; color: string } | null;
}

type T = Awaited<ReturnType<typeof getTranslations>>;

// Only rendered by app/shared/[token]/page.tsx when the link's own
// includeTransactions flag is set - see the ShareLink schema comment. The
// page's own query already excludes isInternalTransfer rows and caps the
// list at MAX_TRANSACTIONS, so this component just renders what it's given.
export function SharedTransactionsSection({
  t,
  locale,
  transactions,
}: Readonly<{ t: T; locale: string; transactions: SharedTransactionRow[] }>) {
  if (transactions.length === 0) return null;

  return (
    <div className="space-y-3">
      <h2 className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
        {t("shared.transactionsTitle")}
      </h2>
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl divide-y divide-[var(--border)]">
        {transactions.map((tx) => (
          <div key={tx.id} className="px-5 py-3 flex items-center justify-between gap-3 min-h-[44px]">
            <div className="min-w-0 flex items-center gap-2.5">
              {tx.category && (
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ background: tx.category.color }}
                  aria-hidden="true"
                />
              )}
              <div className="min-w-0">
                <p className="text-sm text-[var(--foreground)] truncate">{tx.label}</p>
                <p className="text-xs text-[var(--muted)]">
                  {tx.accountName} · {tx.date.toLocaleDateString(locale)}
                </p>
              </div>
            </div>
            <span
              className={`text-sm font-medium tabular-nums shrink-0 ${
                tx.amountCents >= BigInt(0) ? "text-[var(--positive)]" : "text-[var(--foreground)]"
              }`}
            >
              {formatCurrency(tx.amountCents, 2)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
