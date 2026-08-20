import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { authenticateApiKey } from "@/lib/services/api-auth";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

// GET /api/v1/transactions?limit=&accountId= - recent transactions, same
// isInternalTransfer exclusion as the read-only share view's own
// transactions section (CLAUDE.md's "Read-only share links") - an internal
// transfer between two of the user's own accounts isn't a real spending
// event, showing it in a widget/dashboard would misrepresent activity.
export async function GET(req: NextRequest) {
  if (!(await authenticateApiKey(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const rawLimit = Number(searchParams.get("limit"));
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.trunc(rawLimit), MAX_LIMIT) : DEFAULT_LIMIT;
  const accountId = searchParams.get("accountId") ?? undefined;

  const transactions = await prisma.transaction.findMany({
    where: { isInternalTransfer: false, ...(accountId ? { accountId } : {}) },
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
