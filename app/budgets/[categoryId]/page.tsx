export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { TransactionCategorySelect } from "@/components/shared/transaction-category-select";
import { formatCurrency, localeToIntl } from "@/lib/utils/format";
import { getTranslations, getLocale } from "next-intl/server";

export default async function CategoryDetailPage({
  params,
}: Readonly<{
  params: Promise<{ categoryId: string }>;
}>) {
  const { categoryId } = await params;
  const [t, td, locale] = await Promise.all([getTranslations("budgets"), getTranslations("accountDetail"), getLocale()]);
  const intlLocale = localeToIntl(locale);

  const [category, categories] = await Promise.all([
    prisma.category.findUnique({
      where: { id: categoryId },
      include: {
        transactions: {
          orderBy: { date: "desc" },
          include: { account: { select: { name: true } } },
        },
      },
    }),
    prisma.category.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, color: true } }),
  ]);

  if (!category) notFound();

  const totalCents = category.transactions.reduce((sum, tx) => sum + Number(tx.amountCents), 0);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <Link
        href="/budgets"
        className="inline-flex items-center gap-1.5 text-sm text-[var(--muted)] hover:text-[var(--foreground)] transition-colors py-2 min-h-[44px]"
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

      {category.transactions.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">{t("noTransactions")}</p>
      ) : (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  {[td("tableHeaders.date"), t("account"), td("tableHeaders.label"), td("tableHeaders.category"), td("tableHeaders.amount")].map(
                    (h) => (
                      <th key={h} className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
                        {h}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {category.transactions.map((tx, i) => (
                  <tr
                    key={tx.id}
                    className={`${
                      i < category.transactions.length - 1 ? "border-b border-[var(--border)]" : ""
                    } hover:bg-[var(--surface-elevated)] transition-colors`}
                  >
                    <td className="px-3 sm:px-6 py-3 text-[var(--muted)] tabular-nums whitespace-nowrap text-xs sm:text-sm">
                      {new Intl.DateTimeFormat(intlLocale, { day: "numeric", month: "short", year: "numeric" }).format(tx.date)}
                    </td>
                    <td className="px-3 sm:px-6 py-3 text-[var(--muted)] whitespace-nowrap text-xs sm:text-sm">{tx.account.name}</td>
                    <td className="px-3 sm:px-6 py-3 text-[var(--foreground)] max-w-[140px] sm:max-w-xs truncate" title={tx.label}>
                      {tx.label}
                    </td>
                    <td className="px-3 sm:px-6 py-3 whitespace-nowrap">
                      <TransactionCategorySelect transactionId={tx.id} categoryId={tx.categoryId} categories={categories} />
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
      )}
    </div>
  );
}
