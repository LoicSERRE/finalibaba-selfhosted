export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db/prisma";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { TransactionCategoryCell } from "@/components/shared/transaction-category-cell";
import { TransactionFilters } from "@/components/transactions/transaction-filters";
import { formatCurrency, localeToIntl } from "@/lib/utils/format";
import { getTranslations, getLocale } from "next-intl/server";
import {
  parseTransactionLedgerFilters,
  dayAfter,
  amountMagnitudeRanges,
  TRANSACTIONS_PAGE_SIZE,
  UNCATEGORIZED_SENTINEL,
  type TransactionLedgerFilters,
  type TransactionLedgerSearchParams,
} from "@/lib/domain/transactions-ledger";

// Kept as its own function (not inlined into the page component below) to
// stay under the sonarjs cognitive-complexity gate - same reasoning as
// lib/actions/auto-categorize.ts's resolveDefaultCategoryIds/
// matchAgainstDefaults split. Still Prisma-specific and still lives in
// app/transactions/page.tsx, not lib/domain/transactions-ledger.ts - this
// project's lib/domain-has-no-DB-calls convention, see that file's own
// header comment.
//
// Built as an explicit AND of independent conditions, not one flat object
// with spread-in fields, because the category filter and the amount filter
// each need their own top-level "OR" (a category match has to check both
// the transaction's own categoryId and any of its splits' - see CLAUDE.md's
// "Split transactions") - a plain object can only ever hold one "OR" key,
// so two would silently collide/overwrite each other.
function buildTransactionWhere(filters: TransactionLedgerFilters) {
  const amountRanges = amountMagnitudeRanges(filters.amountMin, filters.amountMax);
  const conditions: object[] = [{ isInternalTransfer: false }];
  if (filters.q) conditions.push({ label: { contains: filters.q, mode: "insensitive" as const } });
  if (filters.accountId) conditions.push({ accountId: filters.accountId });
  if (filters.categoryId === UNCATEGORIZED_SENTINEL) {
    // Genuinely uncategorized (no category, no splits at all) OR a split
    // transaction with at least one deliberately-uncategorized line - both
    // count as "uncategorized" the same way app/budgets/page.tsx's own
    // uncategorizedSpentCents does.
    conditions.push({ OR: [{ categoryId: null, splits: { none: {} } }, { splits: { some: { categoryId: null } } }] });
  } else if (filters.categoryId) {
    conditions.push({ OR: [{ categoryId: filters.categoryId }, { splits: { some: { categoryId: filters.categoryId } } }] });
  }
  if (filters.from || filters.to) {
    conditions.push({
      date: {
        ...(filters.from ? { gte: filters.from } : {}),
        ...(filters.to ? { lt: dayAfter(filters.to) } : {}),
      },
    });
  }
  if (amountRanges) conditions.push({ OR: amountRanges.map((range) => ({ amountCents: range })) });
  return { AND: conditions };
}

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

  const where = buildTransactionWhere(filters);

  const [accounts, categories, totalCount, transactions] = await Promise.all([
    prisma.account.findMany({
      where: { transactions: { some: {} } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.category.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, color: true } }),
    prisma.transaction.count({ where }),
    prisma.transaction.findMany({
      where,
      orderBy: { date: "desc" },
      skip: (filters.page - 1) * TRANSACTIONS_PAGE_SIZE,
      take: TRANSACTIONS_PAGE_SIZE,
      include: { account: { select: { name: true } }, splits: { select: { categoryId: true, amountCents: true } } },
    }),
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
    if (page > 1) params.set("page", String(page));
    return params.toString() ? `/transactions?${params.toString()}` : "/transactions";
  };

  return (
    // max-w-5xl, not this app's usual max-w-4xl (every other page) -
    // deliberate, confirmed during the v1.15 UI/UX audit rather than left
    // as unexplained drift: this is the one page with a real 5-column
    // table (date/account/label/category/amount) behind a 5-field filter
    // bar, both of which read as visibly cramped at 4xl - the account/
    // category columns in particular need more room than the per-account
    // transactions table (which never shows an account column at all).
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-[var(--foreground)]">{t("title")}</h1>
        <p className="text-sm text-[var(--muted)] mt-1">{t("subtitle", { count: totalCount, suffix: totalCount !== 1 ? "s" : "" })}</p>
      </div>

      <TransactionFilters accounts={accounts} categories={categories} />

      {transactions.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">{t("noResults")}</p>
      ) : (
        <>
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)]">
                    {[td("tableHeaders.date"), t("account"), td("tableHeaders.label"), td("tableHeaders.category"), td("tableHeaders.amount")].map(
                      (h) => (
                        <th key={h} className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider whitespace-nowrap">
                          {h}
                        </th>
                      ),
                    )}
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
                        {new Intl.DateTimeFormat(intlLocale, { day: "numeric", month: "short", year: "numeric" }).format(tx.date)}
                      </td>
                      <td className="px-3 sm:px-6 py-3 text-[var(--muted)] whitespace-nowrap text-xs sm:text-sm">{tx.account.name}</td>
                      <td className="px-3 sm:px-6 py-3 text-[var(--foreground)] break-words sm:max-w-xs sm:truncate" title={tx.label}>
                        {tx.label}
                      </td>
                      <td className="px-3 sm:px-6 py-3 whitespace-nowrap">
                        <TransactionCategoryCell
                          transactionId={tx.id}
                          categoryId={tx.categoryId}
                          amountCents={tx.amountCents}
                          categories={categories}
                          splits={tx.splits}
                        />
                      </td>
                      <td className="px-3 sm:px-6 py-3 tabular-nums font-medium whitespace-nowrap">
                        <span className={tx.amountCents > BigInt(0) ? "text-[var(--positive)]" : "text-[var(--negative)]"}>
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
