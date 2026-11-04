import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/services/api-auth";
import { baseAccountIds } from "@/lib/auth-context";
import { computePortfolio } from "@/lib/services/net-worth";
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

  // Accounts only: a company share is not an account of the key owner's (the
  // company's accounts are its manager's, and stay out of baseAccountIds), so
  // it shows in /net-worth, not here.
  const { result } = await computePortfolio({ accountIds, shareholderId: null, intlLocale: localeToIntl("fr"), now: new Date() });
  const { institutions } = result;

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
