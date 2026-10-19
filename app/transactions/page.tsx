export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db/prisma";
import { getViewContext } from "@/lib/auth-context";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import { TransactionCategoryCell } from "@/components/shared/transaction-category-cell";
import { TransactionList, TransactionListItem } from "@/components/shared/transaction-list";
import { TransactionFilters } from "@/components/transactions/transaction-filters";
import { BulkSelectionProvider, BulkToolbar, RowSelectCheckbox } from "@/components/transactions/bulk-selection";
import { TransactionNoteDetails } from "@/components/transactions/transaction-note-details";
import { TransactionNoteButton } from "@/components/transactions/transaction-note-button";
import { listTags } from "@/lib/services/transaction-tags";
import { buildTransactionWhere } from "@/lib/services/ledger-query";
import { localeToIntl } from "@/lib/utils/format";
import { getTranslations, getLocale } from "next-intl/server";
import {
  parseTransactionLedgerFilters,
  TRANSACTIONS_PAGE_SIZE,
  type TransactionLedgerSearchParams,
} from "@/lib/domain/transactions-ledger";

export default async function TransactionsPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<TransactionLedgerSearchParams>;
}>) {
  const rawParams = await searchParams;
  const filters = parseTransactionLedgerFilters(rawParams);
  const [t, td, locale] = await Promise.all([
    getTranslations("transactions"),
    getTranslations("accountDetail"),
    getLocale(),
  ]);
  const intlLocale = localeToIntl(locale);

  // The account-set filter wraps the user-supplied filters rather than being
  // spread into them: buildTransactionWhere already owns the top-level AND
  // (see its comment), and a filter the visitor controls must never be able
  // to widen the scope back out.
  const { ownerId, accountIds, readOnly } = await getViewContext();
  const where = { AND: [buildTransactionWhere(filters), { accountId: { in: accountIds } }] };

  const [accounts, categories, totalCount, transactions, tags] = await Promise.all([
    prisma.account.findMany({
      where: { id: { in: accountIds }, transactions: { some: {} } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.category.findMany({ where: { userId: ownerId }, orderBy: { name: "asc" }, select: { id: true, name: true, color: true } }),
    prisma.transaction.count({ where }),
    prisma.transaction.findMany({
      where,
      orderBy: { date: "desc" },
      skip: (filters.page - 1) * TRANSACTIONS_PAGE_SIZE,
      take: TRANSACTIONS_PAGE_SIZE,
      include: { account: { select: { name: true } }, splits: { select: { categoryId: true, amountCents: true } } },
    }),
    listTags(accountIds),
  ]);

  const totalPages = Math.max(1, Math.ceil(totalCount / TRANSACTIONS_PAGE_SIZE));
  const pageHref = (page: number) => {
    const params = new URLSearchParams();
    if (rawParams.q) params.set("q", rawParams.q);
    if (rawParams.accountId) params.set("accountId", rawParams.accountId);
    if (rawParams.categoryId) params.set("categoryId", rawParams.categoryId);
    if (rawParams.from) params.set("from", rawParams.from);
    if (rawParams.to) params.set("to", rawParams.to);
    if (rawParams.amountMin) params.set("amountMin", rawParams.amountMin);
    if (rawParams.amountMax) params.set("amountMax", rawParams.amountMax);
    if (rawParams.tag) params.set("tag", rawParams.tag);
    if (page > 1) params.set("page", String(page));
    return params.toString() ? `/transactions?${params.toString()}` : "/transactions";
  };

  const dateFormat = new Intl.DateTimeFormat(intlLocale, { day: "numeric", month: "short", year: "numeric" });

  return (
    // max-w-5xl, not this app's usual max-w-4xl (every other page) -
    // deliberate, confirmed during the v1.15 UI/UX audit rather than left
    // as unexplained drift: this is the one page with a real 5-column
    // table (date/account/label/category/amount) behind a 5-field filter
    // bar, both of which read as visibly cramped at 4xl - the account/
    // category columns in particular need more room than the per-account
    // transactions table (which never shows an account column at all).
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--foreground)]">{t("title")}</h1>
          <p className="text-sm text-[var(--muted)] mt-1">{t("subtitle", { count: totalCount, suffix: totalCount !== 1 ? "s" : "" })}</p>
        </div>
        {/* The same filters as the list, every page of it. Not on a granted
            portfolio: exports only ever cover the viewer's own accounts
            (app/api/export/transactions/route.ts). */}
        {!readOnly && totalCount > 0 && (
          <a
            href={pageHref(1).replace(/^\/transactions/, "/api/export/transactions")}
            download
            className="flex items-center gap-1.5 px-3 py-1.5 min-h-[44px] text-sm text-[var(--muted)] border border-[var(--border)] rounded-lg hover:text-[var(--foreground)] hover:border-[var(--accent)]/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            <Download size={14} aria-hidden="true" />
            {t("exportCsv")}
          </a>
        )}
      </div>

      <TransactionFilters accounts={accounts} categories={categories} tags={tags} />

      {transactions.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">{t("noResults")}</p>
      ) : (
        <>
          {/* Keyed on the query: a new page or filter starts with nothing
              selected. Read-only (a granted portfolio) gets no selection. */}
          <BulkSelectionProvider key={pageHref(filters.page)} pageIds={readOnly ? [] : transactions.map((tx) => tx.id)}>
          {/* No overflow-hidden: it would stop the bulk toolbar sticking. */}
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl">
            {!readOnly && <BulkToolbar pageIds={transactions.map((tx) => tx.id)} categories={categories} />}
            <TransactionList
              headers={{
                date: td("tableHeaders.date"),
                account: t("account"),
                label: td("tableHeaders.label"),
                amount: td("tableHeaders.amount"),
                category: td("tableHeaders.category"),
                selectable: !readOnly,
                actions: readOnly ? [] : [t("noteColumn")],
              }}
            >
              {transactions.map((tx) => (
                <TransactionListItem
                  key={tx.id}
                  select={readOnly ? undefined : <RowSelectCheckbox id={tx.id} label={tx.label} />}
                  date={dateFormat.format(tx.date)}
                  account={tx.account.name}
                  label={tx.label}
                  details={<TransactionNoteDetails note={tx.note} tags={tx.tags} />}
                  actions={
                    readOnly
                      ? []
                      : [<TransactionNoteButton key="note" transactionId={tx.id} label={tx.label} note={tx.note} tags={tx.tags} suggestions={tags} />]
                  }
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
                />
              ))}
            </TransactionList>
          </div>
          </BulkSelectionProvider>

          {totalPages > 1 && (
            <div className="flex items-center justify-between gap-3">
              <Link
                href={pageHref(filters.page - 1)}
                aria-disabled={filters.page <= 1}
                className={`inline-flex items-center gap-1 text-sm px-3 py-2 min-h-[44px] rounded-lg transition-colors ${
                  filters.page <= 1
                    ? "text-[var(--muted)] opacity-40 pointer-events-none"
                    : "text-[var(--foreground)] hover:bg-[var(--surface-elevated)]"
                }`}
              >
                <ChevronLeft size={16} aria-hidden="true" />
                {t("previousPage")}
              </Link>
              <span className="text-sm text-[var(--muted)] tabular-nums">{t("pageOf", { page: filters.page, total: totalPages })}</span>
              <Link
                href={pageHref(filters.page + 1)}
                aria-disabled={filters.page >= totalPages}
                className={`inline-flex items-center gap-1 text-sm px-3 py-2 min-h-[44px] rounded-lg transition-colors ${
                  filters.page >= totalPages
                    ? "text-[var(--muted)] opacity-40 pointer-events-none"
                    : "text-[var(--foreground)] hover:bg-[var(--surface-elevated)]"
                }`}
              >
                {t("nextPage")}
                <ChevronRight size={16} aria-hidden="true" />
              </Link>
            </div>
          )}
        </>
      )}
    </div>
  );
}
