import { formatCurrency, centsToEuro } from "@/lib/utils/format";
import { ImportTransactionsDialog } from "@/components/account-detail/import-transactions-dialog";
import { TransactionCategorySelect } from "@/components/shared/transaction-category-select";
import { MarkAsIncomeButton } from "@/components/account-detail/mark-as-income-button";
import type { AccountDetailTransaction } from "@/lib/domain/account-detail";
import type { getTranslations } from "next-intl/server";

type T = Awaited<ReturnType<typeof getTranslations>>;

// Mirrors DIVIDEND_ACCOUNT_TYPES/INTEREST_ACCOUNT_TYPES in
// mark-as-income-button.tsx and lib/actions/income.ts's
// ELIGIBLE_ACCOUNT_TYPES - only decides whether the button/badge cell is
// worth rendering at all for this account; the button component itself
// re-derives the same eligibility for its own type toggle.
const INCOME_ELIGIBLE_ACCOUNT_TYPES = new Set(["CHECKING", "SAVINGS", "INVESTMENT", "CRYPTO"]);

export function TransactionsTable({
  td,
  intlLocale,
  accountId,
  accountType,
  transactions,
  categories,
  canImportCsv,
  existingFingerprints,
}: Readonly<{
  td: T;
  intlLocale: string;
  accountId: string;
  accountType: string;
  transactions: AccountDetailTransaction[];
  categories: { id: string; name: string; color: string }[];
  canImportCsv: boolean;
  existingFingerprints: string[];
}>) {
  if (transactions.length === 0) return null;

  const showIncomeColumn = INCOME_ELIGIBLE_ACCOUNT_TYPES.has(accountType);

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
            {[
              td("tableHeaders.date"),
              td("tableHeaders.label"),
              td("tableHeaders.category"),
              td("tableHeaders.amount"),
              ...(showIncomeColumn ? [td("tableHeaders.income")] : []),
            ].map((h) => (
              <th
                key={h}
                className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider whitespace-nowrap"
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
              <td className="px-3 sm:px-6 py-3 text-[var(--foreground)] break-words sm:max-w-xs sm:truncate" title={tx.label ?? undefined}>
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
              {showIncomeColumn && (
                <td className="px-3 sm:px-6 py-3 whitespace-nowrap">
                  {tx.amountCents > BigInt(0) && (
                    <MarkAsIncomeButton
                      transactionId={tx.id}
                      accountType={accountType}
                      amountEuro={centsToEuro(tx.amountCents)}
                      date={tx.date.toISOString().slice(0, 10)}
                      alreadyMarked={!!tx.incomeEvent}
                    />
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}
