import Link from "next/link";
import { centsToEuro } from "@/lib/utils/format";
import { TransactionList, TransactionListItem } from "@/components/shared/transaction-list";
import { ImportTransactionsDialog } from "@/components/account-detail/import-transactions-dialog";
import { ManualEntryDialog } from "@/components/account-detail/manual-entry-dialog";
import { DeleteManualEntryButton } from "@/components/account-detail/delete-manual-entry-button";
import { isManualEntry } from "@/lib/domain/manual-entries";
import { TransactionCategoryCell } from "@/components/shared/transaction-category-cell";
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
  readOnly = false,
}: Readonly<{
  td: T;
  intlLocale: string;
  accountId: string;
  accountType: string;
  transactions: AccountDetailTransaction[];
  categories: { id: string; name: string; color: string }[];
  canImportCsv: boolean;
  existingFingerprints: string[];
  /** True when a granted (read-only) portfolio is on screen. The Server
   *  Actions behind these controls guard ownership themselves; this only
   *  avoids rendering buttons that could not succeed. */
  readOnly?: boolean;
}>) {
  if (transactions.length === 0) return null;

  const showIncomeColumn = !readOnly && INCOME_ELIGIBLE_ACCOUNT_TYPES.has(accountType);
  // canImportCsv is this page's "nobody but the user writes here" flag, which
  // is the same condition manual entry needs. The column only appears once
  // there is actually something deletable, so an account whose rows all came
  // from a CSV import never grows an empty column.
  const showManualColumn =
    canImportCsv && !readOnly && transactions.some((tx) => isManualEntry(tx.syncId));
  const dateFormat = new Intl.DateTimeFormat(intlLocale, { day: "numeric", month: "short", year: "numeric" });

  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
      {/* flex-wrap + min-w-0/truncate on the count label - previously a
          non-wrapping row inside an overflow-hidden card, so on narrow
          mobile widths the count label collided with the "Voir tout"/
          import controls and got silently clipped (a real reported bug,
          not a hypothetical). Wrapping onto a second line is a better
          outcome than losing content to overflow-hidden. */}
      <div className="px-6 py-4 border-b border-[var(--border)] flex items-center justify-between flex-wrap gap-x-3 gap-y-2">
        <h2 className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider min-w-0 truncate">
          {td("transactions", { count: transactions.length, suffix: transactions.length !== 1 ? "s" : "" })}
        </h2>
        <div className="flex items-center flex-wrap gap-3">
          <Link
            href={`/transactions?accountId=${accountId}`}
            className="text-xs text-[var(--muted)] hover:text-[var(--accent-text)] transition-colors whitespace-nowrap min-h-[44px] flex items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)] rounded"
          >
            {td("viewAllTransactions")}
          </Link>
          {canImportCsv && !readOnly && <ManualEntryDialog accountId={accountId} categories={categories} />}
          {canImportCsv && (
            <ImportTransactionsDialog accountId={accountId} existingFingerprints={existingFingerprints} />
          )}
        </div>
      </div>
      <TransactionList
        headers={{
          date: td("tableHeaders.date"),
          label: td("tableHeaders.label"),
          amount: td("tableHeaders.amount"),
          category: td("tableHeaders.category"),
          actions: [
            ...(showIncomeColumn ? [td("tableHeaders.income")] : []),
            ...(showManualColumn ? [td("tableHeaders.actions")] : []),
          ],
        }}
      >
        {transactions.map((tx) => (
          <TransactionListItem
            key={tx.id}
            date={dateFormat.format(tx.date)}
            label={tx.label ?? ""}
            amountCents={tx.amountCents}
            category={
              <TransactionCategoryCell
                transactionId={tx.id}
                categoryId={tx.categoryId}
                amountCents={tx.amountCents}
                categories={categories}
                splits={tx.splits}
                isInternalTransfer={tx.isInternalTransfer}
                readOnly={readOnly}
              />
            }
            actions={[
              ...(showIncomeColumn
                ? [
                    tx.amountCents > BigInt(0) ? (
                      <MarkAsIncomeButton
                        transactionId={tx.id}
                        accountType={accountType}
                        amountEuro={centsToEuro(tx.amountCents)}
                        date={tx.date.toISOString().slice(0, 10)}
                        alreadyMarked={!!tx.incomeEvent}
                      />
                    ) : null,
                  ]
                : []),
              ...(showManualColumn
                ? [isManualEntry(tx.syncId) ? <DeleteManualEntryButton transactionId={tx.id} /> : null]
                : []),
            ]}
          />
        ))}
      </TransactionList>
    </div>
  );
}
