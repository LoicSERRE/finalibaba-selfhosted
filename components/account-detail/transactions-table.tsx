import { formatCurrency } from "@/lib/utils/format";
import { ImportTransactionsDialog } from "@/components/account-detail/import-transactions-dialog";
import { TransactionCategorySelect } from "@/components/shared/transaction-category-select";
import type { AccountDetailTransaction } from "@/lib/domain/account-detail";
import type { getTranslations } from "next-intl/server";

type T = Awaited<ReturnType<typeof getTranslations>>;

export function TransactionsTable({
  td,
  intlLocale,
  accountId,
  transactions,
  categories,
  canImportCsv,
  existingFingerprints,
}: {
  td: T;
  intlLocale: string;
  accountId: string;
  transactions: AccountDetailTransaction[];
  categories: { id: string; name: string; color: string }[];
  canImportCsv: boolean;
  existingFingerprints: string[];
}) {
  if (transactions.length === 0) return null;

  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
      <div className="px-6 py-4 border-b border-[var(--border)] flex items-center justify-between gap-3">
        <h2 className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
          {td("transactions", { count: transactions.length, suffix: transactions.length !== 1 ? "s" : "" })}
        </h2>
        {canImportCsv && (
          <ImportTransactionsDialog accountId={accountId} existingFingerprints={existingFingerprints} />
        )}
      </div>
      <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--border)]">
            {[td("tableHeaders.date"), td("tableHeaders.label"), td("tableHeaders.category"), td("tableHeaders.amount")].map((h) => (
              <th
                key={h}
                className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {transactions.map((tx, i) => (
            <tr
              key={tx.id}
              className={`${
                i < transactions.length - 1 ? "border-b border-[var(--border)]" : ""
              } hover:bg-[var(--surface-elevated)] transition-colors`}
            >
              <td className="px-3 sm:px-6 py-3 text-[var(--muted)] tabular-nums whitespace-nowrap text-xs sm:text-sm">
                {new Intl.DateTimeFormat(intlLocale, {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                }).format(tx.date)}
              </td>
              <td className="px-3 sm:px-6 py-3 text-[var(--foreground)] max-w-[140px] sm:max-w-xs truncate" title={tx.label ?? undefined}>
                {tx.label}
              </td>
              <td className="px-3 sm:px-6 py-3 whitespace-nowrap">
                <TransactionCategorySelect transactionId={tx.id} categoryId={tx.categoryId} categories={categories} />
              </td>
              <td className="px-3 sm:px-6 py-3 tabular-nums font-medium whitespace-nowrap">
                <span
                  className={
                    tx.amountCents > BigInt(0)
                      ? "text-[var(--positive)]"
                      : "text-[var(--negative)]"
                  }
                >
                  {tx.amountCents > BigInt(0) ? "+" : ""}
                  {formatCurrency(tx.amountCents)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}
