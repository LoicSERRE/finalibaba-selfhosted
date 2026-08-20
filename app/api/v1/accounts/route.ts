import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { authenticateApiKey } from "@/lib/services/api-auth";
import { computeDashboard } from "@/lib/domain/dashboard";
import { localeToIntl } from "@/lib/utils/format";

// GET /api/v1/accounts - every account's current value, grouped the same
// way as the dashboard's own institution list. Reuses computeDashboard()'s
// `institutions` output rather than re-deriving each account's value
// (holding market value, loan remaining capital, etc.) a second way.
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
