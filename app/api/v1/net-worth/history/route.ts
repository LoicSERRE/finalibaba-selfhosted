import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { authenticateApiKey } from "@/lib/services/api-auth";
import { baseAccountIds } from "@/lib/auth-context";
import { computeDashboard } from "@/lib/domain/dashboard";
import { localeToIntl } from "@/lib/utils/format";

// GET /api/v1/net-worth/history - daily net worth series, e.g. for a Home
// Assistant graph card. Reuses computeDashboard()'s `history` (same data
// the dashboard's own chart renders) rather than a separate aggregation -
// isoDate on each point (lib/domain/dashboard.ts) exists specifically so
// this route doesn't need the locale-formatted `date` string.
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

  const [accounts, allBalances] = await Promise.all([
    prisma.account.findMany({
      where: { id: { in: accountIds } },
      include: { institution: true, holdings: true, history: { orderBy: { recordedAt: "desc" }, take: 1 } },
    }),
    prisma.historicalBalance.findMany({ where: { accountId: { in: accountIds } }, orderBy: { recordedAt: "asc" } }),
  ]);

  const { history } = computeDashboard({ accounts, allBalances, intlLocale: localeToIntl("fr"), now: new Date() });

  return NextResponse.json({
    history: history.map((point) => ({ date: point.isoDate, netWorthCents: point.netWorth })),
  });
}
