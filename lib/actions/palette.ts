"use server";

import { prisma } from "@/lib/db/prisma";
import { getViewContext } from "@/lib/auth-context";
import { formatCurrency } from "@/lib/utils/format";
import { normalizeTag } from "@/lib/domain/transaction-notes";
import { PALETTE_SEARCH_MAX, PALETTE_SEARCH_MIN } from "@/lib/domain/command-palette";

export type PaletteResults = {
  accounts: { id: string; name: string; institution: string }[];
  categories: { id: string; name: string }[];
  transactions: { id: string; label: string; date: string; amount: string; accountId: string; account: string }[];
};

const EMPTY: PaletteResults = { accounts: [], categories: [], transactions: [] };

/**
 * What the command palette finds for a query (v2.15). A read for display, so
 * it is scoped by the view context - exactly what the pages it links to
 * would show, a granted portfolio included - and takes nothing but the text.
 * Bounded both ways: under PALETTE_SEARCH_MIN it is not worth a query, over
 * PALETTE_SEARCH_MAX it is not a search.
 */
export async function searchPalette(query: string): Promise<PaletteResults> {
  const q = typeof query === "string" ? query.trim() : "";
  if (q.length < PALETTE_SEARCH_MIN || q.length > PALETTE_SEARCH_MAX) return EMPTY;
  const { ownerId, accountIds } = await getViewContext();
  const contains = { contains: q, mode: "insensitive" as const };
  const tag = normalizeTag(q);

  const [accounts, categories, transactions] = await Promise.all([
    prisma.account.findMany({
      where: { id: { in: accountIds }, name: contains },
      select: { id: true, name: true, institution: { select: { name: true } } },
      orderBy: { name: "asc" },
      take: 5,
    }),
    prisma.category.findMany({
      where: { userId: ownerId, name: contains },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
      take: 5,
    }),
    prisma.transaction.findMany({
      where: {
        accountId: { in: accountIds },
        isInternalTransfer: false,
        OR: [{ label: contains }, { note: contains }, ...(tag ? [{ tags: { has: tag } }] : [])],
      },
      select: { id: true, label: true, date: true, amountCents: true, accountId: true, account: { select: { name: true } } },
      orderBy: { date: "desc" },
      take: 6,
    }),
  ]);

  return {
    accounts: accounts.map((a) => ({ id: a.id, name: a.name, institution: a.institution?.name ?? "" })),
    categories,
    transactions: transactions.map((t) => ({
      id: t.id,
      label: t.label,
      date: t.date.toISOString().slice(0, 10),
      amount: formatCurrency(t.amountCents),
      accountId: t.accountId,
      account: t.account.name,
    })),
  };
}
