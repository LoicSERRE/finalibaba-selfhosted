import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { authenticateApiKey } from "@/lib/services/api-auth";
import { baseAccountIds } from "@/lib/auth-context";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

// GET /api/v1/transactions?limit=&accountId= - recent transactions, same
// isInternalTransfer exclusion as the read-only share view's own
// transactions section (CLAUDE.md's "Read-only share links") - an internal
// transfer between two of the user's own accounts isn't a real spending
// event, showing it in a widget/dashboard would misrepresent activity.
export async function GET(req: NextRequest) {
  const key = await authenticateApiKey(req);
  if (!key) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Scoped to the KEY OWNER's own accounts (own + co-owned), never the whole
  // instance - see authenticateApiKey. baseAccountIds, not viewAccountIds: a
  // long-lived token must not keep exposing a portfolio that was merely
  // granted for reading and could be revoked at any time.
  const accountIds = await baseAccountIds(key.userId);

  const { searchParams } = req.nextUrl;
  const rawLimit = Number(searchParams.get("limit"));
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.trunc(rawLimit), MAX_LIMIT) : DEFAULT_LIMIT;
  const accountId = searchParams.get("accountId") ?? undefined;

  const transactions = await prisma.transaction.findMany({
    where: {
      isInternalTransfer: false,
      // An explicit ?accountId= is intersected with the key owner's own set,
      // never trusted on its own - otherwise any valid key could read any
      // account in the instance just by naming its id. An id outside that set
      // yields an empty result rather than silently widening back to
      // "everything I own", which would answer a question nobody asked.
      accountId: accountId ? { in: accountIds.filter((id) => id === accountId) } : { in: accountIds },
    },
    orderBy: { date: "desc" },
    take: limit,
    include: { category: { select: { name: true, color: true } }, account: { select: { id: true, name: true } } },
  });

  return NextResponse.json({
    transactions: transactions.map((tx) => ({
      id: tx.id,
      date: tx.date.toISOString(),
      label: tx.label,
      amountCents: tx.amountCents.toString(),
      account: { id: tx.account.id, name: tx.account.name },
      category: tx.category,
    })),
  });
}
