import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { authenticateApiKey } from "@/lib/services/api-auth";
import { computeDashboard } from "@/lib/domain/dashboard";
import { localeToIntl } from "@/lib/utils/format";

// GET /api/v1/net-worth/history - daily net worth series, e.g. for a Home
// Assistant graph card. Reuses computeDashboard()'s `history` (same data
// the dashboard's own chart renders) rather than a separate aggregation -
// isoDate on each point (lib/domain/dashboard.ts) exists specifically so
// this route doesn't need the locale-formatted `date` string.
export async function GET(req: NextRequest) {
  if (!(await authenticateApiKey(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [accounts, allBalances] = await Promise.all([
    prisma.account.findMany({
      include: { institution: true, holdings: true, history: { orderBy: { recordedAt: "desc" }, take: 1 } },
    }),
    prisma.historicalBalance.findMany({ orderBy: { recordedAt: "asc" } }),
  ]);

  const { history } = computeDashboard({ accounts, allBalances, intlLocale: localeToIntl("fr"), now: new Date() });

  return NextResponse.json({
    history: history.map((point) => ({ date: point.isoDate, netWorthCents: point.netWorth })),
  });
}
