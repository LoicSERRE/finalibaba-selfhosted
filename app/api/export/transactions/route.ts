import { prisma } from "@/lib/db/prisma";
import { baseAccountIds, getViewer } from "@/lib/auth-context";
import { getLocale, getTranslations } from "next-intl/server";
import { localeToIntl } from "@/lib/utils/format";
import { buildTransactionsCsv } from "@/lib/utils/transactions-csv";
import { buildTransactionWhere } from "@/lib/services/ledger-query";
import { AUDIT, recordAuditEvent } from "@/lib/services/audit-log";
import { parseTransactionLedgerFilters, type TransactionLedgerSearchParams } from "@/lib/domain/transactions-ledger";

/**
 * The ledger, filtered exactly as /transactions is, as a CSV download (v2.14).
 *
 * Deliberately NOT under /api/transactions/: proxy.ts exempts that whole
 * prefix from the session check (it carries the sync service's bearer-token
 * callbacks), so an export there would have been public. Pinned in
 * __tests__/proxy-matcher.test.ts.
 *
 * Scoped to baseAccountIds - the viewer's own and co-owned accounts - not
 * the view context: an export is a derived artifact (CLAUDE.md, "Multi-user,
 * one owner row"), so a read-only grant on someone else's portfolio never
 * leaves the app as a file. The ledger hides the button in that mode.
 */
export const dynamic = "force-dynamic";

/** A guard, not a page size: a personal ledger is far below it. */
const CSV_MAX_ROWS = 100_000;

export async function GET(request: Request) {
  const viewer = await getViewer();
  const params = Object.fromEntries(new URL(request.url).searchParams) as TransactionLedgerSearchParams;
  const filters = parseTransactionLedgerFilters(params);
  const accountIds = await baseAccountIds(viewer.id);

  const [rows, locale, t] = await Promise.all([
    prisma.transaction.findMany({
      where: { AND: [buildTransactionWhere(filters), { accountId: { in: accountIds } }] },
      orderBy: { date: "desc" },
      take: CSV_MAX_ROWS,
      select: {
        date: true,
        label: true,
        amountCents: true,
        note: true,
        tags: true,
        account: { select: { name: true } },
        category: { select: { name: true } },
        splits: { select: { amountCents: true, category: { select: { name: true } } } },
      },
    }),
    getLocale(),
    getTranslations("transactions.csv"),
  ]);

  const csv = buildTransactionsCsv(
    rows.map((row) => ({
      date: row.date,
      account: row.account.name,
      label: row.label,
      amountCents: row.amountCents,
      category: row.category?.name ?? null,
      splits: row.splits.map((split) => ({ category: split.category?.name ?? null, amountCents: split.amountCents })),
      note: row.note,
      tags: row.tags,
    })),
    {
      date: t("date"),
      account: t("account"),
      label: t("label"),
      amount: t("amount"),
      currency: t("currency"),
      category: t("category"),
      note: t("note"),
      tags: t("tags"),
      uncategorized: t("uncategorized"),
    },
    localeToIntl(locale)
  );

  await recordAuditEvent({ action: AUDIT.dataExported, actorId: viewer.id, detail: `ledger CSV: ${rows.length} transaction(s)` });

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="finalibaba-transactions-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
