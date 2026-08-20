import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { authenticateApiKey } from "@/lib/services/api-auth";
import { computeDashboard } from "@/lib/domain/dashboard";
import { localeToIntl } from "@/lib/utils/format";

// GET /api/v1/net-worth - current net worth snapshot. See CLAUDE.md's
// "Public REST API" for the auth model (ApiKey bearer token, checked here
// rather than via proxy.ts/NextAuth - an external tool has no browser
// session to present) and why this reuses computeDashboard() rather than
// a separate query: the API must never disagree with what the dashboard
// itself shows for the same data.
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

  const { hasAccounts, netWorth, grossAssets, totalLiabilities, totalLatentTax, allocationRaw, delta30 } =
    computeDashboard({ accounts, allBalances, intlLocale: localeToIntl("fr"), now: new Date() });

  return NextResponse.json({
    hasAccounts,
    netWorthCents: netWorth.toString(),
    grossAssetsCents: grossAssets.toString(),
    liabilitiesCents: totalLiabilities.toString(),
    latentTaxCents: totalLatentTax.toString(),
    allocationCents: allocationRaw,
    delta30d: delta30 ? { amountCents: delta30.amount, percent: delta30.percent } : null,
    asOf: new Date().toISOString(),
  });
}
