import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/services/api-auth";
import { baseAccountIds } from "@/lib/auth-context";
import { computePortfolio } from "@/lib/services/net-worth";
import { localeToIntl } from "@/lib/utils/format";

// GET /api/v1/net-worth - current net worth snapshot. See CLAUDE.md's
// "Public REST API" for the auth model (ApiKey bearer token, checked here
// rather than via proxy.ts/NextAuth - an external tool has no browser
// session to present) and why this reuses computeDashboard() rather than
// a separate query: the API must never disagree with what the dashboard
// itself shows for the same data.
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

  // The key owner's company shares count, as on their dashboard.
  const { result } = await computePortfolio({ accountIds, shareholderId: key.userId, intlLocale: localeToIntl("fr"), now: new Date() });
  const { hasAccounts, netWorth, grossAssets, totalLiabilities, totalLatentTax, allocationRaw, delta30 } = result;

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
