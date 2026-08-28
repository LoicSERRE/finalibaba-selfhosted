import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { authenticateApiKey } from "@/lib/services/api-auth";
import { baseAccountIds } from "@/lib/auth-context";
import { computeDashboard } from "@/lib/domain/dashboard";
import { localeToIntl } from "@/lib/utils/format";

// GET /api/v1/accounts - every account's current value, grouped the same
// way as the dashboard's own institution list. Reuses computeDashboard()'s
// `institutions` output rather than re-deriving each account's value
// (holding market value, loan remaining capital, etc.) a second way.
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

  const { institutions } = computeDashboard({ accounts, allBalances, intlLocale: localeToIntl("fr"), now: new Date() });

  const flattened = institutions.flatMap((inst) =>
    inst.accounts.map((account) => ({
      id: account.id,
      name: account.name,
      type: account.type,
      institution: inst.name,
      valueCents: account.value.toString(),
    }))
  );

  return NextResponse.json({ accounts: flattened });
}
