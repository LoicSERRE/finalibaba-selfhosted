export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db/prisma";
import { getViewer, viewAccountIds } from "@/lib/auth-context";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { TransactionCategorySelect } from "@/components/shared/transaction-category-select";
import { formatCurrency, localeToIntl } from "@/lib/utils/format";
import { getTranslations, getLocale } from "next-intl/server";

// One row in this page's table - either a plain transaction whose own
// categoryId matches, or one split line whose categoryId matches (id is
// the split's own id there, not the parent transaction's, and amountCents
// is that split's portion, not the whole transaction's - see CLAUDE.md's
// "Split transactions" for why a split transaction's own categoryId is
// always null and its category breakdown lives in TransactionSplit rows
// instead).
type Row = {
  id: string;
  date: Date;
  accountName: string;
  label: string;
  amountCents: bigint;
  isSplit: boolean;
  transactionId: string;
  transactionCategoryId: string | null;
};

export default async function CategoryDetailPage({
  params,
}: Readonly<{
  params: Promise<{ categoryId: string }>;
}>) {
  const { categoryId } = await params;
  const [t, td, locale] = await Promise.all([getTranslations("budgets"), getTranslations("accountDetail"), getLocale()]);
  const intlLocale = localeToIntl(locale);

  // The category must belong to the viewer (findFirst + userId, not
  // findUnique by id - this drill-down used to render any category id), and
  // its transactions are further limited to accounts they can see: a
  // co-owner categorizing a joint transaction must not expose the rest of
  // their own account's activity through this page.
  const viewer = await getViewer();
  const accountIds = await viewAccountIds(viewer.id);

  const [category, categories, splitLines] = await Promise.all([
    prisma.category.findFirst({
      where: { id: categoryId, userId: viewer.id },
      include: {
        transactions: {
          where: { splits: { none: {} }, accountId: { in: accountIds } },
          orderBy: { date: "desc" },
          include: { account: { select: { name: true } } },
        },
      },
    }),
    prisma.category.findMany({ where: { userId: viewer.id }, orderBy: { name: "asc" }, select: { id: true, name: true, color: true } }),
    prisma.transactionSplit.findMany({
      where: { categoryId, transaction: { accountId: { in: accountIds } } },
      include: { transaction: { include: { account: { select: { name: true } } } } },
    }),
  ]);

  if (!category) notFound();

  const rows: Row[] = [
    ...category.transactions.map((tx) => ({
      id: tx.id,
      date: tx.date,
      accountName: tx.account.name,
      label: tx.label,
      amountCents: tx.amountCents,
      isSplit: false,
      transactionId: tx.id,
      transactionCategoryId: tx.categoryId,
    })),
    ...splitLines.map((split) => ({
      id: split.id,
      date: split.transaction.date,
      accountName: split.transaction.account.name,
      label: split.transaction.label,
      amountCents: split.amountCents,
      isSplit: true,
      transactionId: split.transactionId,
      transactionCategoryId: null,
    })),
  ].sort((a, b) => b.date.getTime() - a.date.getTime());

  const totalCents = rows.reduce((sum, r) => sum + Number(r.amountCents), 0);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <Link
        href="/budgets"
        className="inline-flex items-center gap-1.5 text-sm text-[var(--muted)] hover:text-[var(--foreground)] transition-colors py-2 min-h-[44px] rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]"
      >
        <ArrowLeft size={14} aria-hidden="true" />
        {t("title")}
      </Link>

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="w-4 h-4 rounded-full shrink-0" style={{ background: category.color }} aria-hidden="true" />
          <h1 className="text-2xl font-semibold text-[var(--foreground)]">{category.name}</h1>
        </div>
        <span className="text-sm font-medium tabular-nums text-[var(--muted)]">{formatCurrency(totalCents)}</span>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">{t("noTransactions")}</p>
      ) : (
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
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr
                    key={r.id}
                    className={`${
                      i < rows.length - 1 ? "border-b border-[var(--border)]" : ""
                    } hover:bg-[var(--surface-elevated)] transition-colors`}
                  >
                    <td className="px-3 sm:px-6 py-3 text-[var(--muted)] tabular-nums whitespace-nowrap text-xs sm:text-sm">
                      {new Intl.DateTimeFormat(intlLocale, { day: "numeric", month: "short", year: "numeric" }).format(r.date)}
                    </td>
                    <td className="px-3 sm:px-6 py-3 text-[var(--muted)] whitespace-nowrap text-xs sm:text-sm">{r.accountName}</td>
                    <td className="px-3 sm:px-6 py-3 text-[var(--foreground)] break-words sm:max-w-xs sm:truncate" title={r.label}>
                      {r.label}
                    </td>
                    <td className="px-3 sm:px-6 py-3 whitespace-nowrap">
                      {r.isSplit ? (
                        // A split line's category isn't editable inline here -
                        // it's one part of a multi-category breakdown, which
                        // this plain <select> can't express (picking a value
                        // would wipe the whole split, same as it does from any
                        // other entry point). Edit the split itself from the
                        // account's transactions table or the global ledger.
                        <span
                          className="inline-flex items-center gap-1 text-xs text-[var(--muted)] bg-[var(--surface-elevated)] border border-[var(--border)] rounded-lg px-2 py-1"
                          title={t("splitBadgeHint")}
                        >
                          {t("splitBadge")}
                        </span>
                      ) : (
                        <TransactionCategorySelect transactionId={r.transactionId} categoryId={r.transactionCategoryId} categories={categories} />
                      )}
                    </td>
                    <td className="px-3 sm:px-6 py-3 tabular-nums font-medium whitespace-nowrap">
                      <span className={r.amountCents > BigInt(0) ? "text-[var(--positive)]" : "text-[var(--negative)]"}>
                        {r.amountCents > BigInt(0) ? "+" : ""}
                        {formatCurrency(r.amountCents)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
